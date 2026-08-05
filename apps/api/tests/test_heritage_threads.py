from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_heritage_chat import _login, _ready_heritage, _space


def _join(client: TestClient, owner_headers: dict, space_id: str, token: str) -> None:
    invite = client.post(
        f"/api/spaces/{space_id}/invites",
        headers=owner_headers,
        json={"role": "member"},
    )
    assert invite.status_code == 200, invite.text
    joined = client.post(
        "/api/spaces/join",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": invite.json()["code"]},
    )
    assert joined.status_code == 200, joined.text


def test_family_heritage_thread_is_linked_to_its_identity(client: TestClient):
    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="threads-family@example.com", name="Con"
    )
    thread = client.get(f"/api/threads/{thread_id}", headers=headers).json()
    assert thread["audience_scope"] == "family"
    assert thread["member_user_id"] is None
    assert thread["heritage"]["identity_id"] == identity_id


def test_direct_thread_is_created_once_per_member(client: TestClient):
    space_id, identity_id, _, headers = _ready_heritage(
        client, email="threads-direct@example.com", name="Con"
    )
    first = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=headers,
    )
    assert first.status_code == 200, first.text
    again = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=headers,
    )
    assert again.json()["id"] == first.json()["id"]
    assert first.json()["audience_scope"] == "direct"
    assert first.json()["heritage"]["chat_ready"] is True


def test_a_direct_thread_stays_private_from_other_members(client: TestClient):
    space_id, identity_id, family_thread_id, headers = _ready_heritage(
        client, email="threads-privacy-owner@example.com", name="Con"
    )
    other_token = _login(client, "threads-privacy-other@example.com", "Chị")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    _join(client, headers, space_id, other_token)

    mine = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=headers,
    ).json()

    # The other member cannot read it, send to it, or even see it listed.
    assert (
        client.get(f"/api/threads/{mine['id']}", headers=other_headers).status_code
        == 403
    )
    blocked = client.post(
        f"/api/threads/{mine['id']}/messages",
        headers=other_headers,
        json={"body": "Cho em đọc với"},
    )
    assert blocked.status_code == 403

    listed = client.get(
        f"/api/spaces/{space_id}/threads", headers=other_headers
    ).json()["threads"]
    ids = {t["id"] for t in listed}
    assert mine["id"] not in ids
    assert family_thread_id in ids

    # And their own direct thread is a different room.
    theirs = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=other_headers,
    ).json()
    assert theirs["id"] != mine["id"]


def test_own_direct_thread_is_listed_for_its_member(client: TestClient):
    space_id, identity_id, _, headers = _ready_heritage(
        client, email="threads-listed@example.com", name="Con"
    )
    mine = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=headers,
    ).json()
    listed = client.get(f"/api/spaces/{space_id}/threads", headers=headers).json()[
        "threads"
    ]
    row = next(t for t in listed if t["id"] == mine["id"])
    assert row["audience_scope"] == "direct"
    assert row["heritage"]["identity_id"] == identity_id


def test_direct_thread_needs_a_remembered_identity(client: TestClient):
    token = _login(client, "threads-living@example.com", "Tôi")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Nhà sống")
    living = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={"display_name": "Mẹ", "relation_label": "Mẹ", "status": "living"},
    )
    assert living.status_code == 200, living.text
    res = client.post(
        f"/api/spaces/{space_id}/identities/{living.json()['id']}/direct-thread",
        headers=headers,
    )
    assert res.status_code == 404
