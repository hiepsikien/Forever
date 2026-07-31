from __future__ import annotations

import re
import unicodedata

from sqlalchemy.orm import Session

from ..models import User

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
