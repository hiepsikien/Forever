from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import (
    get_current_user,
    hash_password,
    mint_dev_id_token,
    session_user,
    verify_password,
)
from ..config import get_settings
from ..db import get_db
from ..models import User
from ..services.handles import (
    allocate_handle,
    is_valid_handle,
    normalize_handle,
    sync_linked_identity_handles,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class DevLoginBody(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
    name: str | None = None


class UpdateProfileBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    handle: str | None = Field(default=None, min_length=2, max_length=32)


@router.post("/dev-login")
def dev_login(body: DevLoginBody, db: Annotated[Session, Depends(get_db)]):
    settings = get_settings()
    if not settings.auth_dev_mode:
        raise HTTPException(
            status_code=404,
            detail="Dev login is disabled. Use Firebase Auth.",
        )

    email = body.email.strip().lower()
    password = body.password
    name = (body.name or "").strip() or email.split("@")[0]
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required.")

    user = db.query(User).filter(User.email == email).one_or_none()
    if user and user.password_hash:
        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        uid = user.firebase_uid or f"dev-{user.id}"
        user.firebase_uid = uid
        if name and not user.name:
            user.name = name
        if not user.handle:
            user.handle = allocate_handle(db, name=user.name, email=user.email)
        db.commit()
        db.refresh(user)
    elif user:
        raise HTTPException(
            status_code=401,
            detail="This account has no local password. Use Firebase Auth.",
        )
    else:
        uid = f"dev-{generate()}"
        user = User(
            id=generate(),
            firebase_uid=uid,
            email=email,
            name=name,
            handle=None,
            password_hash=hash_password(password),
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.flush()
        user.handle = allocate_handle(db, name=name, email=email)
        db.commit()
        db.refresh(user)

    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"user": session_user(user), "token": token}


@router.post("/session")
def establish_session(user: Annotated[User, Depends(get_current_user)]):
    """Exchange a Firebase (or dev) Bearer ID token for Forever session profile."""
    return {"user": session_user(user)}


@router.get("/me")
def me(user: Annotated[User, Depends(get_current_user)]):
    return session_user(user)


@router.patch("/me")
def update_me(
    body: UpdateProfileBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if body.name is not None:
        user.name = body.name.strip()
    if body.handle is not None:
        handle = normalize_handle(body.handle)
        if not is_valid_handle(handle):
            raise HTTPException(
                status_code=400,
                detail="Handle must be 2–32 chars: a-z, 0-9, underscore.",
            )
        clash = (
            db.query(User)
            .filter(User.handle == handle, User.id != user.id)
            .one_or_none()
        )
        if clash:
            raise HTTPException(status_code=409, detail="Handle already taken.")
        user.handle = handle
        sync_linked_identity_handles(db, user)
    db.commit()
    db.refresh(user)
    return session_user(user)
