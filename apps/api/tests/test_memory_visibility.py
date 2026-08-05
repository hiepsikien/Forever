"""A kept memory is not automatically a shared one."""

from __future__ import annotations

from datetime import datetime, timezone

from nanoid import generate

from app.models import MemoryCandidate, MemoryItem
from app.services.heritage import HERITAGE_TAG_PREFIX
from app.services.heritage_candidates import approve, enqueue_facts
from app.services.heritage_retrieval import (
    learned_facts_for_identity,
    milestones_for_identity,
)
from app.services.memory_scope import (
    FAMILY,
    PRIVATE,
    normalize_visibility,
    reader_for_thread,
    visible_to,
)
from tests.test_heritage_candidates import _fact, _scene
from tests.test_heritage_chat import _login, _ready_heritage
from tests.test_heritage_threads import _join


def _item(db, *, space_id, identity_id, owner, kind, body, visibility):
    row = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=owner,
        kind=kind,
        title=body[:60],
        body=body,
        tags=f"{HERITAGE_TAG_PREFIX}{identity_id}",
        visibility=visibility,
        occurred_at=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    return row


# --- the rule itself ---

def test_anything_saved_before_the_choice_existed_is_shared():
    assert normalize_visibility(None) == FAMILY
    assert normalize_visibility("") == FAMILY
    assert normalize_visibility("nonsense") == FAMILY
    assert normalize_visibility("PRIVATE") == PRIVATE


def test_a_private_memory_is_read_only_by_the_one_who_kept_it():
    item = MemoryItem(visibility=PRIVATE, created_by="u1")

    assert visible_to(item, "u1")
    assert not visible_to(item, "u2")
    assert not visible_to(item, None)


def test_a_shared_memory_is_read_by_anyone_in_the_house():
    item = MemoryItem(visibility=FAMILY, created_by="u1")

    assert visible_to(item, "u2")
    assert visible_to(item, None)


# --- which room may quote it ---

def test_the_family_room_may_quote_nobodys_private_memory(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, _, steward, _ = _scene(db, scope="family")
        assert reader_for_thread(thread) is None
        _item(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            owner=steward.id,
            kind="milestone",
            body="Điều này chỉ mình con biết",
            visibility=PRIVATE,
        )
        found = milestones_for_identity(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            reader=reader_for_thread(thread),
        )
        assert found == []
    finally:
        db.close()


def test_your_own_room_may_quote_what_you_kept_privately(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, _, _, member = _scene(db, scope="direct")
        assert reader_for_thread(thread) == member.id
        kept = _item(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            owner=member.id,
            kind="knowledge",
            body="Con kể riêng với bố chuyện này",
            visibility=PRIVATE,
        )
        found = learned_facts_for_identity(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            reader=reader_for_thread(thread),
        )
        assert [f.id for f in found] == [kept.id]
    finally:
        db.close()


def test_someone_elses_room_may_not_quote_your_private_memory(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, _, steward, member = _scene(db, scope="direct")
        _item(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            owner=steward.id,
            kind="knowledge",
            body="Điều bố của người khác giữ riêng",
            visibility=PRIVATE,
        )
        found = learned_facts_for_identity(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            reader=member.id,
        )
        assert found == []
    finally:
        db.close()


# --- through the API ---

def _house_with_two(client, slug: str) -> tuple[str, dict, dict]:
    """An owner and one other member, both joined through the real endpoints."""
    space_id, _, _, owner = _ready_heritage(
        client, email=f"{slug}-owner@example.com", name="Con"
    )
    member_token = _login(client, f"{slug}-member@example.com", "Mẹ")
    _join(client, owner, space_id, member_token)
    return space_id, owner, {"Authorization": f"Bearer {member_token}"}


def _note(client, space_id: str, headers: dict, body: str) -> dict:
    res = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={"title": body[:40], "body": body},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_a_new_memory_is_shared_unless_it_is_asked_not_to_be(client):
    space_id, owner, _ = _house_with_two(client, "vis-default")

    assert _note(client, space_id, owner, "Bố hay dậy sớm")["visibility"] == FAMILY


def test_the_library_hides_what_another_member_kept_private(client):
    space_id, owner, member = _house_with_two(client, "vis-hide")
    secret = _note(client, space_id, owner, "Điều con chưa muốn kể")
    shared = _note(client, space_id, owner, "Ghi chú cả nhà đọc được")

    turned = client.patch(
        f"/api/memories/{secret['id']}",
        json={"visibility": PRIVATE},
        headers=owner,
    )
    assert turned.status_code == 200, turned.text

    def bodies(headers: dict) -> list[str]:
        res = client.get(f"/api/spaces/{space_id}/memories", headers=headers)
        assert res.status_code == 200, res.text
        return [m["body"] for m in res.json()["memories"]]

    assert secret["body"] in bodies(owner)
    assert secret["body"] not in bodies(member)
    assert shared["body"] in bodies(member)


def test_only_the_one_who_saved_it_may_move_the_wall(client):
    space_id, owner, member = _house_with_two(client, "vis-wall")
    item = _note(client, space_id, owner, "Chuyện bố kể")

    other = client.patch(
        f"/api/memories/{item['id']}",
        json={"visibility": PRIVATE},
        headers=member,
    )
    assert other.status_code == 403

    mine = client.patch(
        f"/api/memories/{item['id']}",
        json={"visibility": PRIVATE},
        headers=owner,
    )
    assert mine.status_code == 200, mine.text
    assert mine.json()["visibility"] == PRIVATE


def test_a_private_memory_cannot_be_edited_by_someone_who_cannot_see_it(client):
    space_id, owner, member = _house_with_two(client, "vis-edit")
    item = _note(client, space_id, owner, "Ghi chú riêng")
    client.patch(
        f"/api/memories/{item['id']}", json={"visibility": PRIVATE}, headers=owner
    )

    res = client.patch(
        f"/api/memories/{item['id']}", json={"title": "Đổi tên"}, headers=member
    )
    assert res.status_code == 404


def test_keeping_a_private_confidence_does_not_publish_it(client):
    """The third ending: kept forever, still only the member's."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, _, member = _scene(db, scope="direct")
        enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=message,
            facts=[_fact("Con vừa đổi việc, chưa nói với ai")],
        )
        candidate = (
            db.query(MemoryCandidate)
            .filter(MemoryCandidate.thread_id == thread.id)
            .one()
        )
        item = approve(
            db, candidate=candidate, user_id=member.id, visibility=PRIVATE
        )

        assert item.visibility == PRIVATE
        assert learned_facts_for_identity(
            db, space_id=thread.space_id, identity_id=identity.id, reader=None
        ) == []
        assert [
            f.id
            for f in learned_facts_for_identity(
                db,
                space_id=thread.space_id,
                identity_id=identity.id,
                reader=member.id,
            )
        ] == [item.id]
    finally:
        db.close()


def test_dedupe_never_refuses_a_fact_because_of_a_wall_it_cannot_see(client):
    """Otherwise the refusal itself would reveal someone else's private memory."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, steward, member = _scene(db, scope="direct")
        statement = "Bố hay dậy từ năm giờ sáng"
        _item(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            owner=steward.id,
            kind="knowledge",
            body=statement,
            visibility=PRIVATE,
        )
        made = enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=message,
            facts=[_fact(statement)],
        )

        assert len(made) == 1
        assert made[0].reviewer_user_id == member.id
    finally:
        db.close()


def test_an_unknown_visibility_is_refused_rather_than_guessed(client):
    space_id, owner, _ = _house_with_two(client, "vis-bad")
    item = _note(client, space_id, owner, "Một ghi chú")

    res = client.patch(
        f"/api/memories/{item['id']}",
        json={"visibility": "everyone"},
        headers=owner,
    )
    assert res.status_code == 400
