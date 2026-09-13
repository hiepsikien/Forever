"""Phòng Xem nhà — Forever Pro tier + Ezviz stream proxy."""

from __future__ import annotations

from unittest.mock import patch

import pytest


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space(client, headers, name: str) -> str:
    return client.post("/api/spaces", headers=headers, json={"name": name}).json()["id"]


def test_settings_expose_home_camera_defaults(client):
    token = _login(client, "cam-steward@example.com", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà camera")

    data = client.get(f"/api/spaces/{space_id}/settings", headers=headers).json()
    assert data["pro_tier"] is False
    cam = data["home_camera"]
    assert cam["configured"] is False
    assert cam["enabled"] is False
    assert cam["can_view"] is False
    assert cam["room_label"] == "Phòng mẹ"


def test_steward_configures_pro_and_camera(client):
    token = _login(client, "cam-owner@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà Pro")

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "pro_tier": True,
            "home_camera": {
                "enabled": True,
                "device_serial": "G10041709",
                "channel_no": 1,
                "verify_code": "ABC123",
                "room_label": "Phòng khách — mẹ",
                "record_consent": True,
            },
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["pro_tier"] is True
    cam = body["home_camera"]
    assert cam["configured"] is True
    assert cam["enabled"] is True
    assert cam["device_serial_hint"] == "…1709"
    assert cam["verify_code_set"] is True
    assert cam["room_label"] == "Phòng khách — mẹ"
    assert cam["consent_at"]


def test_stream_requires_pro(client):
    token = _login(client, "cam-member@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà chưa Pro")

    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "home_camera": {
                "enabled": True,
                "device_serial": "G10041709",
                "record_consent": True,
            },
        },
    )

    res = client.get(f"/api/spaces/{space_id}/home-camera/stream", headers=headers)
    assert res.status_code == 403


def test_stream_403_without_consent(client):
    token = _login(client, "cam-no-consent@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà chưa đồng ý")

    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "pro_tier": True,
            "home_camera": {
                "enabled": True,
                "device_serial": "G10041709",
            },
        },
    )

    res = client.get(f"/api/spaces/{space_id}/home-camera/stream", headers=headers)
    assert res.status_code == 403
    body = res.json()
    detail = body.get("error") or body.get("detail") or ""
    assert "đồng ý" in str(detail).lower()


@patch("app.routers.home_camera.fetch_live_hls_url")
def test_stream_returns_hls_and_logs_view(mock_live, client):
    mock_live.return_value = {
        "url": "https://open.ys7.com/v3/openlive/G10041709_1_2.m3u8",
        "expire_at": 3600,
    }
    token = _login(client, "cam-live@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà live")

    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "pro_tier": True,
            "home_camera": {
                "enabled": True,
                "device_serial": "G10041709",
                "verify_code": "ABC123",
                "room_label": "Phòng mẹ",
                "record_consent": True,
            },
        },
    )

    with patch("app.routers.home_camera.ezviz_credentials_ready", return_value=True):
        status = client.get(f"/api/spaces/{space_id}/home-camera", headers=headers).json()
        assert status["can_view"] is True

        res = client.get(f"/api/spaces/{space_id}/home-camera/stream", headers=headers)
        assert res.status_code == 200, res.text
        payload = res.json()
        assert payload["url"].endswith(".m3u8")
        assert payload["room_label"] == "Phòng mẹ"


def test_member_cannot_edit_home_camera(client):
    steward = _login(client, "cam-s2@example.com", "Steward")
    s_headers = {"Authorization": f"Bearer {steward}"}
    space_id = _space(client, s_headers, "Nhà có thành viên")
    code = client.post(
        f"/api/spaces/{space_id}/invites", headers=s_headers, json={}
    ).json()["code"]

    member = _login(client, "cam-m@example.com", "Con")
    m_headers = {"Authorization": f"Bearer {member}"}
    client.post("/api/spaces/join", headers=m_headers, json={"code": code})

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=m_headers,
        json={"pro_tier": True},
    )
    assert res.status_code == 403
