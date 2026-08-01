from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import FamilySpace, Membership, User


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


def get_space_or_404(db: Session, space_id: str) -> FamilySpace:
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")
    return space


def require_steward_or_owner(db: Session, *, space_id: str, user: User) -> FamilySpace:
    """Gate heritage / space settings mutations."""
    membership = require_membership(db, space_id=space_id, user=user)
    space = get_space_or_404(db, space_id)
    if space.steward_user_id == user.id or membership.role == "owner":
        return space
    raise HTTPException(
        status_code=403,
        detail="Steward or owner permission required.",
    )
