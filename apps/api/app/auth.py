from __future__ import annotations

import json
import threading
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
from .services.handles import allocate_handle

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

_firebase_app = None
_firebase_lock = threading.Lock()


@dataclass(frozen=True)
class TokenClaims:
    uid: str
    email: str
    name: str
    phone: str | None = None
    # False when `name` is only a fallback derived from the email or phone.
    # Email/password accounts usually carry no display name, and overwriting a
    # carefully chosen "Mẹ" with "hongdinh" on every sign-in is not acceptable.
    has_display_name: bool = False


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    return pwd_context.verify(password, password_hash)


def _init_firebase() -> Any | None:
    """Idempotent: uvicorn --reload and concurrent requests must not double-init."""
    global _firebase_app
    settings = get_settings()
    if not settings.firebase_enabled:
        return None
    if _firebase_app is not None:
        return _firebase_app

    import firebase_admin
    from firebase_admin import credentials

    with _firebase_lock:
        if _firebase_app is not None:
            return _firebase_app
        try:
            _firebase_app = firebase_admin.get_app()
            return _firebase_app
        except ValueError:
            pass

        cred: credentials.Base
        raw = settings.firebase_credentials_json.strip()
        if raw:
            if raw.startswith("{"):
                cred = credentials.Certificate(json.loads(raw))
            else:
                cred = credentials.Certificate(raw)
        else:
            cred = credentials.ApplicationDefault()

        try:
            _firebase_app = firebase_admin.initialize_app(
                cred, {"projectId": settings.firebase_project_id}
            )
        except ValueError:
            # Another thread (or a previous reload in-process) won the race.
            _firebase_app = firebase_admin.get_app()
        return _firebase_app


def verify_id_token(token: str) -> TokenClaims:
    settings = get_settings()
    if settings.firebase_enabled:
        try:
            return _verify_firebase_token(token)
        except HTTPException:
            if not settings.auth_dev_mode:
                raise

    if settings.auth_dev_mode:
        return _verify_dev_token(token)

    raise HTTPException(
        status_code=503,
        detail="Firebase is not configured. Set FIREBASE_PROJECT_ID or AUTH_DEV_MODE=true.",
    )


def _verify_firebase_token(token: str) -> TokenClaims:
    _init_firebase()
    from firebase_admin import auth as firebase_auth

    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=401, detail="Invalid or expired session."
        ) from exc
    uid = str(decoded["uid"])
    phone = (decoded.get("phone_number") or "").strip() or None
    email = (decoded.get("email") or "").strip().lower()
    if not email:
        if phone:
            email = f"phone.{uid}@forever.users"
        else:
            raise HTTPException(
                status_code=401,
                detail="Authenticated email or phone is required.",
            )
    display_name = (decoded.get("name") or "").strip()
    name = display_name or (phone or email.split("@")[0])
    return TokenClaims(
        uid=uid,
        email=email,
        name=name,
        phone=phone,
        has_display_name=bool(display_name),
    )


def _verify_dev_token(token: str) -> TokenClaims:
    settings = get_settings()
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
    display_name = str(payload.get("name") or "").strip()
    name = display_name or (email.split("@")[0] if email else "Member")
    phone = str(payload.get("phone") or "").strip() or None
    if not uid or not email:
        raise HTTPException(status_code=401, detail="Invalid session claims.")
    return TokenClaims(
        uid=uid,
        email=email,
        name=name,
        phone=phone,
        has_display_name=bool(display_name),
    )


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
        or (
            db.query(User).filter(User.phone == claims.phone).one_or_none()
            if claims.phone
            else None
        )
        or db.query(User).filter(User.email == claims.email).one_or_none()
    )
    now = datetime.now(timezone.utc)
    if user is None:
        user = User(
            id=generate(),
            firebase_uid=claims.uid,
            email=claims.email,
            phone=claims.phone,
            name=claims.name,
            handle=None,
            password_hash=None,
            created_at=now,
        )
        db.add(user)
        db.flush()
        user.handle = allocate_handle(db, name=claims.name, email=claims.email)
    else:
        user.firebase_uid = claims.uid
        user.email = claims.email
        if claims.phone:
            user.phone = claims.phone
        if claims.has_display_name and claims.name:
            user.name = claims.name
        if not user.handle:
            user.handle = allocate_handle(db, name=user.name, email=user.email)
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
        "phone": user.phone,
        "name": user.name,
        "handle": user.handle,
    }
