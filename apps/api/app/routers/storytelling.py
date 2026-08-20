"""Storytelling shelf — record & replay authentic readings of classics."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_steward_or_owner
from ..auth import get_current_user
from ..db import get_db
from ..models import (
    IdentityStoryWork,
    StoryChunk,
    StoryRecording,
    StoryWork,
    User,
)
from ..services.storage import (
    AUDIO_MIME,
    absolute_media_path,
    is_audio_mime,
    save_upload,
)
from ..services.storytelling import (
    chunk_prose_text,
    chunk_verse_text,
    expand_ritual_spoken,
    get_identity_in_space,
    pick_next_to_listen,
    pick_next_to_record,
    ready_recording_for_chunk,
    recorded_chunk_ids,
    replace_work_chunks,
    seed_storytelling_corpus,
)

router = APIRouter(tags=["storytelling"])


class ImportStoryTextBody(BaseModel):
    """Paste full text to (re)build chunks for a catalog work."""

    text: str = Field(min_length=40, max_length=500_000)
    # verse — lục bát / line-oriented; prose — kể chuyện văn xuôi
    form: str = Field(default="verse", pattern="^(verse|prose)$")
    source_note: str = Field(default="", max_length=2000)


def _ensure_corpus(db: Session) -> None:
    seed_storytelling_corpus(db)


def _work_payload(work: StoryWork, *, recorded: int, total: int, enabled: bool) -> dict:
    return {
        "id": work.id,
        "slug": work.slug,
        "title": work.title,
        "author": work.author,
        "source_note": work.source_note,
        "category": getattr(work, "category", None) or "classic",
        "sort_order": getattr(work, "sort_order", None) or 100,
        "enabled": enabled,
        "recorded_count": recorded,
        "chunk_count": total,
    }


def _chunk_payload(
    chunk: StoryChunk,
    *,
    recording: StoryRecording | None = None,
    include_body: bool = True,
) -> dict:
    out: dict = {
        "id": chunk.id,
        "work_id": chunk.work_id,
        "sort_order": chunk.sort_order,
        "label": chunk.label,
        "line_start": chunk.line_start,
        "line_end": chunk.line_end,
        "approx_seconds": chunk.approx_seconds,
        "recorded": recording is not None,
        "recording_id": recording.id if recording else None,
        "duration_ms": recording.duration_ms if recording else None,
    }
    if include_body:
        out["body"] = chunk.body
    return out


def _require_identity(db: Session, *, space_id: str, identity_id: str):
    identity = get_identity_in_space(db, space_id=space_id, identity_id=identity_id)
    if not identity or identity.archived_at is not None:
        raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ.")
    return identity


@router.get("/api/spaces/{space_id}/identities/{identity_id}/stories")
def list_story_shelf(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    works = (
        db.query(StoryWork)
        .order_by(StoryWork.category.asc(), StoryWork.sort_order.asc(), StoryWork.title.asc())
        .all()
    )
    enabled_ids = {
        row.work_id
        for row in db.query(IdentityStoryWork)
        .filter(IdentityStoryWork.identity_id == identity.id)
        .all()
    }
    done = recorded_chunk_ids(db, identity_id=identity.id)
    shelf = []
    for work in works:
        chunks = (
            db.query(StoryChunk.id)
            .filter(StoryChunk.work_id == work.id)
            .all()
        )
        chunk_ids = {row[0] for row in chunks}
        recorded = len(chunk_ids & done)
        shelf.append(
            _work_payload(
                work,
                recorded=recorded,
                total=len(chunk_ids),
                enabled=work.id in enabled_ids,
            )
        )
    return {
        "identity_id": identity.id,
        "display_name": identity.display_name,
        "works": shelf,
        "recorded_total": len(done),
    }


@router.post(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/works/{work_slug}/enable"
)
def enable_story_work(
    space_id: str,
    identity_id: str,
    work_slug: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    work = (
        db.query(StoryWork).filter(StoryWork.slug == work_slug).one_or_none()
    )
    if not work:
        raise HTTPException(status_code=404, detail="Không có tác phẩm này.")
    existing = (
        db.query(IdentityStoryWork)
        .filter(
            IdentityStoryWork.identity_id == identity.id,
            IdentityStoryWork.work_id == work.id,
        )
        .one_or_none()
    )
    if existing:
        return {"ok": True, "already": True}
    now = datetime.now(timezone.utc)
    db.add(
        IdentityStoryWork(
            id=generate(),
            space_id=space_id,
            identity_id=identity.id,
            work_id=work.id,
            enabled_by=user.id,
            enabled_at=now,
        )
    )
    db.commit()
    return {"ok": True}


@router.delete(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/works/{work_slug}/enable"
)
def disable_story_work(
    space_id: str,
    identity_id: str,
    work_slug: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    work = (
        db.query(StoryWork).filter(StoryWork.slug == work_slug).one_or_none()
    )
    if not work:
        raise HTTPException(status_code=404, detail="Không có tác phẩm này.")
    row = (
        db.query(IdentityStoryWork)
        .filter(
            IdentityStoryWork.identity_id == identity.id,
            IdentityStoryWork.work_id == work.id,
        )
        .one_or_none()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post(
    "/api/spaces/{space_id}/stories/works/{work_slug}/import"
)
def import_story_work_text(
    space_id: str,
    work_slug: str,
    body: ImportStoryTextBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Steward pastes quốc ngữ text — chunked for recording prompts.

    Used when a classic is not yet in the PD corpus (e.g. Lưu Bình, Chiêu Quân).
    Replaces existing chunks and deletes recordings tied to them.
    """
    require_steward_or_owner(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    work = (
        db.query(StoryWork).filter(StoryWork.slug == work_slug).one_or_none()
    )
    if not work:
        raise HTTPException(status_code=404, detail="Không có tác phẩm này.")
    text = expand_ritual_spoken(body.text)
    if body.form == "prose":
        chunks = chunk_prose_text(text, work_slug=work.slug)
    else:
        chunks = chunk_verse_text(text, work_slug=work.slug)
    if not chunks:
        raise HTTPException(status_code=400, detail="Không cắt được đoạn nào từ chữ đã dán.")
    if body.source_note.strip():
        work.source_note = body.source_note.strip()
    count = replace_work_chunks(db, work=work, chunks=chunks)
    return {
        "ok": True,
        "work": _work_payload(
            work, recorded=0, total=count, enabled=False
        ),
        "chunk_count": count,
    }


@router.get(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/works/{work_slug}/chunks"
)
def list_story_chunks(
    space_id: str,
    identity_id: str,
    work_slug: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    filter: str = "all",
):
    require_membership(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    work = (
        db.query(StoryWork).filter(StoryWork.slug == work_slug).one_or_none()
    )
    if not work:
        raise HTTPException(status_code=404, detail="Không có tác phẩm này.")
    chunks = (
        db.query(StoryChunk)
        .filter(StoryChunk.work_id == work.id)
        .order_by(StoryChunk.sort_order.asc())
        .all()
    )
    done = recorded_chunk_ids(db, identity_id=identity.id, work_id=work.id)
    mode = (filter or "all").strip().lower()
    out = []
    for chunk in chunks:
        is_done = chunk.id in done
        if mode == "recorded" and not is_done:
            continue
        if mode == "unrecorded" and is_done:
            continue
        recording = (
            ready_recording_for_chunk(
                db, identity_id=identity.id, chunk_id=chunk.id
            )
            if is_done
            else None
        )
        # List view: omit body to keep payload small; detail endpoints include it.
        out.append(
            _chunk_payload(chunk, recording=recording, include_body=False)
        )
    return {
        "work": _work_payload(
            work,
            recorded=len(done),
            total=len(chunks),
            enabled=True,
        ),
        "chunks": out,
    }


@router.get(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/chunks/{chunk_id}"
)
def get_story_chunk(
    space_id: str,
    identity_id: str,
    chunk_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    chunk = db.query(StoryChunk).filter(StoryChunk.id == chunk_id).one_or_none()
    if not chunk:
        raise HTTPException(status_code=404, detail="Không có đoạn này.")
    recording = ready_recording_for_chunk(
        db, identity_id=identity.id, chunk_id=chunk.id
    )
    work = db.query(StoryWork).filter(StoryWork.id == chunk.work_id).one()
    return {
        "work": {
            "id": work.id,
            "slug": work.slug,
            "title": work.title,
            "author": work.author,
        },
        "chunk": _chunk_payload(chunk, recording=recording, include_body=True),
    }


@router.get(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-record"
)
def next_chunk_to_record(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    work: str | None = None,
):
    require_membership(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    work_id = None
    if work:
        row = db.query(StoryWork).filter(StoryWork.slug == work).one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Không có tác phẩm này.")
        work_id = row.id
    chunk = pick_next_to_record(db, identity_id=identity.id, work_id=work_id)
    if not chunk:
        raise HTTPException(
            status_code=404,
            detail="Không còn đoạn chưa ghi — bật tác phẩm hoặc đã ghi hết.",
        )
    story = db.query(StoryWork).filter(StoryWork.id == chunk.work_id).one()
    return {
        "work": {
            "id": story.id,
            "slug": story.slug,
            "title": story.title,
            "author": story.author,
        },
        "chunk": _chunk_payload(chunk, include_body=True),
    }


@router.get(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-listen"
)
def next_chunk_to_listen(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    work: str | None = None,
):
    require_membership(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    work_id = None
    if work:
        row = db.query(StoryWork).filter(StoryWork.slug == work).one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Không có tác phẩm này.")
        work_id = row.id
    picked = pick_next_to_listen(db, identity_id=identity.id, work_id=work_id)
    if not picked:
        raise HTTPException(
            status_code=404,
            detail="Chưa có đoạn nào được ghi âm.",
        )
    chunk, recording = picked
    story = db.query(StoryWork).filter(StoryWork.id == chunk.work_id).one()
    return {
        "work": {
            "id": story.id,
            "slug": story.slug,
            "title": story.title,
            "author": story.author,
        },
        "chunk": _chunk_payload(chunk, recording=recording, include_body=True),
        "recording": {
            "id": recording.id,
            "duration_ms": recording.duration_ms,
            "media_mime": recording.media_mime,
        },
    }


@router.post(
    "/api/spaces/{space_id}/identities/{identity_id}/stories/chunks/{chunk_id}/record"
)
async def upload_story_recording(
    space_id: str,
    identity_id: str,
    chunk_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    duration_ms: int | None = Form(default=None),
):
    require_membership(db, space_id=space_id, user=user)
    _ensure_corpus(db)
    identity = _require_identity(db, space_id=space_id, identity_id=identity_id)
    chunk = db.query(StoryChunk).filter(StoryChunk.id == chunk_id).one_or_none()
    if not chunk:
        raise HTTPException(status_code=404, detail="Không có đoạn này.")
    enabled = (
        db.query(IdentityStoryWork)
        .filter(
            IdentityStoryWork.identity_id == identity.id,
            IdentityStoryWork.work_id == chunk.work_id,
        )
        .one_or_none()
    )
    if not enabled:
        raise HTTPException(
            status_code=400,
            detail="Tác phẩm chưa được bật trên kệ kể chuyện của hồ sơ này.",
        )

    media_path, mime = save_upload(space_id, file)
    if not is_audio_mime(mime) and mime not in AUDIO_MIME:
        absolute_media_path(media_path).unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file audio.")

    now = datetime.now(timezone.utc)
    # Retire any prior ready take for this chunk.
    prior = (
        db.query(StoryRecording)
        .filter(
            StoryRecording.identity_id == identity.id,
            StoryRecording.chunk_id == chunk.id,
            StoryRecording.status == "ready",
        )
        .all()
    )
    for row in prior:
        row.status = "retired"

    recording = StoryRecording(
        id=generate(),
        space_id=space_id,
        identity_id=identity.id,
        chunk_id=chunk.id,
        media_path=media_path,
        media_mime=mime,
        duration_ms=duration_ms if duration_ms and duration_ms > 0 else None,
        status="ready",
        created_by=user.id,
        created_at=now,
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)
    work = db.query(StoryWork).filter(StoryWork.id == chunk.work_id).one()
    return {
        "work": {
            "id": work.id,
            "slug": work.slug,
            "title": work.title,
            "author": work.author,
        },
        "chunk": _chunk_payload(chunk, recording=recording, include_body=True),
        "recording": {
            "id": recording.id,
            "duration_ms": recording.duration_ms,
            "media_mime": recording.media_mime,
        },
    }


@router.get("/api/story-recordings/{recording_id}/media")
def get_story_recording_media(
    recording_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    recording = (
        db.query(StoryRecording)
        .filter(StoryRecording.id == recording_id)
        .one_or_none()
    )
    if not recording or recording.status != "ready":
        raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi.")
    require_membership(db, space_id=recording.space_id, user=user)
    path = absolute_media_path(recording.media_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File audio không còn.")
    return FileResponse(
        path,
        media_type=recording.media_mime or "audio/mpeg",
        filename=path.name,
    )
