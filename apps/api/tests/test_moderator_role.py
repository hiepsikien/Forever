"""A moderator helps decide what the family keeps — and no more than that.

The role exists so the steward is not the only person who can clear the review
queue and tend the memorial pages. The line it must never cross is the one
already drawn elsewhere in this codebase: what someone said alone with the
person they lost belongs to them. These tests hold that line while the role
grows around it.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_heritage_chat import _login, _ready_heritage
from tests.test_heritage_threads import _join


def _member_id(client: TestClient, headers: dict) -> str:
    return client.get("/api/auth/me", headers=headers).json()["id"]


def _promote(
    client: TestClient, admin: dict, space_id: str, user_id: str, role: str
):
    return client.patch(
        f"/api/spaces/{space_id}/members/{user_id}/role",
        headers=admin,
        json={"role": role},
    )


def _house_with_moderator(client: TestClient, slug: str):
    """Steward + a promoted moderator + a plain member, all in one space."""
    space_id, identity_id, thread_id, steward = _ready_heritage(
        client, email=f"{slug}-steward@example.com", name="Con"
    )
    mod_token = _login(client, f"{slug}-mod@example.com", "Chị")
    mod = {"Authorization": f"Bearer {mod_token}"}
    _join(client, steward, space_id, mod_token)

    plain_token = _login(client, f"{slug}-plain@example.com", "Mẹ")
    plain = {"Authorization": f"Bearer {plain_token}"}
    _join(client, steward, space_id, plain_token)

    res = _promote(client, steward, space_id, _member_id(client, mod), "moderator")
    assert res.status_code == 200, res.text
    assert res.json()["role"] == "moderator"
    return space_id, identity_id, thread_id, steward, mod, plain


# --- who may hand out the role ---


def test_a_plain_member_cannot_promote_anyone(client: TestClient):
    space_id, _, _, steward, mod, plain = _house_with_moderator(client, "mr-promote")
    target = _member_id(client, mod)
    assert _promote(client, plain, space_id, target, "owner").status_code == 403


def test_a_moderator_cannot_promote_themselves_further(client: TestClient):
    space_id, _, _, _steward, mod, _plain = _house_with_moderator(client, "mr-self")
    assert _promote(client, mod, space_id, _member_id(client, mod), "owner").status_code == 403


def test_nobody_changes_their_own_role(client: TestClient):
    """Not even the steward — a slip here locks the house."""
    space_id, _, _, steward, _mod, _plain = _house_with_moderator(client, "mr-own")
    res = _promote(client, steward, space_id, _member_id(client, steward), "member")
    assert res.status_code == 400


def test_an_unknown_role_is_refused(client: TestClient):
    space_id, _, _, steward, mod, _plain = _house_with_moderator(client, "mr-bogus")
    res = _promote(client, steward, space_id, _member_id(client, mod), "admin")
    assert res.status_code == 400


def test_the_role_can_be_taken_back(client: TestClient):
    space_id, _, _, steward, mod, _plain = _house_with_moderator(client, "mr-demote")
    target = _member_id(client, mod)
    assert _promote(client, steward, space_id, target, "member").status_code == 200
    listed = client.get(f"/api/spaces/{space_id}", headers=steward).json()["members"]
    assert {m["id"]: m["role"] for m in listed}[target] == "member"


# --- the review queue ---


def _pending_ids(client: TestClient, headers: dict, space_id: str) -> set[str]:
    res = client.get(f"/api/spaces/{space_id}/memory-candidates", headers=headers)
    assert res.status_code == 200, res.text
    return {c["id"] for c in res.json()["candidates"]}


def _seed_candidate(client, steward, space_id, identity_id, thread_id, statement):
    """Queue a fact the way heritage chat does, without running the model."""
    from datetime import datetime, timezone

    from nanoid import generate

    from app.db import SessionLocal
    from app.models import IdentityProfile, Message, Thread
    from app.services.heritage_candidates import enqueue_facts

    db = SessionLocal()
    try:
        thread = db.query(Thread).filter(Thread.id == thread_id).one()
        identity = (
            db.query(IdentityProfile).filter(IdentityProfile.id == identity_id).one()
        )
        said = Message(
            id=generate(),
            thread_id=thread.id,
            sender_kind="user",
            kind="text",
            body=statement,
            created_at=datetime.now(timezone.utc),
        )
        db.add(said)
        db.flush()
        rows = enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=said,
            facts=[{"statement": statement, "kind": "event", "subject_slug": "test"}],
        )
        db.commit()
        return [r.id for r in rows]
    finally:
        db.close()


def test_a_moderator_sees_the_family_queue_the_steward_sees(client: TestClient):
    space_id, identity_id, thread_id, steward, mod, plain = _house_with_moderator(
        client, "mr-queue"
    )
    ids = _seed_candidate(
        client, steward, space_id, identity_id, thread_id, "Bố thích cà phê đen."
    )
    assert ids, "the fixture must queue at least one candidate"

    assert set(ids) <= _pending_ids(client, steward, space_id)
    assert set(ids) <= _pending_ids(client, mod, space_id)
    assert not (set(ids) & _pending_ids(client, plain, space_id))


def test_a_moderator_may_approve_what_the_family_heard(client: TestClient):
    space_id, identity_id, thread_id, steward, mod, _plain = _house_with_moderator(
        client, "mr-approve"
    )
    ids = _seed_candidate(
        client, steward, space_id, identity_id, thread_id, "Bố trồng một cây khế."
    )
    res = client.post(f"/api/memory-candidates/{ids[0]}/approve", headers=mod)
    assert res.status_code == 200, res.text
    assert res.json()["memory_id"]


def test_a_plain_member_may_not_approve_the_family_queue(client: TestClient):
    space_id, identity_id, thread_id, steward, _mod, plain = _house_with_moderator(
        client, "mr-plainapprove"
    )
    ids = _seed_candidate(
        client, steward, space_id, identity_id, thread_id, "Bố dậy lúc năm giờ."
    )
    res = client.post(f"/api/memory-candidates/{ids[0]}/approve", headers=plain)
    assert res.status_code == 403


def test_a_moderator_never_reaches_a_private_room(client: TestClient):
    """The whole point of the role's boundary, stated as a test."""
    space_id, identity_id, _thread_id, steward, mod, plain = _house_with_moderator(
        client, "mr-private"
    )
    room = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=plain,
    )
    assert room.status_code == 200, room.text
    private_thread_id = room.json()["id"]

    ids = _seed_candidate(
        client, steward, space_id, identity_id, private_thread_id, "Con giận bố."
    )
    assert ids

    assert not (set(ids) & _pending_ids(client, mod, space_id))
    assert not (set(ids) & _pending_ids(client, steward, space_id))
    assert set(ids) <= _pending_ids(client, plain, space_id)

    assert client.post(
        f"/api/memory-candidates/{ids[0]}/approve", headers=mod
    ).status_code == 403
    assert client.post(
        f"/api/memory-candidates/{ids[0]}/approve", headers=steward
    ).status_code == 403
    assert client.post(
        f"/api/memory-candidates/{ids[0]}/approve", headers=plain
    ).status_code == 200


# --- the memorial page ---


def test_a_moderator_may_edit_the_memorial_profile(client: TestClient):
    space_id, identity_id, _, _steward, mod, _plain = _house_with_moderator(
        client, "mr-profile"
    )
    res = client.patch(
        f"/api/spaces/{space_id}/identities/{identity_id}",
        headers=mod,
        json={"core_values": ["kiên nhẫn", "thật thà", "chăm chỉ"]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["core_values"] == ["kiên nhẫn", "thật thà", "chăm chỉ"]


def test_a_plain_member_may_not_edit_the_memorial_profile(client: TestClient):
    space_id, identity_id, _, _steward, _mod, plain = _house_with_moderator(
        client, "mr-profileplain"
    )
    res = client.patch(
        f"/api/spaces/{space_id}/identities/{identity_id}",
        headers=plain,
        json={"core_values": ["gì đó"]},
    )
    assert res.status_code == 403


def test_declaring_someone_remembered_stays_with_the_steward(client: TestClient):
    """Editing what a person was like is not the same as saying they are gone."""
    space_id, _, _, steward, mod, _plain = _house_with_moderator(client, "mr-status")
    living = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=steward,
        json={"display_name": "Chú Ba", "relation_label": "Chú", "status": "living"},
    )
    assert living.status_code == 200, living.text
    identity_id = living.json()["id"]

    blocked = client.patch(
        f"/api/spaces/{space_id}/identities/{identity_id}",
        headers=mod,
        json={"status": "remembered"},
    )
    assert blocked.status_code == 403

    allowed = client.patch(
        f"/api/spaces/{space_id}/identities/{identity_id}",
        headers=steward,
        json={"status": "remembered"},
    )
    assert allowed.status_code == 200, allowed.text
