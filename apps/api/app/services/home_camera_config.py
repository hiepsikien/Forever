from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..models import SpaceSettings

DEFAULT_ROOM_LABEL = "Phòng mẹ"

CONFIG_KEYS = (
    "enabled",
    "device_serial",
    "channel_no",
    "verify_code",
    "room_label",
    "consent_at",
    "consent_by",
)


def _empty_config() -> dict[str, Any]:
    return {
        "enabled": False,
        "device_serial": "",
        "channel_no": 1,
        "verify_code": "",
        "room_label": DEFAULT_ROOM_LABEL,
        "consent_at": None,
        "consent_by": None,
    }


def load_home_camera_config(row: SpaceSettings | None) -> dict[str, Any]:
    base = _empty_config()
    if not row or not (row.home_camera_json or "").strip():
        return base
    try:
        raw = json.loads(row.home_camera_json)
    except json.JSONDecodeError:
        return base
    if not isinstance(raw, dict):
        return base
    for key in CONFIG_KEYS:
        if key in raw and raw[key] is not None:
            base[key] = raw[key]
    if not isinstance(base["channel_no"], int) or base["channel_no"] < 1:
        base["channel_no"] = 1
    if not isinstance(base["room_label"], str) or not base["room_label"].strip():
        base["room_label"] = DEFAULT_ROOM_LABEL
    return base


def save_home_camera_config(row: SpaceSettings, config: dict[str, Any]) -> None:
    row.home_camera_json = json.dumps(config, ensure_ascii=False)


def apply_home_camera_overrides(
    row: SpaceSettings,
    *,
    enabled: bool | None = None,
    device_serial: str | None = None,
    channel_no: int | None = None,
    verify_code: str | None = None,
    room_label: str | None = None,
    record_consent: bool = False,
    consent_by: str | None = None,
) -> dict[str, Any]:
    config = load_home_camera_config(row)
    if enabled is not None:
        config["enabled"] = enabled
    if device_serial is not None:
        config["device_serial"] = device_serial.strip().upper()
    if channel_no is not None:
        config["channel_no"] = channel_no
    if verify_code is not None:
        cleaned = verify_code.strip()
        if cleaned:
            config["verify_code"] = cleaned
    if room_label is not None:
        cleaned = room_label.strip()
        config["room_label"] = cleaned or DEFAULT_ROOM_LABEL
    if record_consent:
        config["consent_at"] = datetime.now(timezone.utc).isoformat()
        config["consent_by"] = consent_by
    save_home_camera_config(row, config)
    return config


def is_home_camera_configured(config: dict[str, Any]) -> bool:
    serial = (config.get("device_serial") or "").strip()
    return bool(serial)


def home_camera_admin_payload(
    row: SpaceSettings | None,
    *,
    pro_tier: bool,
    server_ready: bool,
) -> dict[str, Any]:
    config = load_home_camera_config(row)
    serial = (config.get("device_serial") or "").strip()
    verify = (config.get("verify_code") or "").strip()
    configured = is_home_camera_configured(config)
    overridden: list[str] = []
    if row and (row.home_camera_json or "").strip():
        overridden = [k for k in CONFIG_KEYS if k in json.loads(row.home_camera_json)]
    return {
        "pro_tier": pro_tier,
        "server_ready": server_ready,
        "configured": configured,
        "enabled": bool(config.get("enabled")),
        "device_serial_hint": f"…{serial[-4:]}" if len(serial) >= 4 else "",
        "verify_code_set": bool(verify),
        "channel_no": int(config.get("channel_no") or 1),
        "room_label": config.get("room_label") or DEFAULT_ROOM_LABEL,
        "consent_at": config.get("consent_at"),
        "can_view": pro_tier and configured and bool(config.get("enabled")) and server_ready,
        "overridden": overridden,
        "note": (
            "Chỉ thành viên nhà xem được. Không ghi hình mặc định — "
            "mẹ phải biết và đồng ý trước khi bật."
        ),
    }


def home_camera_public_payload(
    row: SpaceSettings | None,
    *,
    pro_tier: bool,
    server_ready: bool,
) -> dict[str, Any]:
    admin = home_camera_admin_payload(row, pro_tier=pro_tier, server_ready=server_ready)
    return {
        "pro_tier": admin["pro_tier"],
        "configured": admin["configured"],
        "enabled": admin["enabled"],
        "room_label": admin["room_label"],
        "can_view": admin["can_view"],
        "server_ready": admin["server_ready"],
    }
