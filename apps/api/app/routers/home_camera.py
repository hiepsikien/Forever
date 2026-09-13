from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import require_membership, require_pro
from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import HomeCameraViewLog, SpaceSettings, User
from ..routers.settings import get_or_create_settings
from ..services.home_camera_config import (
    home_camera_public_payload,
    is_home_camera_configured,
    load_home_camera_config,
)
from ..services.home_camera_ezviz import (
    ezviz_credentials_ready,
    fetch_live_hls_url,
)

router = APIRouter(prefix="/api/spaces", tags=["home-camera"])


def _pro_tier(row: SpaceSettings | None) -> bool:
    return bool(row and row.pro_tier)


@router.get("/{space_id}/home-camera")
def get_home_camera_status(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    settings = get_settings()
    return home_camera_public_payload(
        row,
        pro_tier=_pro_tier(row),
        server_ready=settings.home_camera_enabled and ezviz_credentials_ready(settings),
    )


@router.get("/{space_id}/home-camera/stream")
def get_home_camera_stream(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    require_pro(db, space_id=space_id)
    row = get_or_create_settings(db, space_id)
    config = load_home_camera_config(row)
    if not config.get("enabled"):
        raise HTTPException(status_code=404, detail="Phòng Xem nhà chưa được bật.")
    if not is_home_camera_configured(config):
        raise HTTPException(status_code=404, detail="Chưa cấu hình camera Ezviz.")
    if not config.get("consent_at"):
        raise HTTPException(
            status_code=403,
            detail="Steward chưa xác nhận đồng ý riêng tư cho camera.",
        )

    settings = get_settings()
    live = fetch_live_hls_url(
        settings,
        device_serial=str(config["device_serial"]),
        channel_no=int(config.get("channel_no") or 1),
        verify_code=str(config.get("verify_code") or ""),
    )

    now = datetime.now(timezone.utc)
    log = HomeCameraViewLog(
        id=uuid4().hex[:24],
        space_id=space_id,
        user_id=user.id,
        opened_at=now,
    )
    db.add(log)
    db.commit()

    return {
        "url": live["url"],
        "expires_at": live.get("expire_at"),
        "room_label": config.get("room_label"),
    }
