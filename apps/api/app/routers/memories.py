from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import desc, nulls_last
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import MemoryItem, Message, Thread, User
from ..services.storage import absolute_media_path, save_upload

router = APIRouter(tags=["memories"])


class CreateNoteBody(BaseModel):
    title: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    tags: str = Field(default="", max_length=500)
    occurred_at: str | None = None


class FromMessageBody(BaseModel):
    message_id: str
    title: str = Field(default="", max_length=200)


def _parse_occurred_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid occurred_at.") from exc


def _memory_payload(item: MemoryItem, creator_name: str | None) -> dict:
    return {
        "id": item.id,
        "space_id": item.space_id,
        "created_by": item.created_by,
        "creator_name": creator_name,
        "kind": item.kind,
        "title": item.title,
        "body": item.body,
        "has_media": bool(item.media_path),
        "media_mime": item.media_mime,
        "source_message_id": item.source_message_id,
        "tags": item.tags,
        "occurred_at": item.occurred_at.isoformat() if item.occurred_at else None,
        "created_at": item.created_at.isoformat(),
    }


def _creator_names(db: Session, items: list[MemoryItem]) -> dict[str, str]:
    ids = {m.created_by for m in items}
    if not ids:
        return {}
    return {u.id: u.name for u in db.query(User).filter(User.id.in_(ids)).all()}


@router.get("/api/spaces/{space_id}/memories")
def list_memories(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    items = (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id)
        .order_by(
            nulls_last(desc(MemoryItem.occurred_at)),
            desc(MemoryItem.created_at),
        )
        .all()
    )
    names = _creator_names(db, items)
    return {
        "memories": [_memory_payload(m, names.get(m.created_by)) for m in items]
    }


@router.post("/api/spaces/{space_id}/memories/note")
def create_note_memory(
    space_id: str,
    body: CreateNoteBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    now = datetime.now(timezone.utc)
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Body cannot be empty.")
    item = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind="note",
        title=(body.title or "").strip() or "Ghi chú",
        body=text,
        media_path=None,
        media_mime=None,
        source_message_id=None,
        tags=(body.tags or "").strip(),
        occurred_at=_parse_occurred_at(body.occurred_at) or now,
        created_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _memory_payload(item, user.name)


@router.post("/api/spaces/{space_id}/memories/upload")
async def upload_memory(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    kind: str = Form(default="voice"),
    title: str = Form(default=""),
    body: str = Form(default=""),
    tags: str = Form(default=""),
):
    require_membership(db, space_id=space_id, user=user)
    kind = kind.strip().lower()
    if kind not in {"voice", "photo"}:
        raise HTTPException(status_code=400, detail="kind must be voice or photo.")

    relative, mime = save_upload(space_id, file)
    if kind == "voice" and not mime.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Voice upload must be an audio file.")
    if kind == "photo" and not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Photo upload must be an image file.")

    now = datetime.now(timezone.utc)
    item = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind=kind,
        title=(title or "").strip()
        or ("Voice note" if kind == "voice" else "Ảnh ký ức"),
        body=(body or "").strip(),
        media_path=relative,
        media_mime=mime,
        source_message_id=None,
        tags=(tags or "").strip(),
        occurred_at=now,
        created_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _memory_payload(item, user.name)


@router.post("/api/spaces/{space_id}/memories/from-message")
def memory_from_message(
    space_id: str,
    body: FromMessageBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    message = db.query(Message).filter(Message.id == body.message_id).one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found.")
    thread = db.query(Thread).filter(Thread.id == message.thread_id).one_or_none()
    if not thread or thread.space_id != space_id:
        raise HTTPException(status_code=400, detail="Message is not in this space.")

    now = datetime.now(timezone.utc)
    item = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind="note",
        title=(body.title or "").strip() or "Từ Phòng khách",
        body=message.body,
        media_path=None,
        media_mime=None,
        source_message_id=message.id,
        tags="from-chat",
        occurred_at=message.created_at or now,
        created_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _memory_payload(item, user.name)


@router.get("/api/memories/{memory_id}/media")
def get_memory_media(
    memory_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    item = db.query(MemoryItem).filter(MemoryItem.id == memory_id).one_or_none()
    if not item or not item.media_path:
        raise HTTPException(status_code=404, detail="Media not found.")
    require_membership(db, space_id=item.space_id, user=user)
    path = absolute_media_path(item.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Media file missing.")
    return FileResponse(
        path,
        media_type=item.media_mime or "application/octet-stream",
        filename=path.name,
    )
