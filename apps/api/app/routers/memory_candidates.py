from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import IdentityProfile, MemoryCandidate, Message, Thread, User
from ..services.heritage_candidates import (
    approve,
    candidates_for_reviewer,
    dismiss,
)
from ..services.memory_scope import FAMILY, VISIBILITIES

router = APIRouter(prefix="/api", tags=["memory-candidates"])

_STATUSES = ("pending", "approved", "dismissed")


def _payload(db: Session, row: MemoryCandidate) -> dict:
    identity = (
        db.query(IdentityProfile)
        .filter(IdentityProfile.id == row.identity_id)
        .one_or_none()
    )
    thread = db.query(Thread).filter(Thread.id == row.thread_id).one_or_none()
    source = (
        db.query(Message).filter(Message.id == row.source_message_id).one_or_none()
        if row.source_message_id
        else None
    )
    return {
        "id": row.id,
        "space_id": row.space_id,
        "identity_id": row.identity_id,
        "identity_name": identity.display_name if identity else "",
        "thread_id": row.thread_id,
        # The reviewer needs to know a private room is about to become public.
        "audience_scope": getattr(thread, "audience_scope", "family") or "family",
        "statement": row.statement,
        "fact_kind": row.fact_kind,
        "subject_slug": row.subject_slug,
        "occurred_at": row.occurred_at,
        "status": row.status,
        "source_message_id": row.source_message_id,
        "source_body": (source.body or "") if source else "",
        "memory_item_id": row.memory_item_id,
        "created_at": row.created_at.isoformat(),
    }


def _mine_or_404(db: Session, candidate_id: str, user: User) -> MemoryCandidate:
    row = (
        db.query(MemoryCandidate)
        .filter(MemoryCandidate.id == candidate_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy đề xuất.")
    require_membership(db, space_id=row.space_id, user=user)
    # Only the assigned reviewer, so a private confidence never lands on someone
    # else's desk — being owner or steward does not open this.
    if row.reviewer_user_id != user.id:
        raise HTTPException(
            status_code=403, detail="Đề xuất này thuộc phần duyệt của người khác."
        )
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Đề xuất này đã được xử lý.")
    return row


@router.get("/spaces/{space_id}/memory-candidates")
def list_memory_candidates(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    status: str = Query(default="pending"),
):
    require_membership(db, space_id=space_id, user=user)
    if status not in _STATUSES:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ.")
    rows = candidates_for_reviewer(
        db, space_id=space_id, user_id=user.id, status=status
    )
    return {"candidates": [_payload(db, row) for row in rows]}


class ApproveBody(BaseModel):
    visibility: str = Field(default=FAMILY, max_length=16)


@router.post("/memory-candidates/{candidate_id}/approve")
def approve_memory_candidate(
    candidate_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    body: ApproveBody | None = None,
):
    """Keep the fact — shared with the family, or kept just for the reviewer."""
    row = _mine_or_404(db, candidate_id, user)
    visibility = (body or ApproveBody()).visibility
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400, detail="Visibility không hợp lệ.")
    item = approve(db, candidate=row, user_id=user.id, visibility=visibility)
    return {"candidate": _payload(db, row), "memory_id": item.id}


@router.post("/memory-candidates/{candidate_id}/dismiss")
def dismiss_memory_candidate(
    candidate_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    row = _mine_or_404(db, candidate_id, user)
    dismiss(db, candidate=row, user_id=user.id)
    return {"candidate": _payload(db, row)}
