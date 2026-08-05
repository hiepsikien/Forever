from __future__ import annotations

import json
from datetime import datetime, timezone

from nanoid import generate

from app.config import Settings
from app.models import Message, Thread, ThreadMemory
from app.services.heritage_memory import (
    MemoryState,
    avoid_block,
    compact_thread_memory,
    compaction_due,
    is_repetitive,
    jaccard,
    memory_block,
    parse_state,
    question_sentences,
    recent_heritage_bodies,
    record_turn,
    repeated_question,
)

GREETING = "Con dạo này thế nào, có khoẻ không?"


def _memory(**summary) -> ThreadMemory:
    now = datetime.now(timezone.utc)
    return ThreadMemory(
        id="m",
        thread_id="t",
        summary_json=json.dumps(summary, ensure_ascii=False),
        turn_count=summary.pop("_turns", 0) or 0,
        compacted_turn=0,
        created_at=now,
        updated_at=now,
    )


# --- state parsing ---

def test_parse_state_of_missing_row_is_empty():
    state = parse_state(None)
    assert state.is_empty
    assert memory_block(state) == ""


def test_parse_state_survives_broken_json():
    row = _memory()
    row.summary_json = "{not json"
    assert parse_state(row).is_empty


def test_parse_state_caps_each_list():
    row = _memory(facts_learned=[f"Sự thật số {i}" for i in range(40)])
    state = parse_state(row)
    assert len(state.facts_learned) == 12
    # Keeps the newest, drops the oldest.
    assert state.facts_learned[-1]["statement"] == "Sự thật số 39"


# --- prompt block ---

def test_memory_block_lists_facts_and_used_questions():
    state = MemoryState(
        facts_learned=[{"statement": "Mẹ đang ở phòng ngoài"}],
        already_asked=[GREETING],
        topics_open=["cúng tuần thứ bảy"],
        emotional_tone="ấm áp, nhớ thương",
    )
    block = memory_block(state)
    assert "Mẹ đang ở phòng ngoài" in block
    assert GREETING in block
    assert "cúng tuần thứ bảy" in block
    assert "ấm áp" in block


def test_memory_block_is_empty_when_nothing_learned():
    assert memory_block(MemoryState()) == ""


# --- similarity helpers ---

def test_question_sentences_only_picks_questions():
    text = "Bố đây con. Con dạo này thế nào? Bố vẫn nhớ nhà."
    assert question_sentences(text) == ["Con dạo này thế nào?"]


def test_jaccard_ignores_diacritic_and_case_noise():
    assert jaccard("Con khoẻ không?", "con khoe khong?") > 0.9


def test_repeated_question_matches_a_reworded_greeting():
    asked = [GREETING]
    assert repeated_question("Bố đây. Con dạo này thế nào, khoẻ không?", asked)
    assert repeated_question("Mẹ con ăn uống ra sao rồi?", asked) is None


def test_is_repetitive_flags_a_near_identical_reply():
    previous = ["Bố biết rồi, con cứ chu toàn việc cúng tuần cho bố thật ấm cúng."]
    reason = is_repetitive(
        "Bố biết rồi, con cứ chu toàn việc cúng tuần cho bố cho thật ấm cúng.",
        previous=previous,
        asked=[],
    )
    assert reason == "similar_reply"


def test_is_repetitive_flags_a_reused_question():
    reason = is_repetitive(
        "Bố nghe rồi. Con dạo này thế nào, có khoẻ không?",
        previous=[],
        asked=[GREETING],
    )
    assert reason == "repeated_question"


def test_is_repetitive_passes_a_fresh_reply():
    assert (
        is_repetitive(
            "Bố nhớ hôm cưới mẹ con ở Hàng Da, trời mưa mà ai cũng cười.",
            previous=["Bố biết rồi, con cứ chu toàn việc cúng tuần."],
            asked=[GREETING],
        )
        is None
    )


def test_avoid_block_names_what_to_skip():
    block = avoid_block(["Bố vẫn khoẻ."], [GREETING])
    assert GREETING in block
    assert "Bố vẫn khoẻ." in block


def test_recent_heritage_bodies_takes_the_last_three():
    history = [
        Message(id=str(i), thread_id="t", sender_kind="heritage", body=f"reply {i}")
        for i in range(5)
    ] + [Message(id="u", thread_id="t", sender_kind="user", body="hỏi")]
    assert recent_heritage_bodies(history) == ["reply 2", "reply 3", "reply 4"]


# --- write-back ---

def _heritage_thread(db) -> Thread:
    from app.models import FamilySpace, User

    now = datetime.now(timezone.utc)
    user = User(
        id=generate(),
        firebase_uid=generate(),
        email=f"{generate()}@example.com",
        name="Con",
        created_at=now,
    )
    db.add(user)
    db.commit()
    space = FamilySpace(
        id=generate(),
        name="Nhà",
        created_by=user.id,
        steward_user_id=user.id,
        created_at=now,
    )
    db.add(space)
    db.commit()
    thread = Thread(
        id=generate(),
        space_id=space.id,
        kind="heritage",
        title="Bố",
        created_at=now,
    )
    db.add(thread)
    db.commit()
    return thread


def _turn(db, thread: Thread, *, ask: str, reply_body: str, meta: dict) -> Message:
    now = datetime.now(timezone.utc)
    user_message = Message(
        id=generate(),
        thread_id=thread.id,
        sender_kind="user",
        kind="text",
        body=ask,
        created_at=now,
    )
    reply = Message(
        id=generate(),
        thread_id=thread.id,
        sender_kind="heritage",
        kind="text",
        body=reply_body,
        meta_json=json.dumps(meta, ensure_ascii=False),
        created_at=now,
    )
    db.add_all([user_message, reply])
    db.commit()
    record_turn(db, thread=thread, user_message=user_message, reply=reply)
    return reply


def test_record_turn_accumulates_facts_questions_and_entities(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        thread = _heritage_thread(db)

        _turn(
            db,
            thread,
            ask="Mẹ vẫn nhớ bố lắm.",
            reply_body=f"Bố hiểu lòng mẹ con. {GREETING}",
            meta={"new_facts": ["Mẹ hay ngồi ngoài phòng khách"], "codex_slugs": ["le_thi_dinh"]},
        )
        _turn(
            db,
            thread,
            ask="Thứ bảy con về ạ.",
            # Same greeting again — must not be stored twice.
            reply_body=f"Bố mừng lắm. Con dạo này thế nào, có khoẻ không?",
            meta={"new_facts": ["Con về thứ bảy"], "codex_slugs": ["le_thi_dinh"]},
        )

        state = parse_state(
            db.query(ThreadMemory).filter(ThreadMemory.thread_id == thread.id).one()
        )
        assert state.turn_count == 2
        assert [f["statement"] for f in state.facts_learned] == [
            "Mẹ hay ngồi ngoài phòng khách",
            "Con về thứ bảy",
        ]
        # Every remembered fact points back at the message it came from.
        assert all(f["source_message_id"] for f in state.facts_learned)
        assert state.entities_seen == ["le_thi_dinh"]
        assert len(state.already_asked) == 1
    finally:
        db.close()


# --- compaction ---

def test_compaction_due_only_after_the_configured_turns():
    row = _memory()
    row.turn_count, row.compacted_turn = 5, 0
    assert compaction_due(row, every=6) is False
    row.turn_count = 6
    assert compaction_due(row, every=6) is True
    row.compacted_turn = 6
    assert compaction_due(row, every=6) is False
    assert compaction_due(None, every=6) is False


def test_compact_without_api_key_leaves_memory_untouched(client):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        thread = _heritage_thread(db)
        _turn(
            db,
            thread,
            ask="Bố ơi",
            reply_body="Bố đây con.",
            meta={"new_facts": ["Con đang thử app"]},
        )
        row = (
            db.query(ThreadMemory).filter(ThreadMemory.thread_id == thread.id).one()
        )
        row.turn_count = 6
        db.commit()

        settings = Settings(gemini_api_key="", heritage_memory_compact_every=6)
        history = (
            db.query(Message).filter(Message.thread_id == thread.id).all()
        )
        assert (
            compact_thread_memory(
                db, thread=thread, settings=settings, history=history
            )
            is False
        )
        assert [f["statement"] for f in parse_state(row).facts_learned] == [
            "Con đang thử app"
        ]
    finally:
        db.close()


def test_record_turn_keeps_only_what_was_actually_said(client):
    """An inferred fact must not come back as something the family stated."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        thread = _heritage_thread(db)
        _turn(
            db,
            thread,
            ask="Cuối tuần con về ạ.",
            reply_body="Bố chờ con.",
            meta={
                "new_facts": [
                    {
                        "statement": "Con về nhà 2026-08-08",
                        "kind": "event",
                        "occurred_at": "2026-08-08",
                        "confidence": "stated",
                    },
                    {
                        "statement": "Con đang buồn chuyện công việc",
                        "kind": "life_state",
                        "confidence": "implied",
                    },
                ]
            },
        )
        state = parse_state(
            db.query(ThreadMemory).filter(ThreadMemory.thread_id == thread.id).one()
        )
        assert [f["statement"] for f in state.facts_learned] == [
            "Con về nhà 2026-08-08"
        ]
        assert state.facts_learned[0]["occurred_at"] == "2026-08-08"
    finally:
        db.close()


def test_compaction_may_retire_a_fact_but_never_reword_one(client):
    from unittest.mock import patch

    from app.db import SessionLocal
    from app.services.heritage_gemini import GeminiResult

    db = SessionLocal()
    try:
        thread = _heritage_thread(db)
        _turn(
            db,
            thread,
            ask="Mẹ đang ở phòng ngoài.",
            reply_body="Bố biết rồi.",
            meta={
                "new_facts": [
                    {"statement": "Mẹ đang ở phòng ngoài", "confidence": "stated"},
                    {"statement": "Con làm nghề dạy học", "confidence": "stated"},
                ]
            },
        )
        row = (
            db.query(ThreadMemory).filter(ThreadMemory.thread_id == thread.id).one()
        )
        row.turn_count = 6
        db.commit()

        compacted = json.dumps(
            {
                "topics_open": ["chuyện lớp của con"],
                "emotional_tone": "ấm áp",
                "retire_statements": ["Mẹ đang ở phòng ngoài"],
                # A rewrite attempt the code must ignore.
                "facts_learned": ["Con làm bác sĩ"],
            },
            ensure_ascii=False,
        )
        settings = Settings(
            gemini_api_key="test-key", heritage_memory_compact_every=6, seed_demo=False
        )
        history = db.query(Message).filter(Message.thread_id == thread.id).all()
        with patch(
            "app.services.heritage_memory.call_gemini",
            return_value=GeminiResult(text=compacted),
        ):
            assert (
                compact_thread_memory(
                    db, thread=thread, settings=settings, history=history
                )
                is True
            )

        state = parse_state(row)
        assert [f["statement"] for f in state.facts_learned] == [
            "Con làm nghề dạy học"
        ]
        assert state.topics_open == ["chuyện lớp của con"]
        assert state.emotional_tone == "ấm áp"
    finally:
        db.close()
