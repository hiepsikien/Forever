"""Heritage turn quota — steward policy, per-member daily counters.

A "turn" is one user message on a heritage thread (text or voice). Living
family chat is out of scope. Token estimates are a steward meter only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from nanoid import generate
from sqlalchemy.orm import Session

from ..models import SpaceSettings, UsageCounter, User

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

DEFAULT_DAILY_TURN_LIMIT = 20
DEFAULT_WARN_REMAINING = 3
DEFAULT_MAX_UTTERANCE_SEC = 60

QUOTA_EXHAUSTED_MESSAGE = "Hôm nay đã nói đủ rồi. Mai gặp lại nhé."
QUOTA_EXHAUSTED_CODE = "quota_exhausted"


@dataclass(frozen=True)
class UsagePolicy:
    daily_turn_limit: int
    warn_remaining: int
    max_utterance_sec: int

    @property
    def enabled(self) -> bool:
        return self.daily_turn_limit > 0


@dataclass(frozen=True)
class UsageSnapshot:
    space_id: str
    user_id: str
    day_key: str
    used: int
    limit: int
    remaining: int
    warn: bool
    warn_remaining: int
    max_utterance_sec: int
    estimated_tokens: int
    resets_at: str
    enabled: bool


def vietnam_now() -> datetime:
    return datetime.now(VN_TZ)


def day_key_for(when: datetime | None = None) -> str:
    moment = when.astimezone(VN_TZ) if when else vietnam_now()
    return moment.date().isoformat()


def resets_at_iso(day_key: str | None = None) -> str:
    """Next midnight Asia/Ho_Chi_Minh after the given (or current) day_key."""
    key = day_key or day_key_for()
    year, month, day = (int(p) for p in key.split("-"))
    start = datetime(year, month, day, tzinfo=VN_TZ)
    nxt = start + timedelta(days=1)
    return nxt.astimezone(timezone.utc).isoformat()


def get_policy(db: Session, space_id: str) -> UsagePolicy:
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    if not row:
        return UsagePolicy(
            daily_turn_limit=DEFAULT_DAILY_TURN_LIMIT,
            warn_remaining=DEFAULT_WARN_REMAINING,
            max_utterance_sec=DEFAULT_MAX_UTTERANCE_SEC,
        )
    limit = getattr(row, "heritage_daily_turn_limit", None)
    warn = getattr(row, "heritage_warn_remaining", None)
    utterance = getattr(row, "heritage_max_utterance_sec", None)
    return UsagePolicy(
        daily_turn_limit=DEFAULT_DAILY_TURN_LIMIT if limit is None else int(limit),
        warn_remaining=DEFAULT_WARN_REMAINING if warn is None else max(0, int(warn)),
        max_utterance_sec=(
            DEFAULT_MAX_UTTERANCE_SEC if utterance is None else max(5, int(utterance))
        ),
    )


def _get_or_create_counter(
    db: Session, *, space_id: str, user_id: str, day_key: str
) -> UsageCounter:
    row = (
        db.query(UsageCounter)
        .filter(
            UsageCounter.space_id == space_id,
            UsageCounter.user_id == user_id,
            UsageCounter.day_key == day_key,
        )
        .one_or_none()
    )
    if row:
        return row
    now = datetime.now(timezone.utc)
    row = UsageCounter(
        id=generate(),
        space_id=space_id,
        user_id=user_id,
        day_key=day_key,
        heritage_turns=0,
        estimated_tokens=0,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def _snapshot(
    *,
    space_id: str,
    user_id: str,
    day_key: str,
    used: int,
    policy: UsagePolicy,
    estimated_tokens: int,
) -> UsageSnapshot:
    if not policy.enabled:
        remaining = -1
        warn = False
    else:
        remaining = max(0, policy.daily_turn_limit - used)
        warn = remaining <= policy.warn_remaining
    return UsageSnapshot(
        space_id=space_id,
        user_id=user_id,
        day_key=day_key,
        used=used,
        limit=policy.daily_turn_limit,
        remaining=remaining,
        warn=warn,
        warn_remaining=policy.warn_remaining,
        max_utterance_sec=policy.max_utterance_sec,
        estimated_tokens=estimated_tokens,
        resets_at=resets_at_iso(day_key),
        enabled=policy.enabled,
    )


def get_usage(
    db: Session, *, space_id: str, user_id: str, day_key: str | None = None
) -> UsageSnapshot:
    key = day_key or day_key_for()
    policy = get_policy(db, space_id)
    row = (
        db.query(UsageCounter)
        .filter(
            UsageCounter.space_id == space_id,
            UsageCounter.user_id == user_id,
            UsageCounter.day_key == key,
        )
        .one_or_none()
    )
    used = int(row.heritage_turns) if row else 0
    tokens = int(row.estimated_tokens) if row else 0
    return _snapshot(
        space_id=space_id,
        user_id=user_id,
        day_key=key,
        used=used,
        policy=policy,
        estimated_tokens=tokens,
    )


def snapshot_payload(snap: UsageSnapshot) -> dict[str, Any]:
    return {
        "space_id": snap.space_id,
        "user_id": snap.user_id,
        "day_key": snap.day_key,
        "used": snap.used,
        "limit": snap.limit,
        "remaining": snap.remaining,
        "warn": snap.warn,
        "warn_remaining": snap.warn_remaining,
        "max_utterance_sec": snap.max_utterance_sec,
        "estimated_tokens": snap.estimated_tokens,
        "resets_at": snap.resets_at,
        "enabled": snap.enabled,
    }


def exhausted_detail(snap: UsageSnapshot) -> dict[str, Any]:
    return {
        "code": QUOTA_EXHAUSTED_CODE,
        "error": QUOTA_EXHAUSTED_MESSAGE,
        "message": QUOTA_EXHAUSTED_MESSAGE,
        "used": snap.used,
        "limit": snap.limit,
        "remaining": 0,
        "resets_at": snap.resets_at,
    }


def assert_can_spend_turn(
    db: Session, *, space_id: str, user_id: str
) -> UsageSnapshot:
    """Raise 429 if this member has no heritage turns left today."""
    snap = get_usage(db, space_id=space_id, user_id=user_id)
    if not snap.enabled:
        return snap
    if snap.used >= snap.limit:
        raise HTTPException(status_code=429, detail=exhausted_detail(snap))
    return snap


def record_heritage_turn(
    db: Session, *, space_id: str, user_id: str, day_key: str | None = None
) -> UsageSnapshot:
    """Increment heritage turn count for today. Call after the message is staged."""
    key = day_key or day_key_for()
    policy = get_policy(db, space_id)
    row = _get_or_create_counter(db, space_id=space_id, user_id=user_id, day_key=key)
    row.heritage_turns = int(row.heritage_turns or 0) + 1
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.flush()
    return _snapshot(
        space_id=space_id,
        user_id=user_id,
        day_key=key,
        used=int(row.heritage_turns),
        policy=policy,
        estimated_tokens=int(row.estimated_tokens or 0),
    )


def add_tokens(
    db: Session,
    *,
    space_id: str,
    user_id: str,
    tokens: int,
    day_key: str | None = None,
) -> None:
    """Best-effort token meter for steward dashboards. Never raises into chat."""
    if tokens <= 0 or not user_id:
        return
    try:
        key = day_key or day_key_for()
        row = _get_or_create_counter(db, space_id=space_id, user_id=user_id, day_key=key)
        row.estimated_tokens = int(row.estimated_tokens or 0) + int(tokens)
        row.updated_at = datetime.now(timezone.utc)
        db.add(row)
        db.flush()
    except Exception:
        return


def estimate_turn_tokens(
    *,
    user_body: str = "",
    reply_body: str = "",
    stt_meta: dict | None = None,
    tts_meta: dict | None = None,
    heritage_meta: dict | None = None,
) -> int:
    """Rough token cost for one heritage exchange — not billing-grade."""
    total = 0
    user_chars = len((user_body or "").strip())
    reply_chars = len((reply_body or "").strip())
    if stt_meta:
        stt_chars = int(stt_meta.get("chars") or user_chars or 0)
        total += max(800, stt_chars + 600)
    else:
        total += max(50, user_chars // 2)
    frame = (heritage_meta or {}).get("context_frame") or {}
    max_out = int(frame.get("max_output_tokens") or 0) if isinstance(frame, dict) else 0
    total += 2500 + max(reply_chars, max_out // 2 if max_out else reply_chars)
    if tts_meta:
        tts_chars = int(tts_meta.get("chars") or reply_chars or 0)
        total += max(0, tts_chars)
    return max(0, total)


def list_space_usage_today(
    db: Session, *, space_id: str, day_key: str | None = None
) -> list[dict[str, Any]]:
    key = day_key or day_key_for()
    policy = get_policy(db, space_id)
    rows = (
        db.query(UsageCounter)
        .filter(UsageCounter.space_id == space_id, UsageCounter.day_key == key)
        .all()
    )
    user_ids = {r.user_id for r in rows}
    names: dict[str, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            names[u.id] = u.name
    out: list[dict[str, Any]] = []
    for row in rows:
        snap = _snapshot(
            space_id=space_id,
            user_id=row.user_id,
            day_key=key,
            used=int(row.heritage_turns or 0),
            policy=policy,
            estimated_tokens=int(row.estimated_tokens or 0),
        )
        payload = snapshot_payload(snap)
        payload["user_name"] = names.get(row.user_id) or ""
        out.append(payload)
    out.sort(key=lambda item: (-int(item["used"]), str(item.get("user_name") or "")))
    return out


def policy_payload(policy: UsagePolicy) -> dict[str, Any]:
    return {
        "heritage_daily_turn_limit": policy.daily_turn_limit,
        "heritage_warn_remaining": policy.warn_remaining,
        "heritage_max_utterance_sec": policy.max_utterance_sec,
    }
