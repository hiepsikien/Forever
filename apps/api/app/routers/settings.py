from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_steward_or_owner
from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import SpaceSettings, User
from ..services.usage_quota import (
    DEFAULT_DAILY_TURN_LIMIT,
    DEFAULT_MAX_UTTERANCE_SEC,
    DEFAULT_WARN_REMAINING,
    UsagePolicy,
    day_key_for,
    get_policy,
    get_usage,
    list_space_usage_today,
    policy_payload,
    resets_at_iso,
    snapshot_payload,
)

router = APIRouter(prefix="/api/spaces", tags=["settings"])

SELF_CONSENT = (
    "Tôi cho phép Forever tạo bản sao giọng nói của tôi trong không gian "
    "gia đình này để dùng Voice DNA."
)
HERITAGE_CONSENT = (
    "Tôi là người giữ ký ức. Tôi xác nhận có quyền dùng tư liệu giọng này "
    "trong Forever, và hiểu đây là thực thể ký ức — không phải người còn sống."
)


class SettingsUpdateBody(BaseModel):
    elevenlabs_api_key: str | None = Field(default=None, max_length=256)
    heritage_daily_turn_limit: int | None = Field(default=None, ge=0, le=500)
    heritage_warn_remaining: int | None = Field(default=None, ge=0, le=100)
    heritage_max_utterance_sec: int | None = Field(default=None, ge=5, le=300)


def _policy_fields(row: SpaceSettings | None) -> dict:
    if row is None:
        return policy_payload(
            UsagePolicy(
                daily_turn_limit=DEFAULT_DAILY_TURN_LIMIT,
                warn_remaining=DEFAULT_WARN_REMAINING,
                max_utterance_sec=DEFAULT_MAX_UTTERANCE_SEC,
            )
        )
    limit = getattr(row, "heritage_daily_turn_limit", None)
    warn = getattr(row, "heritage_warn_remaining", None)
    utterance = getattr(row, "heritage_max_utterance_sec", None)
    return policy_payload(
        UsagePolicy(
            daily_turn_limit=DEFAULT_DAILY_TURN_LIMIT if limit is None else int(limit),
            warn_remaining=DEFAULT_WARN_REMAINING if warn is None else int(warn),
            max_utterance_sec=(
                DEFAULT_MAX_UTTERANCE_SEC if utterance is None else int(utterance)
            ),
        )
    )


def _settings_payload(row: SpaceSettings | None, *, can_edit: bool) -> dict:
    key = (row.elevenlabs_api_key if row else None) or ""
    env_fallback = bool(get_settings().elevenlabs_api_key.strip())
    hint = ""
    if key:
        hint = f"…{key[-4:]}" if len(key) >= 4 else "••••"
    return {
        "elevenlabs_api_key_set": bool(key) or env_fallback,
        "elevenlabs_api_key_hint": hint if key else ("(server env)" if env_fallback else ""),
        "can_edit": can_edit,
        "consent_self": SELF_CONSENT,
        "consent_heritage": HERITAGE_CONSENT,
        "updated_at": row.updated_at.isoformat() if row else None,
        **_policy_fields(row),
    }


def get_or_create_settings(db: Session, space_id: str) -> SpaceSettings:
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    if row:
        return row
    now = datetime.now(timezone.utc)
    row = SpaceSettings(
        space_id=space_id,
        elevenlabs_api_key=None,
        heritage_daily_turn_limit=DEFAULT_DAILY_TURN_LIMIT,
        heritage_warn_remaining=DEFAULT_WARN_REMAINING,
        heritage_max_utterance_sec=DEFAULT_MAX_UTTERANCE_SEC,
        updated_at=now,
        updated_by=None,
    )
    db.add(row)
    db.flush()
    return row


@router.get("/{space_id}/settings")
def get_settings_route(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    membership = require_membership(db, space_id=space_id, user=user)
    from ..models import FamilySpace

    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")
    can_edit = space.steward_user_id == user.id or membership.role == "owner"
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    return _settings_payload(row, can_edit=can_edit)


@router.patch("/{space_id}/settings")
def update_settings(
    space_id: str,
    body: SettingsUpdateBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = get_or_create_settings(db, space_id)
    if body.elevenlabs_api_key is not None:
        cleaned = body.elevenlabs_api_key.strip()
        row.elevenlabs_api_key = cleaned or None
    if body.heritage_daily_turn_limit is not None:
        row.heritage_daily_turn_limit = body.heritage_daily_turn_limit
    if body.heritage_warn_remaining is not None:
        row.heritage_warn_remaining = body.heritage_warn_remaining
    if body.heritage_max_utterance_sec is not None:
        row.heritage_max_utterance_sec = body.heritage_max_utterance_sec
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = user.id
    db.commit()
    db.refresh(row)
    return _settings_payload(row, can_edit=True)


@router.get("/{space_id}/usage/me")
def get_my_usage(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    return snapshot_payload(get_usage(db, space_id=space_id, user_id=user.id))


@router.get("/{space_id}/usage")
def get_space_usage(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    policy = get_policy(db, space_id)
    members = list_space_usage_today(db, space_id=space_id)
    return {
        "day_key": day_key_for(),
        "resets_at": resets_at_iso(),
        "policy": policy_payload(policy),
        "total_turns": sum(int(m.get("used") or 0) for m in members),
        "total_estimated_tokens": sum(int(m.get("estimated_tokens") or 0) for m in members),
        "members": members,
    }
