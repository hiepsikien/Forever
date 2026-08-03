from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import desc, nulls_last
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import MemoryItem, Message, Thread, User
from ..services.storage import (
    MAX_MEMORY_MEDIA_BYTES,
    absolute_media_path,
    copy_media,
    is_audio_mime,
    is_video_mime,
    save_upload,
)

router = APIRouter(tags=["memories"])


class CreateNoteBody(BaseModel):
    title: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    tags: str = Field(default="", max_length=500)
    occurred_at: str | None = None


class FromMessageBody(BaseModel):
    message_id: str
    title: str = Field(default="", max_length=200)


class UpdateMemoryBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=8000)
    tags: str | None = Field(default=None, max_length=500)


def _warm_video_assets(media_relative: str) -> None:
    """Best-effort background prep so first playback is faster."""
    try:
        from ..services.video_playback import ensure_playback_mp4
        from ..services.video_thumbnail import ensure_video_thumbnail

        ensure_playback_mp4(media_relative)
        ensure_video_thumbnail(media_relative)
    except Exception:
        pass


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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    kind: str = Form(default="voice"),
    title: str = Form(default=""),
    body: str = Form(default=""),
    tags: str = Form(default=""),
):
    require_membership(db, space_id=space_id, user=user)
    kind = kind.strip().lower()
    if kind not in {"voice", "photo", "video"}:
        raise HTTPException(status_code=400, detail="kind must be voice, photo, or video.")

    max_bytes = MAX_MEMORY_MEDIA_BYTES if kind in {"voice", "video"} else None
    relative, mime = save_upload(space_id, file, max_bytes=max_bytes)
    if kind == "voice" and not is_audio_mime(mime):
        raise HTTPException(status_code=400, detail="Voice upload must be an audio file.")
    if kind == "video" and not is_video_mime(mime):
        raise HTTPException(status_code=400, detail="Video upload must be a video file.")
    if kind == "photo" and not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Photo upload must be an image file.")

    default_title = {
        "voice": "Voice note",
        "video": "Video ký ức",
        "photo": "Ảnh ký ức",
    }[kind]

    now = datetime.now(timezone.utc)
    item = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind=kind,
        title=(title or "").strip() or default_title,
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
    if kind == "video" and item.media_path:
        background_tasks.add_task(_warm_video_assets, item.media_path)
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
    msg_kind = getattr(message, "kind", None) or "text"
    media_path = None
    media_mime = None
    if msg_kind == "voice":
        if not message.media_path:
            raise HTTPException(status_code=400, detail="Voice message has no media.")
        media_path = copy_media(space_id, message.media_path)
        media_mime = message.media_mime
        kind = "voice"
        title = (body.title or "").strip() or "Giọng nói từ Phòng khách"
        note_body = (message.body or "").strip() or "Voice note từ chat"
    else:
        kind = "note"
        title = (body.title or "").strip() or "Từ Phòng khách"
        note_body = message.body
        if not (note_body or "").strip():
            raise HTTPException(status_code=400, detail="Message has no text to save.")

    item = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind=kind,
        title=title,
        body=note_body,
        media_path=media_path,
        media_mime=media_mime,
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


@router.get("/api/memories/{memory_id}/playback")
def get_memory_playback(
    memory_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """MP4 remux for in-app playback (MTS/MOV/MKV → H.264 MP4 cached on disk)."""
    from ..services.video_playback import VideoPlaybackError, ensure_playback_mp4

    item = db.query(MemoryItem).filter(MemoryItem.id == memory_id).one_or_none()
    if not item or not item.media_path:
        raise HTTPException(status_code=404, detail="Media not found.")
    if item.kind != "video":
        raise HTTPException(status_code=400, detail="Playback chỉ dành cho ký ức video.")
    require_membership(db, space_id=item.space_id, user=user)
    try:
        path = ensure_playback_mp4(item.media_path)
    except VideoPlaybackError as exc:
        raise HTTPException(status_code=503, detail=exc.message) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Playback file missing.")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
    )


@router.get("/api/memories/{memory_id}/thumbnail")
def get_memory_thumbnail(
    memory_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    from ..services.video_playback import VideoPlaybackError
    from ..services.video_thumbnail import ensure_video_thumbnail

    item = db.query(MemoryItem).filter(MemoryItem.id == memory_id).one_or_none()
    if not item or not item.media_path:
        raise HTTPException(status_code=404, detail="Media not found.")
    if item.kind != "video":
        raise HTTPException(status_code=400, detail="Thumbnail chỉ dành cho video.")
    require_membership(db, space_id=item.space_id, user=user)
    try:
        path = ensure_video_thumbnail(item.media_path)
    except VideoPlaybackError as exc:
        raise HTTPException(status_code=503, detail=exc.message) from exc
    return FileResponse(path, media_type="image/jpeg", filename=path.name)


@router.patch("/api/memories/{memory_id}")
def update_memory(
    memory_id: str,
    body: UpdateMemoryBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    item = db.query(MemoryItem).filter(MemoryItem.id == memory_id).one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Memory not found.")
    require_membership(db, space_id=item.space_id, user=user)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty.")
        item.title = title[:200]
    if body.body is not None:
        item.body = body.body.strip()[:8000]
    if body.tags is not None:
        item.tags = body.tags.strip()[:500]
    db.commit()
    db.refresh(item)
    creator = db.query(User).filter(User.id == item.created_by).one_or_none()
    return _memory_payload(item, creator.name if creator else None)
