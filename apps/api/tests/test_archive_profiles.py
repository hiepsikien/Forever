"""Shelving a person hides them everywhere without losing anything."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_heritage_chat import _login, _ready_heritage, _space
from tests.test_heritage_threads import _join


def _identity(client: TestClient, headers: dict, space_id: str, name: str) -> str:
    res = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={"display_name": name, "relation_label": "Chị", "status": "remembered"},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_archived_identity_disappears_from_the_default_list(client: TestClient):
    token = _login(client, "arch-owner@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Nhà lưu trữ")
    identity_id = _identity(client, headers, space_id, "Hồ sơ thử")

    archived = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/archive", headers=headers
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None

    default = client.get(
        f"/api/spaces/{space_id}/identities", headers=headers
    ).json()["identities"]
    assert identity_id not in {i["id"] for i in default}

    everything = client.get(
        f"/api/spaces/{space_id}/identities?include_archived=true", headers=headers
    ).json()["identities"]
    assert identity_id in {i["id"] for i in everything}


def test_archiving_hides_the_heritage_thread_too(client: TestClient):
    token = _login(client, "arch-thread@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Nhà ẩn phòng")
    created = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={"display_name": "Bác thử", "relation_label": "Bác", "status": "remembered"},
    ).json()
    thread_id = created["heritage_thread_id"]

    before = client.get(f"/api/spaces/{space_id}/threads", headers=headers).json()
    assert thread_id in {t["id"] for t in before["threads"]}

    client.post(
        f"/api/spaces/{space_id}/identities/{created['id']}/archive", headers=headers
    )

    after = client.get(f"/api/spaces/{space_id}/threads", headers=headers).json()
    assert thread_id not in {t["id"] for t in after["threads"]}


def test_unarchive_brings_the_person_and_their_voice_back(client: TestClient):
    space_id, identity_id, _, headers = _ready_heritage(
        client, email="arch-restore@example.com", name="Con", display_name="Bố thử"
    )
    # A ready entity must be paused first — archiving it live would silence it.
    client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/pause-heritage",
        headers=headers,
    )
    client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/archive", headers=headers
    )

    voices = client.get(f"/api/spaces/{space_id}/voices", headers=headers).json()
    assert identity_id not in {v["identity_profile_id"] for v in voices["voices"]}

    restored = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/unarchive", headers=headers
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived_at"] is None

    voices_again = client.get(f"/api/spaces/{space_id}/voices", headers=headers).json()
    assert identity_id in {v["identity_profile_id"] for v in voices_again["voices"]}


def test_a_live_heritage_entity_must_be_paused_before_archiving(client: TestClient):
    space_id, identity_id, _, headers = _ready_heritage(
        client, email="arch-live@example.com", name="Con", display_name="Bố sống"
    )
    blocked = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/archive", headers=headers
    )
    assert blocked.status_code == 400


def test_a_members_own_profile_cannot_be_archived(client: TestClient):
    token = _login(client, "arch-self@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Nhà của tôi")
    mine = client.get(f"/api/spaces/{space_id}/identities", headers=headers).json()
    self_id = next(i["id"] for i in mine["identities"] if i["linked_user_id"])

    blocked = client.post(
        f"/api/spaces/{space_id}/identities/{self_id}/archive", headers=headers
    )
    assert blocked.status_code == 400


def test_a_plain_member_cannot_archive_anyone(client: TestClient):
    owner_token = _login(client, "arch-guard-owner@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Nhà khoá lưu trữ")
    identity_id = _identity(client, owner_headers, space_id, "Hồ sơ khoá")

    member_token = _login(client, "arch-guard-member@example.com", "Chị")
    _join(client, owner_headers, space_id, member_token)

    blocked = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/archive",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert blocked.status_code == 403
