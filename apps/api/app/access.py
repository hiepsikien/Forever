from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import FamilySpace, Membership, Thread, User

#: Membership roles, widest authority first.
#:
#: `owner` keeps the house. `moderator` helps decide what is remembered — they
#: approve what the chat heard and tend the memorial pages — but they do not
#: hold the voices or the invites. `member` lives here.
OWNER = "owner"
MODERATOR = "moderator"
MEMBER = "member"
ROLES = (OWNER, MODERATOR, MEMBER)


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


def require_thread_access(db: Session, *, thread: Thread, user: User) -> Membership:
    """Space membership, plus the one-on-one rule.

    A direct heritage thread is a member alone with someone they lost. Nobody
    else in the family reads it — not the owner, not the steward.
    """
    membership = require_membership(db, space_id=thread.space_id, user=user)
    if getattr(thread, "audience_scope", "family") != "direct":
        return membership
    if thread.member_user_id and thread.member_user_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Đây là cuộc trò chuyện riêng của một thành viên khác.",
        )
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
    if space.steward_user_id == user.id or membership.role == OWNER:
        return space
    raise HTTPException(
        status_code=403,
        detail="Chỉ Owner hoặc Steward mới thực hiện được thao tác này.",
    )


def is_steward_or_owner(db: Session, *, space_id: str, user: User) -> bool:
    """Same test as `require_steward_or_owner`, for branching instead of blocking."""
    try:
        require_steward_or_owner(db, space_id=space_id, user=user)
    except HTTPException:
        return False
    return True


def require_moderator_or_above(db: Session, *, space_id: str, user: User) -> Membership:
    """Gate what the family chooses to remember.

    A moderator approves what the chat heard and edits the memorial pages.
    They are trusted with the family's shared record — never with a member's
    private room, which `require_thread_access` and `reviewer_for` still guard.
    """
    membership = require_membership(db, space_id=space_id, user=user)
    space = get_space_or_404(db, space_id)
    if (
        space.steward_user_id == user.id
        or membership.role == OWNER
        or membership.role == MODERATOR
    ):
        return membership
    raise HTTPException(
        status_code=403,
        detail="Chỉ Owner, Steward hoặc Moderator mới thực hiện được thao tác này.",
    )


def is_moderator_or_above(db: Session, *, space_id: str, user: User) -> bool:
    """Same test as `require_moderator_or_above`, for branching instead of blocking."""
    try:
        require_moderator_or_above(db, space_id=space_id, user=user)
    except HTTPException:
        return False
    return True
