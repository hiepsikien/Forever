from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import Message, Thread, User
from ..services.agent import maybe_reply, sender_display_name, sender_handle
from ..services.storage import absolute_media_path, save_upload

router = APIRouter(prefix="/api/threads", tags=["messages"])
media_router = APIRouter(prefix="/api/messages", tags=["messages"])


class SendMessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


def _message_payload(
    message: Message,
    *,
    sender_name: str | None,
    handle: str | None,
) -> dict:
    kind = getattr(message, "kind", None) or "text"
    meta_raw = getattr(message, "meta_json", None) or ""
    meta = None
    if meta_raw.strip():
        try:
            meta = json.loads(meta_raw)
        except json.JSONDecodeError:
            meta = None
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "sender_user_id": message.sender_user_id,
        "sender_kind": message.sender_kind,
        "sender_name": sender_name,
        "sender_handle": handle,
        "kind": kind,
        "body": message.body,
        "has_media": bool(getattr(message, "media_path", None)),
        "media_mime": getattr(message, "media_mime", None),
        "meta": meta,
        "created_at": message.created_at.isoformat(),
    }


def preview_body(message: Message) -> str:
    kind = getattr(message, "kind", None) or "text"
    text = (message.body or "").strip()
    if kind == "voice":
        return text or "[Giọng nói]"
    return text


@router.get("/{thread_id}/messages")
def list_messages(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = None,
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_membership(db, space_id=thread.space_id, user=user)

    query = db.query(Message).filter(Message.thread_id == thread_id)
    if before:
        anchor = db.query(Message).filter(Message.id == before).one_or_none()
        if anchor:
            query = query.filter(Message.created_at < anchor.created_at)
    messages = query.order_by(Message.created_at.desc()).limit(limit).all()
    messages.reverse()

    user_ids = {m.sender_user_id for m in messages if m.sender_user_id}
    profiles: dict[str, User] = {}
    if user_ids:
        for row in db.query(User).filter(User.id.in_(user_ids)).all():
            profiles[row.id] = row

    return {
        "messages": [
            _message_payload(
                m,
                sender_name=sender_display_name(
                    m.sender_kind,
                    profiles[m.sender_user_id].name if m.sender_user_id in profiles else None,
                ),
                handle=sender_handle(
                    m.sender_kind,
                    profiles[m.sender_user_id].handle if m.sender_user_id in profiles else None,
                ),
            )
            for m in messages
        ]
    }


@router.post("/{thread_id}/messages")
def send_message(
    thread_id: str,
    body: SendMessageBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_membership(db, space_id=thread.space_id, user=user)

    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    message = Message(
        id=generate(),
        thread_id=thread_id,
        sender_user_id=user.id,
        sender_kind="user",
        kind="text",
        body=text,
        media_path=None,
        media_mime=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    maybe_reply(db, thread=thread, user_message=message)

    return _message_payload(
        message,
        sender_name=user.name,
        handle=user.handle,
    )


@router.post("/{thread_id}/messages/voice")
async def send_voice_message(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    body: str = Form(default=""),
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_membership(db, space_id=thread.space_id, user=user)

    relative, mime = save_upload(thread.space_id, file)
    if not mime.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Voice message must be an audio file.")

    caption = (body or "").strip()[:8000]
    message = Message(
        id=generate(),
        thread_id=thread_id,
        sender_user_id=user.id,
        sender_kind="user",
        kind="voice",
        body=caption,
        media_path=relative,
        media_mime=mime,
        created_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    maybe_reply(db, thread=thread, user_message=message)

    return _message_payload(
        message,
        sender_name=user.name,
        handle=user.handle,
    )


@media_router.get("/{message_id}/media")
def get_message_media(
    message_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    message = db.query(Message).filter(Message.id == message_id).one_or_none()
    if not message or not message.media_path:
        raise HTTPException(status_code=404, detail="Media not found.")
    thread = db.query(Thread).filter(Thread.id == message.thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_membership(db, space_id=thread.space_id, user=user)
    path = absolute_media_path(message.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Media file missing.")
    return FileResponse(
        path,
        media_type=message.media_mime or "application/octet-stream",
        filename=path.name,
    )
