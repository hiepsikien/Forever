from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import Membership, User


def require_membership(db: Session, *, space_id: str, user: User) -> Membership:
    membership = (
        db.query(Membership)
        .filter(Membership.space_id == space_id, Membership.user_id == user.id)
        .one_or_none()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this family space.")
    return membership


def require_owner(db: Session, *, space_id: str, user: User) -> Membership:
    membership = require_membership(db, space_id=space_id, user=user)
    if membership.role != "owner":
        raise HTTPException(status_code=403, detail="Owner permission required.")
    return membership
