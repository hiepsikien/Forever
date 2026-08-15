from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import is_steward_or_owner, require_membership, require_steward_or_owner
from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import IdentityProfile, Keepsake, MemoryItem, User
from ..services.heritage import POEM_KIND, has_heritage_tag
from ..services.keepsakes import (
    PHOTO_KIND,
    STATUSES,
    attach_opener_tts,
    ensure_keepsake,
    family_thread_for_identity,
    open_on_family_thread,
    payload,
    pick_today,
    skip as skip_keepsake,
)

router = APIRouter(prefix="/api", tags=["keepsakes"])


def _require_flag() -> None:
    if not get_settings().heritage_keepsake_enabled:
        raise HTTPException(status_code=404, detail="Hiện vật chưa bật.")


def _row_or_404(db: Session, keepsake_id: str) -> Keepsake:
    row = db.query(Keepsake).filter(Keepsake.id == keepsake_id).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy hiện vật.")
    return row


@router.get("/spaces/{space_id}/keepsake/today")
def keepsake_today(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    _require_flag()
    require_membership(db, space_id=space_id, user=user)
    row, thread = pick_today(db, space_id=space_id)
    if not row or not thread:
        return {"keepsake": None}
    return {
        "keepsake": payload(
            db,
            row,
            thread=thread,
            can_skip=is_steward_or_owner(db, space_id=space_id, user=user),
        )
    }


class PatchKeepsakeBody(BaseModel):
    opener: str | None = Field(default=None, max_length=800)
    status: str | None = Field(default=None, max_length=16)


@router.patch("/keepsakes/{keepsake_id}")
def patch_keepsake(
    keepsake_id: str,
    body: PatchKeepsakeBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    _require_flag()
    row = _row_or_404(db, keepsake_id)
    require_steward_or_owner(db, space_id=row.space_id, user=user)
    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ.")
        row.status = body.status
    if body.opener is not None:
        row.opener = body.opener.strip()
    from datetime import datetime, timezone

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return {"keepsake": payload(db, row, can_skip=True)}


@router.post("/keepsakes/{keepsake_id}/open")
def open_keepsake(
    keepsake_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    _require_flag()
    row = _row_or_404(db, keepsake_id)
    require_membership(db, space_id=row.space_id, user=user)
    if row.status not in ("ready",):
        raise HTTPException(status_code=409, detail="Hiện vật này chưa sẵn sàng.")
    if row.kind != PHOTO_KIND:
        raise HTTPException(
            status_code=400, detail="Thơ không mở hội thoại — chỉ đọc hoặc nghe."
        )
    thread = family_thread_for_identity(
        db, space_id=row.space_id, identity_id=row.identity_id
    )
    if not thread:
        raise HTTPException(
            status_code=409, detail="Chưa có phòng chat chung với người được nhớ."
        )
    message = open_on_family_thread(db, row=row, thread=thread)
    background_tasks.add_task(attach_opener_tts, message.id)
    db.refresh(row)
    return {
        "keepsake": payload(db, row, thread=thread, can_skip=is_steward_or_owner(
            db, space_id=row.space_id, user=user
        )),
        "thread_id": thread.id,
        "message_id": message.id,
    }


@router.post("/keepsakes/{keepsake_id}/skip")
def skip_keepsake_route(
    keepsake_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    _require_flag()
    row = _row_or_404(db, keepsake_id)
    require_steward_or_owner(db, space_id=row.space_id, user=user)
    if row.status == "skipped":
        return {"keepsake": payload(db, row, can_skip=True)}
    skip_keepsake(row)
    db.commit()
    db.refresh(row)
    nxt, thread = pick_today(db, space_id=row.space_id)
    return {
        "keepsake": payload(db, row, can_skip=True),
        "next": payload(db, nxt, thread=thread, can_skip=True) if nxt and thread else None,
    }


class RegisterPoemsBody(BaseModel):
    identity_id: str
    status: str = Field(default="ready", max_length=16)


@router.post("/spaces/{space_id}/keepsakes/from-poems")
def register_poem_keepsakes(
    space_id: str,
    body: RegisterPoemsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Turn existing library poems into listen-only artifacts (no chat harvest)."""
    _require_flag()
    require_steward_or_owner(db, space_id=space_id, user=user)
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ.")
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
    poems = (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == POEM_KIND)
        .all()
    )
    created = 0
    for poem in poems:
        if not has_heritage_tag(poem.tags, identity.id):
            continue
        before = (
            db.query(Keepsake)
            .filter(
                Keepsake.memory_item_id == poem.id,
                Keepsake.identity_id == identity.id,
            )
            .one_or_none()
        )
        row = ensure_keepsake(
            db,
            space_id=space_id,
            identity_id=identity.id,
            memory=poem,
            kind=POEM_KIND,
            status=body.status,
        )
        if before is None:
            created += 1
        elif before.status == "draft" and body.status == "ready":
            row.status = "ready"
    db.commit()
    return {"registered": created, "status": body.status}


class FromMemoryBody(BaseModel):
    identity_id: str
    memory_id: str
    opener: str = Field(default="", max_length=800)
    status: str = Field(default="draft", max_length=16)


@router.post("/spaces/{space_id}/keepsakes/from-memory")
def keepsake_from_memory(
    space_id: str,
    body: FromMemoryBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    _require_flag()
    require_steward_or_owner(db, space_id=space_id, user=user)
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ.")
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
    memory = (
        db.query(MemoryItem)
        .filter(MemoryItem.id == body.memory_id, MemoryItem.space_id == space_id)
        .one_or_none()
    )
    if not memory:
        raise HTTPException(status_code=404, detail="Không tìm thấy ký ức.")
    kind = PHOTO_KIND if memory.kind == "photo" else (
        POEM_KIND if memory.kind == POEM_KIND else None
    )
    if kind is None:
        raise HTTPException(status_code=400, detail="Chỉ ảnh hoặc thơ mới làm hiện vật.")
    opener = body.opener.strip()
    if kind == PHOTO_KIND and not opener:
        from ..services.keepsakes import default_photo_opener

        opener = default_photo_opener(memory.body)
    row = ensure_keepsake(
        db,
        space_id=space_id,
        identity_id=identity.id,
        memory=memory,
        kind=kind,
        opener=opener,
        status=body.status,
    )
    if row.status != body.status:
        row.status = body.status
    if opener and row.opener != opener and kind == PHOTO_KIND:
        row.opener = opener
    db.commit()
    db.refresh(row)
    return {"keepsake": payload(db, row, can_skip=True)}
