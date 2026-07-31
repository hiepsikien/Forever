from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import Message, Thread, User
from .messages import preview_body

router = APIRouter(prefix="/api", tags=["threads"])


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
        result.append(
            {
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
        )
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
    return {
        "id": thread.id,
        "space_id": thread.space_id,
        "kind": thread.kind,
        "title": thread.title,
        "created_at": thread.created_at.isoformat(),
    }
