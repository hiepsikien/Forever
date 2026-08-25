from __future__ import annotations

import threading
import time
from typing import Any

import httpx
from fastapi import HTTPException

from ..config import Settings

_EZVIZ_TOKEN_URL = "https://open.ys7.com/api/lapp/token/get"
_EZVIZ_LIVE_URL = "https://open.ys7.com/api/lapp/v2/live/address/get"

_token_lock = threading.Lock()
_token_cache: dict[str, Any] = {"token": "", "expire_at": 0.0}


def ezviz_credentials_ready(settings: Settings) -> bool:
    return bool(settings.ezviz_app_key.strip() and settings.ezviz_app_secret.strip())


def _parse_ezviz_response(payload: dict[str, Any], *, context: str) -> dict[str, Any]:
    code = str(payload.get("code", ""))
    if code != "200":
        msg = payload.get("msg") or payload.get("message") or "Ezviz API error"
        raise HTTPException(
            status_code=502,
            detail=f"{context}: {msg}",
        )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail=f"{context}: missing data")
    return data


def _get_access_token(settings: Settings) -> str:
    if not ezviz_credentials_ready(settings):
        raise HTTPException(
            status_code=503,
            detail="Ezviz chưa được cấu hình trên server (EZVIZ_APP_KEY / EZVIZ_APP_SECRET).",
        )
    now = time.time()
    with _token_lock:
        cached = _token_cache.get("token") or ""
        expire_at = float(_token_cache.get("expire_at") or 0.0)
        if cached and expire_at - 60 > now:
            return cached

    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.post(
                _EZVIZ_TOKEN_URL,
                data={
                    "appKey": settings.ezviz_app_key.strip(),
                    "appSecret": settings.ezviz_app_secret.strip(),
                },
            )
            res.raise_for_status()
            data = _parse_ezviz_response(res.json(), context="Ezviz token")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ezviz token request failed: {exc}") from exc

    token = str(data.get("accessToken") or "").strip()
    if not token:
        raise HTTPException(status_code=502, detail="Ezviz token missing accessToken")
    expire_ms = data.get("expireTime")
    expire_at = now + 6 * 3600
    if isinstance(expire_ms, (int, float)) and expire_ms > 0:
        expire_at = float(expire_ms) / 1000.0 if expire_ms > 1_000_000_000_000 else float(expire_ms)

    with _token_lock:
        _token_cache["token"] = token
        _token_cache["expire_at"] = expire_at
    return token


def fetch_live_hls_url(
    settings: Settings,
    *,
    device_serial: str,
    channel_no: int,
    verify_code: str = "",
    expire_seconds: int = 3600,
) -> dict[str, Any]:
    """Return a short-lived HLS URL via Ezviz Open Platform."""
    if not settings.home_camera_enabled:
        raise HTTPException(status_code=404, detail="Phòng Xem nhà chưa được bật trên server.")

    token = _get_access_token(settings)
    body: dict[str, Any] = {
        "accessToken": token,
        "deviceSerial": device_serial.strip(),
        "channelNo": max(1, channel_no),
        "protocol": 2,  # HLS
        "quality": 2,  # sub-stream — lighter for mobile
        "expireTime": max(30, min(expire_seconds, 7 * 24 * 3600)),
    }
    code = (verify_code or "").strip()
    if code:
        body["code"] = code

    try:
        with httpx.Client(timeout=25.0) as client:
            res = client.post(_EZVIZ_LIVE_URL, data=body)
            res.raise_for_status()
            data = _parse_ezviz_response(res.json(), context="Ezviz live")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ezviz live request failed: {exc}") from exc

    url = str(data.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=502, detail="Ezviz live missing url")
    return {
        "url": url,
        "expire_at": data.get("expireTime"),
    }
