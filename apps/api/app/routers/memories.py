from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import desc, nulls_last
from sqlalchemy.orm import Session

from ..access import (
    is_moderator_or_above,
    require_membership,
    require_steward_or_owner,
)
from ..auth import get_current_user
from ..db import get_db
from ..models import IdentityProfile, MemoryItem, Message, Thread, User
from ..services.heritage import HERITAGE_TAG_PREFIX, POEM_KIND, poem_authorship_tag, tag_tokens
from ..services.memory_scope import (
    VISIBILITIES,
    normalize_visibility,
    readable_by,
    visible_to,
)
from ..services.poetry_clean import clean_body_lines, format_body, format_body_tts
from ..services.storage import (
    MAX_MEMORY_MEDIA_BYTES,
    absolute_media_path,
    copy_media,
    delete_media_artifacts,
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
    # note (default) | milestone | poem — steward/member typed entries from the app.
    kind: str = Field(default="note", max_length=32)


CREATE_TEXT_KINDS = frozenset({"note", "milestone", "poem"})


class FromMessageBody(BaseModel):
    message_id: str
    title: str = Field(default="", max_length=200)


class UpdateMemoryBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=8000)
    tags: str | None = Field(default=None, max_length=500)
    visibility: str | None = Field(default=None, max_length=16)
    occurred_at: str | None = None
    clear_occurred_at: bool = False
    clear_media: bool = False


ALLOWED_POEM_THEMES = {
    "vo_chong",
    "con_cai",
    "gia_dinh",
    "nghe_giao",
    "tho",
    "biet_on",
    "truyen_thong",
}
UNTITLED_POEM = "Thơ không đề"


class ImportPoem(BaseModel):
    title: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    body_tts: str = Field(default="", max_length=12000)
    meter: str = Field(default="unknown", max_length=32)
    themes: list[str] = Field(default_factory=list)
    composed_on: str | None = None
    source_name: str = Field(default="", max_length=200)
    page_label: str | None = Field(default=None, max_length=32)


class ImportPoemsBody(BaseModel):
    identity_id: str
    poems: list[ImportPoem] = Field(min_length=1, max_length=200)
    dry_run: bool = False


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


def _memory_payload(
    item: MemoryItem,
    creator_name: str | None,
    *,
    source_thread_id: str | None = None,
) -> dict:
    return {
        "id": item.id,
        "space_id": item.space_id,
        "created_by": item.created_by,
        "creator_name": creator_name,
        "kind": item.kind,
        "title": item.title,
        "body": item.body,
        "body_tts": item.body_tts or "",
        "has_media": bool(item.media_path),
        "media_mime": item.media_mime,
        "source_message_id": item.source_message_id,
        "source_thread_id": source_thread_id,
        "tags": item.tags,
        "visibility": normalize_visibility(item.visibility),
        "occurred_at": item.occurred_at.isoformat() if item.occurred_at else None,
        "created_at": item.created_at.isoformat(),
    }


def _creator_names(db: Session, items: list[MemoryItem]) -> dict[str, str]:
    ids = {m.created_by for m in items}
    if not ids:
        return {}
    return {u.id: u.name for u in db.query(User).filter(User.id.in_(ids)).all()}


def _source_thread_ids(db: Session, items: list[MemoryItem]) -> dict[str, str]:
    """Map memory id → thread id for knowledge items that cite a chat message."""
    msg_ids = {
        m.source_message_id
        for m in items
        if m.source_message_id and m.kind == "knowledge"
    }
    if not msg_ids:
        return {}
    by_msg = {
        row.id: row.thread_id
        for row in db.query(Message).filter(Message.id.in_(msg_ids)).all()
    }
    return {
        m.id: by_msg[m.source_message_id]
        for m in items
        if m.source_message_id and m.source_message_id in by_msg
    }


def _resolve_source_thread_id(db: Session, item: MemoryItem) -> str | None:
    if not item.source_message_id:
        return None
    msg = db.query(Message).filter(Message.id == item.source_message_id).one_or_none()
    return msg.thread_id if msg else None


@router.get("/api/spaces/{space_id}/memories")
def list_memories(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    items = (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, readable_by(user.id))
        .order_by(
            nulls_last(desc(MemoryItem.occurred_at)),
            desc(MemoryItem.created_at),
        )
        .all()
    )
    names = _creator_names(db, items)
    threads = _source_thread_ids(db, items)
    return {
        "memories": [
            _memory_payload(
                m,
                names.get(m.created_by),
                source_thread_id=threads.get(m.id),
            )
            for m in items
        ]
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
    kind = (body.kind or "note").strip().lower() or "note"
    if kind not in CREATE_TEXT_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"kind must be one of: {', '.join(sorted(CREATE_TEXT_KINDS))}.",
        )
    title = (body.title or "").strip()
    if kind == "milestone":
        title = title or "Mốc đời"
    elif kind == "poem":
        title = title or UNTITLED_POEM
    else:
        title = title or "Ghi chú"

    tags = (body.tags or "").strip()
    if kind == "poem" and "tho" not in tag_tokens(tags):
        tags = f"{tags} tho".strip()[:500]

    occurred = _parse_occurred_at(body.occurred_at)
    if kind == "note" and occurred is None:
        occurred = now
    # milestone / poem: leave occurred_at null when unknown (timeline «chưa rõ năm»).

    item = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind=kind,
        title=title,
        body=text if kind != "poem" else format_body(clean_body_lines(text)),
        body_tts=(
            format_body_tts(clean_body_lines(text)) if kind == "poem" else ""
        ),
        media_path=None,
        media_mime=None,
        source_message_id=None,
        tags=tags,
        occurred_at=occurred,
        created_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _memory_payload(item, user.name)


def _poem_tags(identity_id: str, meter: str, themes: list[str]) -> str:
    tags = [
        f"{HERITAGE_TAG_PREFIX}{identity_id}",
        "tho",
        poem_authorship_tag("own"),
    ]
    meter = (meter or "").strip()
    if meter and meter != "unknown":
        tags.append(f"meter:{meter}")
    for theme in themes:
        theme = (theme or "").strip()
        if theme in ALLOWED_POEM_THEMES:
            tags.append(f"chu-de:{theme}")
    return " ".join(dict.fromkeys(tags))[:500]


def _meter_from_tags(tags: str | None) -> str:
    for token in tag_tokens(tags):
        if token.startswith("meter:"):
            return token.split(":", 1)[1]
    return "unknown"


def _poem_fingerprint(body: str) -> str:
    return "\n".join(ln.strip() for ln in body.strip().splitlines() if ln.strip()).lower()


def _parse_composed_on(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"composed_on không hợp lệ: {value}"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


@router.post("/api/spaces/{space_id}/memories/poems/import")
def import_poems(
    space_id: str,
    body: ImportPoemsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Batch import reviewed OCR poems into the library as kind=poem.

    Poems are heritage *material*, not anchor memories — they never count
    toward the activate gate (see services/heritage.KNOWLEDGE_KINDS).
    """
    require_steward_or_owner(db, space_id=space_id, user=user)
    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == body.identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not identity:
        raise HTTPException(status_code=404, detail="Identity profile not found.")

    needle = f"{HERITAGE_TAG_PREFIX}{identity.id}"
    existing = {
        _poem_fingerprint(item.body)
        for item in db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == POEM_KIND)
        .all()
        if needle in tag_tokens(item.tags)
    }

    now = datetime.now(timezone.utc)
    imported: list[MemoryItem] = []
    skipped: list[dict] = []
    for poem in body.poems:
        meter = (poem.meter or "unknown").strip()
        lines = clean_body_lines(poem.body, meter=meter)
        text = format_body(lines)
        if not text:
            skipped.append({"title": poem.title, "reason": "empty_body"})
            continue
        fingerprint = _poem_fingerprint(text)
        if fingerprint in existing:
            skipped.append({"title": poem.title, "reason": "duplicate"})
            continue
        existing.add(fingerprint)
        occurred_at = _parse_composed_on(poem.composed_on)
        item = MemoryItem(
            id=generate(),
            space_id=space_id,
            created_by=user.id,
            kind=POEM_KIND,
            title=(poem.title or "").strip()[:200] or UNTITLED_POEM,
            body=text,
            body_tts=(poem.body_tts or "").strip() or format_body_tts(lines, meter=meter),
            media_path=None,
            media_mime=None,
            source_message_id=None,
            tags=_poem_tags(identity.id, meter, poem.themes),
            occurred_at=occurred_at,
            created_at=now,
        )
        imported.append(item)

    if body.dry_run:
        return {
            "dry_run": True,
            "would_import": len(imported),
            "skipped": skipped,
            "titles": [m.title for m in imported],
        }

    for item in imported:
        db.add(item)
    db.commit()
    for item in imported:
        db.refresh(item)
    return {
        "dry_run": False,
        "imported": len(imported),
        "skipped": skipped,
        "memories": [_memory_payload(m, user.name) for m in imported],
    }


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
    occurred_at: str = Form(default=""),
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
    parsed_occurred = _parse_occurred_at(occurred_at.strip() or None)
    if parsed_occurred is not None:
        item_occurred = parsed_occurred
    elif kind == "photo":
        item_occurred = None
    else:
        item_occurred = now
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
        occurred_at=item_occurred,
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


def _require_can_edit_memory(db: Session, item: MemoryItem, user: User) -> None:
    """Who may change or remove something already kept.

    The person who saved it, and the people the family trusts to tend the
    memorial pages. Everyone else may read it and add their own — a shared
    library is not a place where anyone can quietly delete your grandmother.

    A memory kept private stays invisible here, so a moderator cannot reach
    what was never shared with them in the first place.
    """
    require_membership(db, space_id=item.space_id, user=user)
    if not visible_to(item, user.id):
        raise HTTPException(status_code=404, detail="Memory not found.")
    if item.created_by == user.id:
        return
    if is_moderator_or_above(db, space_id=item.space_id, user=user):
        return
    raise HTTPException(
        status_code=403,
        detail="Chỉ người lưu ký ức này hoặc người quản lý mới sửa được.",
    )


@router.delete("/api/memories/{memory_id}")
def delete_memory(
    memory_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    item = db.query(MemoryItem).filter(MemoryItem.id == memory_id).one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Memory not found.")
    _require_can_edit_memory(db, item, user)
    media_path = item.media_path
    db.delete(item)
    db.commit()
    if media_path:
        try:
            delete_media_artifacts(media_path)
        except Exception:
            pass
    return {"ok": True}


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
    _require_can_edit_memory(db, item, user)
    if body.visibility is not None:
        if body.visibility not in VISIBILITIES:
            raise HTTPException(status_code=400, detail="Visibility không hợp lệ.")
        # Only the person who saved it decides who reads it — a steward moving
        # someone else's memory behind a wall, or out from behind one, would
        # make the wall theirs rather than its owner's.
        if item.created_by != user.id:
            raise HTTPException(
                status_code=403,
                detail="Chỉ người lưu ký ức này mới đổi được phạm vi.",
            )
        item.visibility = body.visibility
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty.")
        item.title = title[:200]
    if body.body is not None:
        item.body = body.body.strip()[:8000]
        if item.kind == POEM_KIND:
            meter = _meter_from_tags(item.tags)
            lines = clean_body_lines(item.body, meter=meter)
            item.body = format_body(lines)
            item.body_tts = format_body_tts(lines, meter=meter)
    if body.tags is not None:
        item.tags = body.tags.strip()[:500]
    if body.clear_occurred_at:
        item.occurred_at = None
    elif body.occurred_at is not None:
        item.occurred_at = _parse_occurred_at(body.occurred_at)
    if body.clear_media:
        old_path = item.media_path
        item.media_path = None
        item.media_mime = None
        if old_path:
            try:
                delete_media_artifacts(old_path)
            except Exception:
                pass
    db.commit()
    db.refresh(item)
    creator = db.query(User).filter(User.id == item.created_by).one_or_none()
    return _memory_payload(
        item,
        creator.name if creator else None,
        source_thread_id=_resolve_source_thread_id(db, item),
    )


@router.post("/api/memories/{memory_id}/media")
async def attach_memory_media(
    memory_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
):
    """Attach or replace an image on a text memory (milestone / note / poem)."""
    item = db.query(MemoryItem).filter(MemoryItem.id == memory_id).one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Memory not found.")
    _require_can_edit_memory(db, item, user)
    if item.kind in {"voice", "photo", "video"}:
        raise HTTPException(
            status_code=400,
            detail="Dùng upload riêng cho voice/photo/video.",
        )
    relative, mime = save_upload(item.space_id, file)
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Chỉ gắn được ảnh.")
    old_path = item.media_path
    item.media_path = relative
    item.media_mime = mime
    db.commit()
    db.refresh(item)
    if old_path and old_path != relative:
        try:
            delete_media_artifacts(old_path)
        except Exception:
            pass
    creator = db.query(User).filter(User.id == item.created_by).one_or_none()
    return _memory_payload(
        item,
        creator.name if creator else None,
        source_thread_id=_resolve_source_thread_id(db, item),
    )
