from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import Message, Thread, User

router = APIRouter(prefix="/api/threads", tags=["messages"])


class SendMessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


def _message_payload(message: Message, sender_name: str | None) -> dict:
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "sender_user_id": message.sender_user_id,
        "sender_kind": message.sender_kind,
        "sender_name": sender_name,
        "body": message.body,
        "created_at": message.created_at.isoformat(),
    }


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
    names = {}
    if user_ids:
        for row in db.query(User).filter(User.id.in_(user_ids)).all():
            names[row.id] = row.name

    return {
        "messages": [
            _message_payload(
                m,
                names.get(m.sender_user_id)
                if m.sender_kind == "user"
                else "Ký ức",
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
        body=text,
        created_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return _message_payload(message, user.name)
