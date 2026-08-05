from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from nanoid import generate

from app.models import (
    FamilySpace,
    IdentityProfile,
    MemoryCandidate,
    MemoryItem,
    Message,
    Thread,
    User,
)
from app.services.heritage_candidates import enqueue_facts, reviewer_for
from app.services.heritage_retrieval import (
    learned_facts_for_identity,
    retrieve_learned,
)
from tests.test_heritage_chat import _login, _ready_heritage


def _fact(statement: str, **kwargs) -> dict:
    return {"statement": statement, "kind": "event", **kwargs}


def _scene(db, *, scope: str = "family", steward_is_member: bool = True):
    """A space with a steward, one other member, and a heritage thread."""
    now = datetime.now(timezone.utc)
    steward = User(
        id=generate(),
        firebase_uid=generate(),
        email=f"{generate()}@example.com",
        name="Steward",
        created_at=now,
    )
    member = User(
        id=generate(),
        firebase_uid=generate(),
        email=f"{generate()}@example.com",
        name="Mẹ",
        created_at=now,
    )
    db.add_all([steward, member])
    db.commit()
    space = FamilySpace(
        id=generate(),
        name="Nhà",
        created_by=steward.id,
        steward_user_id=steward.id,
        created_at=now,
    )
    db.add(space)
    db.commit()
    identity = IdentityProfile(
        id=generate(),
        space_id=space.id,
        display_name="Bố Triệu",
        relation_label="Bố",
        status="remembered",
        created_by=steward.id,
        created_at=now,
    )
    db.add(identity)
    db.commit()
    thread = Thread(
        id=generate(),
        space_id=space.id,
        kind="heritage",
        title="Bố Triệu",
        heritage_identity_id=identity.id,
        audience_scope=scope,
        member_user_id=member.id if scope == "direct" else None,
        created_at=now,
    )
    db.add(thread)
    db.commit()
    message = Message(
        id=generate(),
        thread_id=thread.id,
        sender_user_id=member.id,
        sender_kind="user",
        kind="text",
        body="Mẹ dạo này hay ngồi ngoài phòng khách.",
        created_at=now,
    )
    db.add(message)
    db.commit()
    return space, identity, thread, message, steward, member


# --- who gets to decide ---

def test_a_family_thread_is_reviewed_by_the_steward(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        space, _, thread, _, steward, _ = _scene(db)
        assert reviewer_for(thread, space) == steward.id
    finally:
        db.close()


def test_a_private_thread_is_reviewed_by_its_own_member(client):
    """Routing it to the steward would hand him what mother said in confidence."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        space, _, thread, _, steward, member = _scene(db, scope="direct")
        assert reviewer_for(thread, space) == member.id
        assert reviewer_for(thread, space) != steward.id
    finally:
        db.close()


# --- queueing ---

def test_enqueue_records_where_the_fact_came_from(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, steward, _ = _scene(db)
        queued = enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=message,
            facts=[
                _fact(
                    "Mẹ hay ngồi ngoài phòng khách",
                    subject_slug="le_thi_dinh",
                    occurred_at="",
                    source_message_id=message.id,
                )
            ],
        )
        assert len(queued) == 1
        row = queued[0]
        assert row.status == "pending"
        assert row.reviewer_user_id == steward.id
        assert row.source_message_id == message.id
        assert row.subject_slug == "le_thi_dinh"
        assert row.thread_id == thread.id
    finally:
        db.close()


def test_the_same_fact_is_not_queued_twice(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, _, _ = _scene(db)
        args = dict(thread=thread, identity=identity, user_message=message)
        assert len(enqueue_facts(db, **args, facts=[_fact("Mẹ ở phòng ngoài")])) == 1
        # Same words, different tone marks and case: still the same fact.
        assert enqueue_facts(db, **args, facts=[_fact("mẹ ở phong ngoai")]) == []
    finally:
        db.close()


def test_todays_news_is_never_offered_as_a_life_story(client):
    """"Công việc hôm nay tốt đẹp" belongs in the thread, not in a biography."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, _, _ = _scene(db)
        queued = enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=message,
            facts=[
                {"statement": "Công việc trong ngày diễn ra tốt đẹp", "kind": "life_state"},
                _fact("Bố tham gia Ban phụ huynh cho chị Hương"),
            ],
        )
        assert [row.statement for row in queued] == [
            "Bố tham gia Ban phụ huynh cho chị Hương"
        ]
    finally:
        db.close()


def test_the_same_fact_clipped_short_is_not_queued_again(client):
    """A statement is capped on the way in, so it can arrive whole and clipped."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, _, _ = _scene(db)
        args = dict(thread=thread, identity=identity, user_message=message)
        whole = (
            "Mẹ cùng em gái tên Yên đến ký túc xá trường Tổng hợp ở phố Lý Thường "
            "Kiệt để thăm bố, tại đây mẹ đã xé tan nát lọ hoa hồng trên bàn bố rồi "
            "bỏ đi khiến bố đuổi theo không kịp."
        )
        assert len(enqueue_facts(db, **args, facts=[_fact(whole)])) == 1
        assert enqueue_facts(db, **args, facts=[_fact(whole[:160])]) == []
    finally:
        db.close()


def test_two_facts_that_merely_start_alike_both_get_queued(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        _, identity, thread, message, _, _ = _scene(db)
        args = dict(thread=thread, identity=identity, user_message=message)
        assert len(enqueue_facts(db, **args, facts=[_fact("Bố dạy ở trường Tổng hợp")])) == 1
        assert (
            len(enqueue_facts(db, **args, facts=[_fact("Bố dạy ở trường Bách khoa")]))
            == 1
        )
    finally:
        db.close()


def test_nothing_is_queued_without_a_reviewer(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        space, identity, thread, message, _, _ = _scene(db, scope="direct")
        thread.member_user_id = None
        db.commit()
        assert (
            enqueue_facts(
                db,
                thread=thread,
                identity=identity,
                user_message=message,
                facts=[_fact("Không ai duyệt được")],
            )
            == []
        )
    finally:
        db.close()


# --- review, and the fact coming back through retrieval ---

def test_approving_puts_the_fact_in_the_library_where_chat_finds_it(client):
    """Chat feeds the library, the library feeds chat back."""
    from app.db import SessionLocal
    from app.services.heritage_candidates import approve

    db = SessionLocal()
    try:
        space, identity, thread, message, steward, _ = _scene(db)
        row = enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=message,
            facts=[
                _fact("Mẹ hay ngồi ngoài phòng khách", occurred_at="2026-08-08")
            ],
        )[0]
        item = approve(db, candidate=row, user_id=steward.id)

        assert row.status == "approved"
        assert row.memory_item_id == item.id
        assert item.kind == "knowledge"
        assert f"heritage:{identity.id}" in item.tags
        assert item.source_message_id == message.id
        assert item.occurred_at is not None and item.occurred_at.year == 2026

        facts = learned_facts_for_identity(
            db, space_id=space.id, identity_id=identity.id
        )
        assert [f.id for f in facts] == [item.id]
        # Relevance-gated: asked about, it comes back; unrelated, it stays out.
        assert retrieve_learned(facts, query="mẹ ngồi phòng khách thế nào")
        assert retrieve_learned(facts, query="bố kể chuyện thơ lục bát") == []
    finally:
        db.close()


def test_a_partial_date_does_not_become_a_fake_timestamp(client):
    from app.db import SessionLocal
    from app.services.heritage_candidates import approve

    db = SessionLocal()
    try:
        _, identity, thread, message, steward, _ = _scene(db)
        row = enqueue_facts(
            db,
            thread=thread,
            identity=identity,
            user_message=message,
            facts=[_fact("Bố về quê một dịp trong năm ấy", occurred_at="1975")],
        )[0]
        assert approve(db, candidate=row, user_id=steward.id).occurred_at is None
    finally:
        db.close()


def test_an_approved_fact_is_not_queued_again_from_a_later_turn(client):
    from app.db import SessionLocal
    from app.services.heritage_candidates import approve

    db = SessionLocal()
    try:
        _, identity, thread, message, steward, _ = _scene(db)
        args = dict(thread=thread, identity=identity, user_message=message)
        row = enqueue_facts(db, **args, facts=[_fact("Mẹ ở phòng ngoài")])[0]
        approve(db, candidate=row, user_id=steward.id)
        db.query(MemoryCandidate).filter(MemoryCandidate.id == row.id).delete()
        db.commit()
        # The queue forgot it, but the library remembers.
        assert enqueue_facts(db, **args, facts=[_fact("Mẹ ở phòng ngoài")]) == []
    finally:
        db.close()


def test_a_finished_turn_queues_only_the_stated_facts(client):
    """The write-back wiring, where an implied fact must not reach a human."""
    import json

    from app.config import Settings
    from app.db import SessionLocal
    from app.services.heritage_chat import _write_back_memory

    db = SessionLocal()
    try:
        _, identity, thread, message, steward, _ = _scene(db)
        reply = Message(
            id=generate(),
            thread_id=thread.id,
            sender_kind="heritage",
            kind="text",
            body="Bố nghe con rồi.",
            meta_json=json.dumps(
                {
                    "new_facts": [
                        {"statement": "Mẹ ở phòng ngoài", "confidence": "stated"},
                        {"statement": "Con đang buồn", "confidence": "implied"},
                    ]
                },
                ensure_ascii=False,
            ),
            created_at=datetime.now(timezone.utc),
        )
        db.add(reply)
        db.commit()

        _write_back_memory(
            db,
            thread=thread,
            user_message=message,
            reply=reply,
            settings=Settings(gemini_api_key="", seed_demo=False),
        )

        queued = (
            db.query(MemoryCandidate)
            .filter(MemoryCandidate.identity_id == identity.id)
            .all()
        )
        assert [row.statement for row in queued] == ["Mẹ ở phòng ngoài"]
        assert queued[0].reviewer_user_id == steward.id
    finally:
        db.close()


# --- the endpoints ---

def _join(client: TestClient, owner_headers: dict, space_id: str, token: str) -> None:
    invite = client.post(
        f"/api/spaces/{space_id}/invites",
        headers=owner_headers,
        json={"role": "member"},
    )
    client.post(
        "/api/spaces/join",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": invite.json()["code"]},
    )


def _seed_candidate(space_id: str, identity_id: str, thread_id: str, reviewer: str):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        row = MemoryCandidate(
            id=generate(),
            space_id=space_id,
            identity_id=identity_id,
            thread_id=thread_id,
            reviewer_user_id=reviewer,
            statement="Con về nhà thứ bảy",
            fact_kind="event",
            occurred_at="2026-08-08",
            status="pending",
            created_at=datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


def _user_id(client: TestClient, headers: dict) -> str:
    return client.get("/api/auth/me", headers=headers).json()["id"]


def test_the_queue_only_shows_what_you_may_decide(client):
    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="cand-owner@example.com", name="Con"
    )
    other_token = _login(client, "cand-other@example.com", "Chị")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    _join(client, headers, space_id, other_token)

    mine = _seed_candidate(
        space_id, identity_id, thread_id, _user_id(client, headers)
    )

    listed = client.get(
        f"/api/spaces/{space_id}/memory-candidates", headers=headers
    ).json()["candidates"]
    assert [c["id"] for c in listed] == [mine]
    assert listed[0]["identity_name"] == "Bố Triệu"
    assert listed[0]["audience_scope"] == "family"

    theirs = client.get(
        f"/api/spaces/{space_id}/memory-candidates", headers=other_headers
    ).json()["candidates"]
    assert theirs == []
    assert (
        client.post(
            f"/api/memory-candidates/{mine}/approve", headers=other_headers
        ).status_code
        == 403
    )


def test_approving_through_the_api_lands_in_the_library(client):
    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="cand-approve@example.com", name="Con"
    )
    candidate_id = _seed_candidate(
        space_id, identity_id, thread_id, _user_id(client, headers)
    )

    res = client.post(
        f"/api/memory-candidates/{candidate_id}/approve", headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["candidate"]["status"] == "approved"

    memories = client.get(f"/api/spaces/{space_id}/memories", headers=headers).json()
    bodies = [m["body"] for m in memories["memories"]]
    assert "Con về nhà thứ bảy" in bodies

    # Already handled: a second press is a conflict, not a duplicate memory.
    again = client.post(
        f"/api/memory-candidates/{candidate_id}/approve", headers=headers
    )
    assert again.status_code == 409


def test_dismissing_leaves_the_library_alone(client):
    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="cand-dismiss@example.com", name="Con"
    )
    candidate_id = _seed_candidate(
        space_id, identity_id, thread_id, _user_id(client, headers)
    )
    res = client.post(
        f"/api/memory-candidates/{candidate_id}/dismiss", headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["candidate"]["status"] == "dismissed"

    from app.db import SessionLocal

    db = SessionLocal()
    try:
        assert (
            db.query(MemoryItem)
            .filter(MemoryItem.space_id == space_id, MemoryItem.kind == "knowledge")
            .count()
            == 0
        )
    finally:
        db.close()
