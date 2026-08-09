from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_thread_access
from ..auth import get_current_user
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import Message, Thread, User
from ..services.agent import maybe_reply, sender_display_name, sender_handle
from ..services.heritage_chat import heritage_display_name, identity_for_heritage_thread, maybe_heritage_reply
from ..services.storage import absolute_media_path, save_upload
from ..services.stt import transcribe

router = APIRouter(prefix="/api/threads", tags=["messages"])
media_router = APIRouter(prefix="/api/messages", tags=["messages"])

logger = logging.getLogger(__name__)


class SendMessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


def _heritage_sender_name(db: Session, thread: Thread, sender_kind: str) -> str | None:
    if sender_kind != "heritage" or thread.kind != "heritage":
        return None
    identity = identity_for_heritage_thread(db, thread.id)
    if not identity:
        return "Ký ức"
    return heritage_display_name(identity)


def _apply_stt(db: Session, message: Message) -> None:
    """Fill Message.body from audio when caption is empty. Never raises."""
    settings = get_settings()
    if (message.kind or "") != "voice":
        return
    if not message.media_path:
        return
    if (message.body or "").strip():
        return

    path = absolute_media_path(message.media_path)
    thread = db.query(Thread).filter(Thread.id == message.thread_id).one_or_none()
    from ..services.ai_usage import UsageContext
    from ..services.heritage_pipeline import load_heritage_pipeline

    if thread is not None:
        if not load_heritage_pipeline(db, thread.space_id, settings=settings).stt:
            return
    elif not settings.stt_enabled:
        return

    transcript = transcribe(
        settings,
        path=path,
        mime=getattr(message, "media_mime", None),
        usage=UsageContext(
            space_id=thread.space_id if thread else None,
            thread_id=message.thread_id,
            message_id=message.id,
            user_id=message.sender_user_id,
            operation="stt",
        ),
    )
    meta: dict = {}
    raw = getattr(message, "meta_json", None) or ""
    if raw.strip():
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                meta = loaded
        except json.JSONDecodeError:
            meta = {}
    meta["stt"] = transcript.as_meta()
    if transcript.ok:
        message.body = transcript.text.strip()[:8000]
    message.meta_json = json.dumps(meta, ensure_ascii=False)
    db.add(message)
    db.commit()
    db.refresh(message)


def _heritage_reply_job(thread_id: str, message_id: str) -> None:
    """Run the heritage pipeline on its own session, after the response is sent.

    FastAPI closes the request-scoped session before background tasks run, so
    this reloads the rows it needs. Errors stay here: a failed reply must never
    surface as a failed send.
    """
    db = SessionLocal()
    try:
        thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
        message = db.query(Message).filter(Message.id == message_id).one_or_none()
        if thread and message:
            if (message.kind or "") == "voice":
                _apply_stt(db, message)
            maybe_heritage_reply(db, thread=thread, user_message=message)
    except Exception:
        logger.exception("heritage reply failed for message %s", message_id)
    finally:
        db.close()


def _voice_message_job(thread_id: str, message_id: str) -> None:
    """STT a voice note, then run the usual auto-reply path for that thread."""
    db = SessionLocal()
    try:
        thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
        message = db.query(Message).filter(Message.id == message_id).one_or_none()
        if not thread or not message:
            return
        _apply_stt(db, message)
        if thread.kind == "heritage":
            maybe_heritage_reply(db, thread=thread, user_message=message)
        else:
            maybe_reply(db, thread=thread, user_message=message)
    except Exception:
        logger.exception("voice message job failed for message %s", message_id)
    finally:
        db.close()


def _dispatch_auto_reply(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    background: BackgroundTasks | None = None,
) -> None:
    if thread.kind != "heritage":
        maybe_reply(db, thread=thread, user_message=user_message)
        return
    if background is not None and get_settings().heritage_async_reply:
        background.add_task(_heritage_reply_job, thread.id, user_message.id)
        return
    if (user_message.kind or "") == "voice":
        _apply_stt(db, user_message)
    maybe_heritage_reply(db, thread=thread, user_message=user_message)


def _dispatch_voice_message(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    background: BackgroundTasks | None = None,
) -> None:
    """Voice notes always STT before any reply so heritage reads a real body."""
    settings = get_settings()
    async_ok = background is not None and (
        thread.kind != "heritage" or settings.heritage_async_reply
    )
    if async_ok:
        background.add_task(_voice_message_job, thread.id, user_message.id)
        return
    _apply_stt(db, user_message)
    if thread.kind == "heritage":
        maybe_heritage_reply(db, thread=thread, user_message=user_message)
    else:
        maybe_reply(db, thread=thread, user_message=user_message)


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
    require_thread_access(db, thread=thread, user=user)

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

    heritage_label = _heritage_sender_name(db, thread, "heritage")

    return {
        "messages": [
            _message_payload(
                m,
                sender_name=(
                    heritage_label
                    if m.sender_kind == "heritage" and heritage_label
                    else sender_display_name(
                        m.sender_kind,
                        profiles[m.sender_user_id].name
                        if m.sender_user_id in profiles
                        else None,
                    )
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
    background: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)

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

    _dispatch_auto_reply(db, thread=thread, user_message=message, background=background)

    return _message_payload(
        message,
        sender_name=user.name,
        handle=user.handle,
    )


@router.post("/{thread_id}/messages/voice")
async def send_voice_message(
    thread_id: str,
    background: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    body: str = Form(default=""),
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)

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

    _dispatch_voice_message(
        db, thread=thread, user_message=message, background=background
    )

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
    require_thread_access(db, thread=thread, user=user)
    path = absolute_media_path(message.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Media file missing.")
    return FileResponse(
        path,
        media_type=message.media_mime or "application/octet-stream",
        filename=path.name,
    )
