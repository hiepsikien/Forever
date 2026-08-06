"""A shared library is not a place where anyone can delete your grandmother.

`DELETE /api/memories/{id}` used to ask only for space membership — no check
that you saved the thing, and no visibility check either, so one member could
permanently erase another member's private memory. These tests pin the repair.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_heritage_chat import _login, _ready_heritage
from tests.test_heritage_threads import _join


def _me(client: TestClient, headers: dict) -> str:
    return client.get("/api/auth/me", headers=headers).json()["id"]


def _house(client: TestClient, slug: str):
    space_id, _identity, _thread, steward = _ready_heritage(
        client, email=f"{slug}-steward@example.com", name="Con"
    )
    mod_token = _login(client, f"{slug}-mod@example.com", "Chị")
    mod = {"Authorization": f"Bearer {mod_token}"}
    _join(client, steward, space_id, mod_token)
    client.patch(
        f"/api/spaces/{space_id}/members/{_me(client, mod)}/role",
        headers=steward,
        json={"role": "moderator"},
    )

    plain_token = _login(client, f"{slug}-plain@example.com", "Mẹ")
    plain = {"Authorization": f"Bearer {plain_token}"}
    _join(client, steward, space_id, plain_token)
    return space_id, steward, mod, plain


def _note(client, headers, space_id, title, visibility="family") -> str:
    res = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={"title": title, "body": "…"},
    )
    assert res.status_code == 200, res.text
    memory_id = res.json()["id"]
    if visibility == "private":
        # Notes are saved shared; only the saver may pull one behind the wall.
        moved = client.patch(
            f"/api/memories/{memory_id}",
            headers=headers,
            json={"visibility": "private"},
        )
        assert moved.status_code == 200, moved.text
    return memory_id


def _library(client, headers, space_id) -> dict[str, dict]:
    res = client.get(f"/api/spaces/{space_id}/memories", headers=headers)
    assert res.status_code == 200, res.text
    return {item["id"]: item for item in res.json()["memories"]}


def test_a_member_cannot_delete_someone_elses_memory(client: TestClient):
    space_id, steward, _mod, plain = _house(client, "mem-del")
    memory_id = _note(client, steward, space_id, "Bố dạy tôi đi xe đạp")
    assert client.delete(f"/api/memories/{memory_id}", headers=plain).status_code == 403
    assert memory_id in _library(client, steward, space_id)


def test_a_member_can_still_delete_their_own(client: TestClient):
    space_id, _steward, _mod, plain = _house(client, "mem-own")
    memory_id = _note(client, plain, space_id, "Mẹ nấu canh chua")
    assert client.delete(f"/api/memories/{memory_id}", headers=plain).status_code == 200


def test_a_moderator_may_tidy_the_shared_library(client: TestClient):
    space_id, steward, mod, _plain = _house(client, "mem-mod")
    memory_id = _note(client, steward, space_id, "Ảnh trùng lặp")
    assert client.delete(f"/api/memories/{memory_id}", headers=mod).status_code == 200


def test_nobody_reaches_a_private_memory_they_did_not_save(client: TestClient):
    """Not the moderator, not the steward — private means private."""
    space_id, steward, mod, plain = _house(client, "mem-private")
    memory_id = _note(client, plain, space_id, "Điều tôi chưa kể", visibility="private")

    for headers in (steward, mod):
        assert client.delete(f"/api/memories/{memory_id}", headers=headers).status_code == 404
        assert (
            client.patch(
                f"/api/memories/{memory_id}", headers=headers, json={"title": "X"}
            ).status_code
            == 404
        )
    assert client.delete(f"/api/memories/{memory_id}", headers=plain).status_code == 200


def test_a_member_cannot_rewrite_someone_elses_memory(client: TestClient):
    space_id, steward, _mod, plain = _house(client, "mem-edit")
    memory_id = _note(client, steward, space_id, "Ngày cưới của bố mẹ")
    res = client.patch(
        f"/api/memories/{memory_id}", headers=plain, json={"title": "Sai rồi"}
    )
    assert res.status_code == 403
    assert _library(client, steward, space_id)[memory_id]["title"] == "Ngày cưới của bố mẹ"


def test_only_the_saver_moves_a_memory_behind_a_wall(client: TestClient):
    """A moderator may edit the text, but the wall stays its owner's."""
    space_id, steward, mod, _plain = _house(client, "mem-vis")
    memory_id = _note(client, steward, space_id, "Thư bố viết")
    res = client.patch(
        f"/api/memories/{memory_id}", headers=mod, json={"visibility": "private"}
    )
    assert res.status_code == 403
