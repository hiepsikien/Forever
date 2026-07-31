from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from nanoid import generate
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

_firebase_app = None


@dataclass(frozen=True)
class TokenClaims:
    uid: str
    email: str
    name: str


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    return pwd_context.verify(password, password_hash)


def _init_firebase() -> Any | None:
    global _firebase_app
    settings = get_settings()
    if not settings.firebase_enabled:
        return None
    if _firebase_app is not None:
        return _firebase_app

    import firebase_admin
    from firebase_admin import credentials

    if firebase_admin._apps:
        _firebase_app = firebase_admin.get_app()
        return _firebase_app

    cred: credentials.Base
    raw = settings.firebase_credentials_json.strip()
    if raw:
        if raw.startswith("{"):
            cred = credentials.Certificate(json.loads(raw))
        else:
            cred = credentials.Certificate(raw)
    else:
        cred = credentials.ApplicationDefault()

    _firebase_app = firebase_admin.initialize_app(
        cred, {"projectId": settings.firebase_project_id}
    )
    return _firebase_app


def verify_id_token(token: str) -> TokenClaims:
    settings = get_settings()
    if settings.firebase_enabled:
        _init_firebase()
        from firebase_admin import auth as firebase_auth

        try:
            decoded = firebase_auth.verify_id_token(token)
        except Exception as exc:
            raise HTTPException(
                status_code=401, detail="Invalid or expired session."
            ) from exc
        email = (decoded.get("email") or "").strip().lower()
        if not email:
            raise HTTPException(status_code=401, detail="Authenticated email is required.")
        name = (decoded.get("name") or "").strip() or email.split("@")[0]
        return TokenClaims(uid=str(decoded["uid"]), email=email, name=name)

    if not settings.auth_dev_mode:
        raise HTTPException(
            status_code=503,
            detail="Firebase is not configured. Set FIREBASE_PROJECT_ID or AUTH_DEV_MODE=true.",
        )

    try:
        payload = jwt.decode(
            token,
            settings.auth_dev_secret,
            algorithms=["HS256"],
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session.") from exc

    uid = str(payload.get("uid") or payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    name = str(payload.get("name") or "").strip() or (email.split("@")[0] if email else "Member")
    if not uid or not email:
        raise HTTPException(status_code=401, detail="Invalid session claims.")
    return TokenClaims(uid=uid, email=email, name=name)


def mint_dev_id_token(*, uid: str, email: str, name: str) -> str:
    settings = get_settings()
    if not settings.auth_dev_mode:
        raise RuntimeError("Dev tokens are disabled.")
    expire = datetime.now(timezone.utc) + timedelta(days=14)
    return jwt.encode(
        {
            "uid": uid,
            "sub": uid,
            "email": email.lower(),
            "name": name,
            "exp": expire,
        },
        settings.auth_dev_secret,
        algorithm="HS256",
    )


def upsert_user_from_claims(db: Session, claims: TokenClaims) -> User:
    user = (
        db.query(User).filter(User.firebase_uid == claims.uid).one_or_none()
        or db.query(User).filter(User.email == claims.email).one_or_none()
    )
    now = datetime.now(timezone.utc)
    if user is None:
        user = User(
            id=generate(),
            firebase_uid=claims.uid,
            email=claims.email,
            name=claims.name,
            password_hash=None,
            created_at=now,
        )
        db.add(user)
    else:
        user.firebase_uid = claims.uid
        user.email = claims.email
        if claims.name:
            user.name = claims.name
    db.commit()
    db.refresh(user)
    return user


def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    if not credentials:
        return None
    try:
        claims = verify_id_token(credentials.credentials)
    except HTTPException:
        return None
    return upsert_user_from_claims(db, claims)


def get_current_user(
    user: Annotated[User | None, Depends(get_current_user_optional)],
) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in.")
    return user


def session_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
    }
