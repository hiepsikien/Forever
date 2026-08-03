from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import IdentityProfile, Message, Thread, User
from ..services.heritage import (
    heritage_readiness_payload,
    heritage_thread_title,
    sync_heritage_thread_title,
)
from .messages import preview_body

router = APIRouter(prefix="/api", tags=["threads"])


def _heritage_for_thread(db: Session, thread: Thread) -> dict | None:
    if thread.kind != "heritage":
        return None
    identity = (
        db.query(IdentityProfile)
        .filter(IdentityProfile.heritage_thread_id == thread.id)
        .one_or_none()
    )
    if not identity:
        return None
    expected = heritage_thread_title(identity.display_name, identity.relation_label)
    if thread.title != expected:
        thread.title = expected
        db.commit()
    return heritage_readiness_payload(db, identity=identity)


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
    result = []
    for thread in threads:
        last = (
            db.query(Message)
            .filter(Message.thread_id == thread.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        row = {
            "id": thread.id,
            "space_id": thread.space_id,
            "kind": thread.kind,
            "title": thread.title,
            "created_at": thread.created_at.isoformat(),
            "last_message": (
                {
                    "kind": getattr(last, "kind", None) or "text",
                    "body": preview_body(last),
                    "created_at": last.created_at.isoformat(),
                    "sender_kind": last.sender_kind,
                }
                if last
                else None
            ),
        }
        heritage = _heritage_for_thread(db, thread)
        if heritage:
            row["heritage"] = heritage
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
    require_membership(db, space_id=thread.space_id, user=user)
    payload = {
        "id": thread.id,
        "space_id": thread.space_id,
        "kind": thread.kind,
        "title": thread.title,
        "created_at": thread.created_at.isoformat(),
    }
    heritage = _heritage_for_thread(db, thread)
    if heritage:
        payload["heritage"] = heritage
    return payload
