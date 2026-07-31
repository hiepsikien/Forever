from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_owner
from ..auth import get_current_user
from ..db import get_db
from ..models import FamilySpace, Membership, StewardSuccession, User

router = APIRouter(prefix="/api/spaces", tags=["stewardship"])


class NominateBody(BaseModel):
    user_id: str = Field(min_length=1)
    note: str = Field(default="", max_length=2000)


def _user_brief(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "handle": user.handle,
        "email": user.email,
    }


def _succession_payload(row: StewardSuccession, nominee: User | None, nominator: User | None) -> dict:
    return {
        "id": row.id,
        "space_id": row.space_id,
        "status": row.status,
        "note": row.note,
        "nominee": _user_brief(nominee) if nominee else {"id": row.nominee_user_id},
        "nominated_by": _user_brief(nominator) if nominator else {"id": row.nominated_by},
        "created_at": row.created_at.isoformat(),
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        "activated_at": row.activated_at.isoformat() if row.activated_at else None,
    }


@router.get("/{space_id}/stewardship")
def get_stewardship(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")

    steward = db.query(User).filter(User.id == space.steward_user_id).one_or_none()
    active = (
        db.query(StewardSuccession)
        .filter(
            StewardSuccession.space_id == space_id,
            StewardSuccession.status.in_(("pending", "accepted")),
        )
        .order_by(StewardSuccession.created_at.desc())
        .first()
    )
    nominee = nominator = None
    if active:
        nominee = db.query(User).filter(User.id == active.nominee_user_id).one_or_none()
        nominator = db.query(User).filter(User.id == active.nominated_by).one_or_none()

    return {
        "space_id": space_id,
        "steward": _user_brief(steward) if steward else None,
        "is_steward": space.steward_user_id == user.id,
        "succession": _succession_payload(active, nominee, nominator) if active else None,
    }


@router.post("/{space_id}/stewardship/nominate")
def nominate_successor(
    space_id: str,
    body: NominateBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_owner(db, space_id=space_id, user=user)
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")
    if space.steward_user_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the current steward can nominate a successor.",
        )
    if body.user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot nominate yourself.")

    nominee_membership = (
        db.query(Membership)
        .filter(Membership.space_id == space_id, Membership.user_id == body.user_id)
        .one_or_none()
    )
    if not nominee_membership:
        raise HTTPException(status_code=400, detail="Nominee must already be a family member.")

    existing = (
        db.query(StewardSuccession)
        .filter(
            StewardSuccession.space_id == space_id,
            StewardSuccession.status.in_(("pending", "accepted")),
        )
        .all()
    )
    for row in existing:
        row.status = "revoked"

    now = datetime.now(timezone.utc)
    succession = StewardSuccession(
        id=generate(),
        space_id=space_id,
        nominee_user_id=body.user_id,
        nominated_by=user.id,
        status="pending",
        note=(body.note or "").strip(),
        created_at=now,
        accepted_at=None,
        activated_at=None,
    )
    db.add(succession)
    db.commit()
    db.refresh(succession)
    nominee = db.query(User).filter(User.id == body.user_id).one()
    return _succession_payload(succession, nominee, user)


@router.post("/{space_id}/stewardship/accept")
def accept_succession(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    succession = (
        db.query(StewardSuccession)
        .filter(
            StewardSuccession.space_id == space_id,
            StewardSuccession.nominee_user_id == user.id,
            StewardSuccession.status == "pending",
        )
        .order_by(StewardSuccession.created_at.desc())
        .first()
    )
    if not succession:
        raise HTTPException(status_code=404, detail="No pending nomination for you.")
    succession.status = "accepted"
    succession.accepted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(succession)
    nominator = db.query(User).filter(User.id == succession.nominated_by).one_or_none()
    return _succession_payload(succession, user, nominator)


@router.post("/{space_id}/stewardship/decline")
def decline_succession(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    succession = (
        db.query(StewardSuccession)
        .filter(
            StewardSuccession.space_id == space_id,
            StewardSuccession.nominee_user_id == user.id,
            StewardSuccession.status == "pending",
        )
        .order_by(StewardSuccession.created_at.desc())
        .first()
    )
    if not succession:
        raise HTTPException(status_code=404, detail="No pending nomination for you.")
    succession.status = "declined"
    db.commit()
    db.refresh(succession)
    nominator = db.query(User).filter(User.id == succession.nominated_by).one_or_none()
    return _succession_payload(succession, user, nominator)


@router.post("/{space_id}/stewardship/activate")
def activate_succession(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Nominee (accepted) or current steward can complete handover."""
    require_membership(db, space_id=space_id, user=user)
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")

    succession = (
        db.query(StewardSuccession)
        .filter(
            StewardSuccession.space_id == space_id,
            StewardSuccession.status == "accepted",
        )
        .order_by(StewardSuccession.created_at.desc())
        .first()
    )
    if not succession:
        raise HTTPException(status_code=404, detail="No accepted succession to activate.")

    if user.id not in {succession.nominee_user_id, space.steward_user_id}:
        raise HTTPException(
            status_code=403,
            detail="Only the steward or accepted nominee can activate handover.",
        )

    now = datetime.now(timezone.utc)
    previous_steward_id = space.steward_user_id
    space.steward_user_id = succession.nominee_user_id

    # Promote nominee to owner; demote previous steward to member (still in family).
    nominee_membership = (
        db.query(Membership)
        .filter(
            Membership.space_id == space_id,
            Membership.user_id == succession.nominee_user_id,
        )
        .one()
    )
    nominee_membership.role = "owner"
    prev = (
        db.query(Membership)
        .filter(
            Membership.space_id == space_id,
            Membership.user_id == previous_steward_id,
        )
        .one_or_none()
    )
    if prev and previous_steward_id != succession.nominee_user_id:
        prev.role = "member"

    succession.status = "activated"
    succession.activated_at = now
    db.commit()
    db.refresh(succession)
    nominee = db.query(User).filter(User.id == succession.nominee_user_id).one()
    nominator = db.query(User).filter(User.id == succession.nominated_by).one_or_none()
    return {
        "steward": _user_brief(nominee),
        "succession": _succession_payload(succession, nominee, nominator),
    }


@router.post("/{space_id}/stewardship/revoke")
def revoke_succession(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_owner(db, space_id=space_id, user=user)
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space or space.steward_user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the current steward can revoke.")

    rows = (
        db.query(StewardSuccession)
        .filter(
            StewardSuccession.space_id == space_id,
            StewardSuccession.status.in_(("pending", "accepted")),
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No active succession to revoke.")
    for row in rows:
        row.status = "revoked"
    db.commit()
    return {"ok": True, "revoked": len(rows)}
