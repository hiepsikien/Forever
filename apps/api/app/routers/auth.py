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

router = APIRouter(prefix="/api/auth", tags=["auth"])


class DevLoginBody(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
    name: str | None = None


@router.post("/dev-login")
def dev_login(body: DevLoginBody, db: Annotated[Session, Depends(get_db)]):
    settings = get_settings()
    if settings.firebase_enabled or not settings.auth_dev_mode:
        raise HTTPException(
            status_code=404,
            detail="Dev login is disabled when Firebase is configured.",
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
            password_hash=hash_password(password),
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = mint_dev_id_token(
        uid=user.firebase_uid or f"dev-{user.id}",
        email=user.email,
        name=user.name,
    )
    return {"user": session_user(user), "token": token}


@router.get("/me")
def me(user: Annotated[User, Depends(get_current_user)]):
    return session_user(user)
