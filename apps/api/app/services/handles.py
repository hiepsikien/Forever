from __future__ import annotations

import re
import unicodedata

from sqlalchemy.orm import Session

from ..models import IdentityProfile, User

_HANDLE_RE = re.compile(r"^[a-z0-9_]{2,32}$")


def normalize_handle(raw: str) -> str:
    text = (raw or "").strip().lstrip("@").lower()
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c))
    cleaned = re.sub(r"[^a-z0-9_]+", "", ascii_only.replace(" ", "_"))
    return cleaned[:32]


def is_valid_handle(handle: str) -> bool:
    return bool(_HANDLE_RE.match(handle))


def allocate_handle(db: Session, *, name: str, email: str, preferred: str | None = None) -> str:
    base = normalize_handle(preferred or "") or normalize_handle(name) or normalize_handle(
        email.split("@")[0]
    )
    if not base or len(base) < 2:
        base = "thanhvien"
    candidate = base[:32]
    suffix = 0
    while True:
        exists = db.query(User).filter(User.handle == candidate).one_or_none()
        if not exists:
            return candidate
        suffix += 1
        stem = base[: max(1, 32 - len(str(suffix)) - 1)]
        candidate = f"{stem}{suffix}"


def allocate_identity_handle(
    db: Session,
    *,
    space_id: str,
    display_name: str,
    preferred: str | None = None,
    exclude_identity_id: str | None = None,
) -> str:
    """Space-scoped handle for an IdentityProfile (living or remembered)."""
    base = normalize_handle(preferred or "") or normalize_handle(display_name)
    if not base or len(base) < 2:
        base = "nguoi"
    candidate = base[:32]
    suffix = 0
    while True:
        q = db.query(IdentityProfile).filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.handle == candidate,
        )
        if exclude_identity_id:
            q = q.filter(IdentityProfile.id != exclude_identity_id)
        if not q.one_or_none():
            return candidate
        suffix += 1
        stem = base[: max(1, 32 - len(str(suffix)) - 1)]
        candidate = f"{stem}{suffix}"


def sync_linked_identity_handles(db: Session, user: User) -> None:
    """Living mirrors share the account @handle — one person, one @."""
    handle = (user.handle or "").strip() or None
    if not handle:
        return
    rows = (
        db.query(IdentityProfile)
        .filter(IdentityProfile.linked_user_id == user.id)
        .all()
    )
    for row in rows:
        clash = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.space_id == row.space_id,
                IdentityProfile.handle == handle,
                IdentityProfile.id != row.id,
            )
            .one_or_none()
        )
        if clash:
            row.handle = allocate_identity_handle(
                db,
                space_id=row.space_id,
                display_name=row.display_name,
                preferred=handle,
                exclude_identity_id=row.id,
            )
        else:
            row.handle = handle


def resolve_space_handle(
    db: Session, *, space_id: str, handle: str
) -> tuple[str, IdentityProfile | User]:
    """Return ('identity'|'user', row) for a @handle in this space."""
    normalized = normalize_handle(handle)
    if not normalized or not is_valid_handle(normalized):
        raise ValueError("invalid")

    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.handle == normalized,
            IdentityProfile.archived_at.is_(None),
        )
        .one_or_none()
    )
    if identity:
        return "identity", identity

    user = db.query(User).filter(User.handle == normalized).one_or_none()
    if user:
        linked = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.space_id == space_id,
                IdentityProfile.linked_user_id == user.id,
                IdentityProfile.archived_at.is_(None),
            )
            .one_or_none()
        )
        if linked:
            return "identity", linked
        return "user", user

    raise LookupError(normalized)
