"""Heritage daily turn quota — hard cap, VN day boundary, heritage-only."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from unittest.mock import patch
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.services import usage_quota as uq
from tests.test_heritage_chat import _login, _ready_heritage, _space

VN = ZoneInfo("Asia/Ho_Chi_Minh")


def test_day_key_and_resets_at_vietnam():
    moment = datetime(2026, 8, 6, 23, 30, tzinfo=VN)
    assert uq.day_key_for(moment) == "2026-08-06"
    assert uq.resets_at_iso("2026-08-06").startswith("2026-08-06T17:00:00")


def test_heritage_quota_hard_cap_and_remind_fields(client: TestClient, monkeypatch):
    monkeypatch.setenv("AGENT_ENABLED", "false")
    from app.config import get_settings

    get_settings.cache_clear()

    space_id, _identity_id, thread_id, headers = _ready_heritage(
        client, email="quota-cap@example.com", name="Steward"
    )

    patched = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "heritage_daily_turn_limit": 2,
            "heritage_warn_remaining": 1,
            "heritage_max_utterance_sec": 45,
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["heritage_daily_turn_limit"] == 2
    assert patched.json()["heritage_max_utterance_sec"] == 45

    me0 = client.get(f"/api/spaces/{space_id}/usage/me", headers=headers)
    assert me0.status_code == 200
    body0 = me0.json()
    assert body0["used"] == 0
    assert body0["limit"] == 2
    assert body0["remaining"] == 2
    assert body0["enabled"] is True
    assert body0["max_utterance_sec"] == 45

    ok1 = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Bố ơi, con chào bố."},
    )
    assert ok1.status_code == 200, ok1.text

    me1 = client.get(f"/api/spaces/{space_id}/usage/me", headers=headers).json()
    assert me1["used"] == 1
    assert me1["remaining"] == 1
    assert me1["warn"] is True

    ok2 = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Bố nhớ mẹ không?"},
    )
    assert ok2.status_code == 200, ok2.text

    blocked = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Lượt thứ ba phải bị chặn."},
    )
    assert blocked.status_code == 429, blocked.text
    # App HTTPException handler unwraps dict detail to the response body.
    detail = blocked.json()
    assert detail["code"] == "quota_exhausted"
    assert detail["used"] == 2
    assert detail["limit"] == 2
    assert detail["remaining"] == 0
    assert "resets_at" in detail

    me2 = client.get(f"/api/spaces/{space_id}/usage/me", headers=headers).json()
    assert me2["used"] == 2
    assert me2["remaining"] == 0

    overview = client.get(f"/api/spaces/{space_id}/usage", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["total_turns"] == 2
    assert len(overview.json()["members"]) == 1

    get_settings.cache_clear()


def test_living_chat_does_not_consume_quota(client: TestClient, monkeypatch):
    monkeypatch.setenv("AGENT_ENABLED", "false")
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "quota-living@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Living only")

    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"heritage_daily_turn_limit": 1},
    )

    threads = client.get(f"/api/spaces/{space_id}/threads", headers=headers).json()
    family = next(t for t in threads["threads"] if t["kind"] == "family")

    for i in range(3):
        res = client.post(
            f"/api/threads/{family['id']}/messages",
            headers=headers,
            json={"body": f"Chào cả nhà lần {i}"},
        )
        assert res.status_code == 200, res.text

    me = client.get(f"/api/spaces/{space_id}/usage/me", headers=headers).json()
    assert me["used"] == 0
    assert me["remaining"] == 1

    get_settings.cache_clear()


def test_quota_disabled_when_limit_zero(client: TestClient, monkeypatch):
    monkeypatch.setenv("AGENT_ENABLED", "false")
    from app.config import get_settings

    get_settings.cache_clear()

    space_id, _identity_id, thread_id, headers = _ready_heritage(
        client, email="quota-off@example.com", name="Steward"
    )
    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"heritage_daily_turn_limit": 0},
    )

    for i in range(3):
        res = client.post(
            f"/api/threads/{thread_id}/messages",
            headers=headers,
            json={"body": f"Tin {i}"},
        )
        assert res.status_code == 200, res.text

    me = client.get(f"/api/spaces/{space_id}/usage/me", headers=headers).json()
    assert me["enabled"] is False
    assert me["used"] == 3
    assert me["remaining"] == -1

    get_settings.cache_clear()


def test_member_cannot_read_space_usage(client: TestClient):
    space_id, _identity_id, _thread_id, owner_h = _ready_heritage(
        client, email="quota-steward@example.com", name="Steward"
    )
    invite = client.post(f"/api/spaces/{space_id}/invites", headers=owner_h).json()
    member_token = _login(client, "quota-member@example.com", "Mẹ")
    member_h = {"Authorization": f"Bearer {member_token}"}
    assert (
        client.post(
            "/api/spaces/join", headers=member_h, json={"code": invite["code"]}
        ).status_code
        == 200
    )

    denied = client.get(f"/api/spaces/{space_id}/usage", headers=member_h)
    assert denied.status_code == 403

    me = client.get(f"/api/spaces/{space_id}/usage/me", headers=member_h)
    assert me.status_code == 200


def test_oversized_voice_rejected_on_heritage(client: TestClient, tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_ENABLED", "false")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    space_id, _identity_id, thread_id, headers = _ready_heritage(
        client, email="quota-voice@example.com", name="Steward"
    )
    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"heritage_max_utterance_sec": 10},
    )

    with patch("app.routers.messages.probe_duration_ms", return_value=60_000):
        res = client.post(
            f"/api/threads/{thread_id}/messages/voice",
            headers=headers,
            files={"file": ("long.m4a", BytesIO(b"fake-audio"), "audio/mp4")},
        )
    assert res.status_code == 400, res.text
    assert "quá dài" in res.json()["error"]

    me = client.get(f"/api/spaces/{space_id}/usage/me", headers=headers).json()
    assert me["used"] == 0

    get_settings.cache_clear()
