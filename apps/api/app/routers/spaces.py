from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_owner
from ..auth import get_current_user
from ..db import get_db
from ..models import FamilySpace, Invite, Membership, Thread, User

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


class CreateSpaceBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class JoinBody(BaseModel):
    code: str = Field(min_length=4, max_length=32)


def _space_payload(space: FamilySpace, role: str, member_count: int) -> dict:
    return {
        "id": space.id,
        "name": space.name,
        "role": role,
        "member_count": member_count,
        "steward_user_id": space.steward_user_id,
        "created_at": space.created_at.isoformat(),
    }


@router.get("")
def list_spaces(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = (
        db.query(Membership, FamilySpace)
        .join(FamilySpace, FamilySpace.id == Membership.space_id)
        .filter(Membership.user_id == user.id)
        .order_by(FamilySpace.created_at.desc())
        .all()
    )
    result = []
    for membership, space in rows:
        count = db.query(Membership).filter(Membership.space_id == space.id).count()
        result.append(_space_payload(space, membership.role, count))
    return {"spaces": result}


@router.post("")
def create_space(
    body: CreateSpaceBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    now = datetime.now(timezone.utc)
    space = FamilySpace(
        id=generate(),
        name=body.name.strip(),
        created_by=user.id,
        steward_user_id=user.id,
        created_at=now,
    )
    db.add(space)
    db.flush()
    db.add(
        Membership(
            id=generate(),
            space_id=space.id,
            user_id=user.id,
            role="owner",
            joined_at=now,
        )
    )
    db.add(
        Thread(
            id=generate(),
            space_id=space.id,
            kind="family",
            title="Phòng khách",
            created_at=now,
        )
    )
    db.commit()
    db.refresh(space)
    return _space_payload(space, "owner", 1)


@router.get("/{space_id}")
def get_space(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    membership = require_membership(db, space_id=space_id, user=user)
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")
    count = db.query(Membership).filter(Membership.space_id == space.id).count()
    members = (
        db.query(Membership, User)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.space_id == space.id)
        .all()
    )
    return {
        **_space_payload(space, membership.role, count),
        "members": [
            {
                "id": member.id,
                "name": member.name,
                "email": member.email,
                "role": m.role,
            }
            for m, member in members
        ],
    }


@router.post("/{space_id}/invites")
def create_invite(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_owner(db, space_id=space_id, user=user)
    now = datetime.now(timezone.utc)
    invite = Invite(
        id=generate(),
        space_id=space_id,
        code=generate(size=8).upper(),
        created_by=user.id,
        expires_at=now + timedelta(days=14),
        created_at=now,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return {
        "id": invite.id,
        "code": invite.code,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
    }


@router.post("/join")
def join_space(
    body: JoinBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    code = body.code.strip().upper()
    invite = db.query(Invite).filter(Invite.code == code).one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite code not found.")
    if invite.expires_at is not None:
        expires = invite.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Invite code has expired.")

    existing = (
        db.query(Membership)
        .filter(Membership.space_id == invite.space_id, Membership.user_id == user.id)
        .one_or_none()
    )
    space = db.query(FamilySpace).filter(FamilySpace.id == invite.space_id).one()
    if existing:
        count = db.query(Membership).filter(Membership.space_id == space.id).count()
        return _space_payload(space, existing.role, count)

    membership = Membership(
        id=generate(),
        space_id=invite.space_id,
        user_id=user.id,
        role="member",
        joined_at=datetime.now(timezone.utc),
    )
    db.add(membership)
    db.commit()
    count = db.query(Membership).filter(Membership.space_id == space.id).count()
    return _space_payload(space, "member", count)
