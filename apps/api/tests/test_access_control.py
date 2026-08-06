"""The gates that decide who may read, keep, and remove.

These cover the boundaries a family would never forgive us for getting wrong:
a private room staying private, a fact only its own reviewer may approve, and
an owner who cannot quietly delete the steward.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.services.heritage_candidates import reviewer_for
from app.services.memory_scope import PRIVATE, reader_for_thread, visible_to
from app.models import MemoryItem, Thread
from tests.test_heritage_chat import _login, _ready_heritage, _space
from tests.test_heritage_threads import _join


# --- a direct thread belongs to one member ---


def test_steward_cannot_read_a_members_private_thread(client: TestClient):
    """The steward runs the house but is not a witness to every conversation."""
    space_id, identity_id, _, steward_headers = _ready_heritage(
        client, email="ac-steward@example.com", name="Con"
    )
    member_token = _login(client, "ac-member@example.com", "Mẹ")
    member_headers = {"Authorization": f"Bearer {member_token}"}
    _join(client, steward_headers, space_id, member_token)

    private = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=member_headers,
    )
    assert private.status_code == 200, private.text
    thread_id = private.json()["id"]

    blocked = client.get(f"/api/threads/{thread_id}", headers=steward_headers)
    assert blocked.status_code == 403

    listed = client.get(
        f"/api/spaces/{space_id}/threads", headers=steward_headers
    ).json()["threads"]
    assert thread_id not in {t["id"] for t in listed}


def test_a_stranger_cannot_reach_the_space_at_all(client: TestClient):
    space_id, identity_id, thread_id, _ = _ready_heritage(
        client, email="ac-inside@example.com", name="Con"
    )
    outsider = _login(client, "ac-outsider@example.com", "Người lạ")
    headers = {"Authorization": f"Bearer {outsider}"}

    assert client.get(f"/api/spaces/{space_id}", headers=headers).status_code == 403
    assert (
        client.get(f"/api/spaces/{space_id}/threads", headers=headers).status_code
        == 403
    )
    assert client.get(f"/api/threads/{thread_id}", headers=headers).status_code == 403


# --- who reviews a proposed fact ---


def test_a_private_candidate_is_reviewed_by_that_member_not_the_steward():
    space = type("Space", (), {"steward_user_id": "steward", "created_by": "steward"})()
    direct = Thread(audience_scope="direct", member_user_id="mom")
    family = Thread(audience_scope="family", member_user_id=None)

    assert reviewer_for(direct, space) == "mom"
    assert reviewer_for(family, space) == "steward"


def test_a_private_memory_never_leaks_to_the_family_thread():
    item = MemoryItem(visibility=PRIVATE, created_by="mom")
    family = Thread(audience_scope="family", member_user_id=None)
    her_room = Thread(audience_scope="direct", member_user_id="mom")
    his_room = Thread(audience_scope="direct", member_user_id="son")

    assert reader_for_thread(family) is None
    assert not visible_to(item, reader_for_thread(family))
    assert visible_to(item, reader_for_thread(her_room))
    assert not visible_to(item, reader_for_thread(his_room))


# --- removing a member ---


def test_owner_removes_a_member_and_they_lose_the_space(client: TestClient):
    owner_token = _login(client, "ac-owner-rm@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Nhà gỡ thành viên")

    member_token = _login(client, "ac-leaver@example.com", "Chị")
    member_headers = {"Authorization": f"Bearer {member_token}"}
    _join(client, owner_headers, space_id, member_token)
    member_id = client.get("/api/auth/me", headers=member_headers).json()["id"]

    assert client.get(f"/api/spaces/{space_id}", headers=member_headers).status_code == 200

    removed = client.delete(
        f"/api/spaces/{space_id}/members/{member_id}", headers=owner_headers
    )
    assert removed.status_code == 200, removed.text
    assert client.get(f"/api/spaces/{space_id}", headers=member_headers).status_code == 403


def test_a_member_cannot_remove_anyone(client: TestClient):
    owner_token = _login(client, "ac-owner-guard@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Nhà có cửa")
    owner_id = client.get("/api/auth/me", headers=owner_headers).json()["id"]

    member_token = _login(client, "ac-member-guard@example.com", "Chị")
    member_headers = {"Authorization": f"Bearer {member_token}"}
    _join(client, owner_headers, space_id, member_token)

    blocked = client.delete(
        f"/api/spaces/{space_id}/members/{owner_id}", headers=member_headers
    )
    assert blocked.status_code == 403


def test_the_steward_cannot_be_removed(client: TestClient):
    """Losing the steward would orphan every heritage entity in the space."""
    owner_token = _login(client, "ac-self-rm@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Nhà một mình")
    owner_id = client.get("/api/auth/me", headers=owner_headers).json()["id"]

    # The space creator is both owner and steward, so this is blocked twice over.
    blocked = client.delete(
        f"/api/spaces/{space_id}/members/{owner_id}", headers=owner_headers
    )
    assert blocked.status_code == 400


# --- invite codes ---


def test_a_revoked_invite_code_stops_working(client: TestClient):
    owner_token = _login(client, "ac-invite-owner@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Nhà thu hồi mã")

    code = client.post(
        f"/api/spaces/{space_id}/invites", headers=owner_headers
    ).json()["code"]

    revoked = client.post(
        f"/api/spaces/{space_id}/invites/{code}/revoke", headers=owner_headers
    )
    assert revoked.status_code == 200, revoked.text

    latecomer = _login(client, "ac-latecomer@example.com", "Người đến muộn")
    joined = client.post(
        "/api/spaces/join",
        headers={"Authorization": f"Bearer {latecomer}"},
        json={"code": code},
    )
    assert joined.status_code == 404


def test_only_the_owner_may_revoke_an_invite(client: TestClient):
    owner_token = _login(client, "ac-revoke-owner@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Nhà giữ mã")
    code = client.post(
        f"/api/spaces/{space_id}/invites", headers=owner_headers
    ).json()["code"]

    member_token = _login(client, "ac-revoke-member@example.com", "Chị")
    _join(client, owner_headers, space_id, member_token)

    blocked = client.post(
        f"/api/spaces/{space_id}/invites/{code}/revoke",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert blocked.status_code == 403
