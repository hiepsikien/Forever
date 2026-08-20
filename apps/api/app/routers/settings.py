from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_steward_or_owner
from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import SpaceSettings, User
from ..services.heritage_pipeline import (
    LLM_MODEL_KEYS,
    PIPELINE_FLAG_KEYS,
    apply_pipeline_overrides,
    pipeline_admin_payload,
)
from ..services.heritage_rules_family import (
    apply_charter_overrides,
    charter_admin_payload,
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
    # Flat flag map (legacy) or { flags, models }.
    heritage_pipeline: dict[str, Any] | None = None
    # Tầng 2 — { lines, living_kin, spouse_affection_per_day }.
    family_charter: dict[str, Any] | None = None


def _split_pipeline_update(
    raw: dict[str, Any],
) -> tuple[dict[str, bool | None] | None, dict[str, str | None] | None]:
    """Accept legacy flat bools or {flags, models}."""
    if "flags" in raw or "models" in raw:
        flags = raw.get("flags")
        models = raw.get("models")
        if flags is not None and not isinstance(flags, dict):
            raise HTTPException(status_code=400, detail="heritage_pipeline.flags must be an object.")
        if models is not None and not isinstance(models, dict):
            raise HTTPException(status_code=400, detail="heritage_pipeline.models must be an object.")
        return flags, models

    # Legacy: { "analyzer": true, "stt": false }
    flags: dict[str, bool | None] = {}
    for key, value in raw.items():
        if key not in PIPELINE_FLAG_KEYS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown heritage_pipeline key: {key}",
            )
        if value is not None and not isinstance(value, bool):
            raise HTTPException(
                status_code=400,
                detail=f"heritage_pipeline.{key} must be boolean or null.",
            )
        flags[key] = value
    return flags or None, None


def _settings_payload(db: Session, row: SpaceSettings | None, *, can_edit: bool, space_id: str) -> dict:
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
        "heritage_pipeline": pipeline_admin_payload(db, space_id),
        "family_charter": charter_admin_payload(db, space_id),
    }


def get_or_create_settings(db: Session, space_id: str) -> SpaceSettings:
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    if row:
        return row
    now = datetime.now(timezone.utc)
    row = SpaceSettings(
        space_id=space_id,
        elevenlabs_api_key=None,
        heritage_pipeline_json="",
        family_charter_json="",
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
    return _settings_payload(db, row, can_edit=can_edit, space_id=space_id)


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
    if body.heritage_pipeline is not None:
        flags, models = _split_pipeline_update(body.heritage_pipeline)
        if models:
            unknown = [k for k in models if k not in LLM_MODEL_KEYS]
            if unknown:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown heritage_pipeline.models keys: {', '.join(unknown)}",
                )
        try:
            apply_pipeline_overrides(row, flags=flags, models=models)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.family_charter is not None:
        raw = body.family_charter
        unknown = [
            k
            for k in raw
            if k not in ("lines", "living_kin", "spouse_affection_per_day")
        ]
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown family_charter keys: {', '.join(unknown)}",
            )
        lines = raw.get("lines")
        if lines is not None and (
            not isinstance(lines, list)
            or any(not isinstance(line, str) for line in lines)
        ):
            raise HTTPException(
                status_code=400, detail="family_charter.lines must be a list of strings."
            )
        kin = raw.get("living_kin")
        if kin is not None and not isinstance(kin, str):
            raise HTTPException(
                status_code=400, detail="family_charter.living_kin must be a string."
            )
        per_day = raw.get("spouse_affection_per_day")
        if per_day is not None and (
            not isinstance(per_day, int) or isinstance(per_day, bool)
        ):
            raise HTTPException(
                status_code=400,
                detail="family_charter.spouse_affection_per_day must be an integer.",
            )
        try:
            apply_charter_overrides(
                row, lines=lines, living_kin=kin, spouse_affection_per_day=per_day
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = user.id
    db.commit()
    db.refresh(row)
    return _settings_payload(db, row, can_edit=True, space_id=space_id)
