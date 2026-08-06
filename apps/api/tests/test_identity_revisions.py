"""Identity Lock revisions — every real edit leaves a footprint.

A moderator tends who someone was. When they change it, the previous state
must still be reachable. These tests hold that the footprint is written on
change, skipped on no-op, and that restore both applies and itself records.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_moderator_role import _house_with_moderator, _member_id


def _patch_lock(client: TestClient, headers: dict, space_id: str, identity_id: str, **fields):
    return client.patch(
        f"/api/spaces/{space_id}/identities/{identity_id}",
        headers=headers,
        json=fields,
    )


def _list_revs(client: TestClient, headers: dict, space_id: str, identity_id: str):
    return client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/revisions",
        headers=headers,
    )


def _restore(client: TestClient, headers: dict, space_id: str, identity_id: str, rev_id: str):
    return client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/revisions/{rev_id}/restore",
        headers=headers,
    )


def _rev_count(client: TestClient, headers: dict, space_id: str, identity_id: str) -> int:
    res = _list_revs(client, headers, space_id, identity_id)
    assert res.status_code == 200, res.text
    return len(res.json()["revisions"])


def test_a_real_edit_leaves_a_revision(client: TestClient):
    space_id, identity_id, _thread, steward, mod, _plain = _house_with_moderator(
        client, "rev-edit"
    )
    # `_ready_heritage` already wrote the lock once, so a baseline revision exists.
    baseline = _rev_count(client, mod, space_id, identity_id)
    assert baseline >= 1

    first = _patch_lock(
        client,
        mod,
        space_id,
        identity_id,
        core_values=["Thật thà", "Gia đình", "Học hỏi"],
        speech_style={"traits": ["Ngắn gọn"]},
    )
    assert first.status_code == 200, first.text
    assert _rev_count(client, mod, space_id, identity_id) == baseline + 1

    second = _patch_lock(
        client,
        mod,
        space_id,
        identity_id,
        core_values=["Thật thà", "Gia đình", "Khiêm tốn"],
    )
    assert second.status_code == 200
    revs = _list_revs(client, steward, space_id, identity_id).json()["revisions"]
    assert len(revs) == baseline + 2
    assert revs[0]["created_by"] == _member_id(client, mod)


def test_a_noop_patch_does_not_leave_a_revision(client: TestClient):
    space_id, identity_id, _thread, steward, _mod, _plain = _house_with_moderator(
        client, "rev-noop"
    )
    current = client.get(
        f"/api/spaces/{space_id}/identities",
        headers=steward,
    ).json()["identities"]
    row = next(i for i in current if i["id"] == identity_id)
    payload = {
        "display_name": row["display_name"],
        "relation_label": row["relation_label"],
        "core_values": row["core_values"],
        "speech_style": row["speech_style"],
        "address_forms": row["address_forms"],
        "taboos": row["taboos"],
        "philosophy": row["philosophy"],
        "dynamic_context": row.get("dynamic_context") or "",
    }
    before = _rev_count(client, steward, space_id, identity_id)
    again = _patch_lock(client, steward, space_id, identity_id, **payload)
    assert again.status_code == 200, again.text
    assert _rev_count(client, steward, space_id, identity_id) == before


def test_restore_applies_the_old_lock_and_records_the_live_one(client: TestClient):
    space_id, identity_id, _thread, steward, mod, _plain = _house_with_moderator(
        client, "rev-restore"
    )
    baseline = _rev_count(client, mod, space_id, identity_id)

    assert (
        _patch_lock(
            client,
            mod,
            space_id,
            identity_id,
            core_values=["Một", "Hai", "Ba"],
            dynamic_context="Bản đầu",
        ).status_code
        == 200
    )
    assert (
        _patch_lock(
            client,
            mod,
            space_id,
            identity_id,
            core_values=["Bốn", "Năm", "Sáu"],
            dynamic_context="Bản sau",
        ).status_code
        == 200
    )

    revs = _list_revs(client, mod, space_id, identity_id).json()["revisions"]
    assert len(revs) == baseline + 2
    # Newest revision is the state just before "Bản sau" — i.e. "Bản đầu".
    target = revs[0]["id"]
    restored = _restore(client, mod, space_id, identity_id, target)
    assert restored.status_code == 200, restored.text
    identity = restored.json()["identity"]
    assert identity["dynamic_context"] == "Bản đầu"
    assert identity["core_values"] == ["Một", "Hai", "Ba"]

    assert _rev_count(client, mod, space_id, identity_id) == baseline + 3


def test_a_plain_member_cannot_read_or_restore_revisions(client: TestClient):
    space_id, identity_id, _thread, steward, _mod, plain = _house_with_moderator(
        client, "rev-deny"
    )
    revs = _list_revs(client, steward, space_id, identity_id).json()["revisions"]
    assert revs, "ready heritage should have left at least one revision"
    assert _list_revs(client, plain, space_id, identity_id).status_code == 403
    assert _restore(client, plain, space_id, identity_id, revs[0]["id"]).status_code == 403


def test_a_moderator_can_edit_lock_via_revisions_path(client: TestClient):
    """Sanity: the same gate that opens the memorial page opens the history."""
    space_id, identity_id, _thread, _steward, mod, _plain = _house_with_moderator(
        client, "rev-mod"
    )
    assert (
        _patch_lock(
            client,
            mod,
            space_id,
            identity_id,
            relation_label="Bố",
        ).status_code
        == 200
    )
    assert _list_revs(client, mod, space_id, identity_id).status_code == 200
