"""Tầng 2 — hiến chương gia đình sửa được qua Cài đặt, không cần deploy."""

from __future__ import annotations

from app.services.heritage_persona import persona_for
from app.services.heritage_rules_family import (
    DEFAULT_CHARTER_LINES,
    DEFAULT_LIVING_KIN,
    charter_from_data,
    maybe_winddown,
)
from types import SimpleNamespace


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space(client, headers, name: str) -> str:
    return client.post("/api/spaces", headers=headers, json={"name": name}).json()["id"]


def test_settings_expose_the_default_charter(client):
    token = _login(client, "charter-steward@example.com", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà hiến chương")

    data = client.get(f"/api/spaces/{space_id}/settings", headers=headers).json()
    charter = data["family_charter"]
    assert charter["lines"] == list(DEFAULT_CHARTER_LINES)
    assert charter["living_kin"] == DEFAULT_LIVING_KIN
    assert charter["overridden"] == []
    assert charter["defaults"]["lines"] == list(DEFAULT_CHARTER_LINES)


def test_steward_edits_charter_then_resets(client):
    token = _login(client, "charter-owner@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà sửa hiến chương")

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "family_charter": {
                "lines": ["Không nhắc chuyện bệnh cũ của ai."],
                "living_kin": "các bác",
                "spouse_affection_per_day": 0,
            }
        },
    )
    assert res.status_code == 200, res.text
    charter = res.json()["family_charter"]
    assert charter["lines"] == ["Không nhắc chuyện bệnh cũ của ai."]
    assert charter["living_kin"] == "các bác"
    assert charter["spouse_affection_per_day"] == 0
    assert set(charter["overridden"]) == {
        "lines",
        "living_kin",
        "spouse_affection_per_day",
    }

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"family_charter": {"lines": [], "living_kin": ""}},
    )
    charter = res.json()["family_charter"]
    assert charter["lines"] == list(DEFAULT_CHARTER_LINES)
    assert charter["living_kin"] == DEFAULT_LIVING_KIN


def test_charter_rejects_unknown_keys(client):
    token = _login(client, "charter-bad@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers, "Nhà sai khoá")
    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"family_charter": {"khong_co": 1}},
    )
    assert res.status_code == 400


def test_member_cannot_edit_the_charter(client):
    steward = _login(client, "charter-s2@example.com", "Steward")
    s_headers = {"Authorization": f"Bearer {steward}"}
    space_id = _space(client, s_headers, "Nhà có thành viên")
    code = client.post(
        f"/api/spaces/{space_id}/invites", headers=s_headers, json={}
    ).json()["code"]

    member = _login(client, "charter-m@example.com", "Con")
    m_headers = {"Authorization": f"Bearer {member}"}
    client.post("/api/spaces/join", headers=m_headers, json={"code": code})

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=m_headers,
        json={"family_charter": {"living_kin": "ai đó"}},
    )
    assert res.status_code == 403


def test_living_kin_reaches_the_reply():
    """Sửa hiến chương đổi được câu nói ra, không cần deploy."""
    persona = persona_for(
        SimpleNamespace(
            relation_label="Bà Nội",
            display_name="Đoàn Thị Thông",
            address_forms_json="",
            roles_json="",
        )
    )
    charter = charter_from_data({"living_kin": "các bác"})
    body, kind = maybe_winddown(
        "Nhà mình vẫn thế.",
        sitting_turns=8,
        threshold=8,
        persona=persona,
        audience="grandchild",
        charter=charter,
    )
    assert kind == "sitting"
    assert "kể với các bác" in body.lower()
