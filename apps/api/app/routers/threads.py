from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import require_membership, require_thread_access
from ..auth import get_current_user
from ..db import get_db
from ..models import IdentityProfile, Message, Thread, User
from ..services.heritage import (
    get_or_create_direct_thread,
    heritage_readiness_payload,
    heritage_thread_title,
    identity_for_thread,
    sync_heritage_thread_title,
)
from .messages import preview_body

router = APIRouter(prefix="/api", tags=["threads"])


def _heritage_for_thread(db: Session, thread: Thread) -> dict | None:
    identity = identity_for_thread(db, thread)
    if not identity:
        return None
    expected = heritage_thread_title(identity.display_name, identity.relation_label)
    if thread.title != expected:
        thread.title = expected
        db.commit()
    return heritage_readiness_payload(db, identity=identity)


def _visible_to(thread: Thread, user: User) -> bool:
    if getattr(thread, "audience_scope", "family") != "direct":
        return True
    return thread.member_user_id == user.id


def _thread_payload(db: Session, thread: Thread) -> dict:
    payload = {
        "id": thread.id,
        "space_id": thread.space_id,
        "kind": thread.kind,
        "title": thread.title,
        "audience_scope": getattr(thread, "audience_scope", "family") or "family",
        "member_user_id": getattr(thread, "member_user_id", None),
        "created_at": thread.created_at.isoformat(),
    }
    heritage = _heritage_for_thread(db, thread)
    if heritage:
        payload["heritage"] = heritage
    return payload


@router.get("/spaces/{space_id}/threads")
def list_threads(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    threads = (
        db.query(Thread)
        .filter(Thread.space_id == space_id)
        .order_by(Thread.created_at.asc())
        .all()
    )
    archived_identity_ids = {
        row.id
        for row in db.query(IdentityProfile.id)
        .filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.archived_at.is_not(None),
        )
        .all()
    }
    result = []
    for thread in threads:
        if not _visible_to(thread, user):
            continue
        if getattr(thread, "heritage_identity_id", None) in archived_identity_ids:
            continue
        last = (
            db.query(Message)
            .filter(Message.thread_id == thread.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        row = _thread_payload(db, thread)
        row["last_message"] = (
            {
                "kind": getattr(last, "kind", None) or "text",
                "body": preview_body(last),
                "created_at": last.created_at.isoformat(),
                "sender_kind": last.sender_kind,
            }
            if last
            else None
        )
        result.append(row)
    return {"threads": result}


@router.get("/threads/{thread_id}")
def get_thread(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)
    return _thread_payload(db, thread)


@router.post("/spaces/{space_id}/identities/{identity_id}/direct-thread")
def open_direct_thread(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """The caller's own room with a remembered person, created on first open."""
    require_membership(db, space_id=space_id, user=user)
    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not identity or identity.status != "remembered":
        raise HTTPException(status_code=404, detail="Không tìm thấy thực thể ký ức.")
    thread = get_or_create_direct_thread(db, identity=identity, user_id=user.id)
    return _thread_payload(db, thread)
