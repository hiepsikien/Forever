"""Voiceprint match: the person who spoke, not the account that sent the clip."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

from nanoid import generate

from app.config import Settings
from app.db import SessionLocal
from app.models import FamilySpace, IdentityProfile, Message, SpeakerPrint, Thread, User, VoiceSample
from app.services.heritage_chat import _detect_audience
from app.services.speaker_id import (
    EmbedObservation,
    HouseholdMember,
    SeedClip,
    SpeakerDecision,
    SpeakerPrintView,
    anchor_user_id,
    apply_speaker_turn,
    assign_seed_clips,
    blend,
    decide_speaker,
    fuse_speaker,
    match_spoken_intro,
    normalize,
    recognized_speaker_id,
    spoken_speaker_id,
)


def _unit(*values: float) -> list[float]:
    return normalize(list(values))


SON = _unit(1.0, 0.0)
MOM = _unit(0.0, 1.0)
BROTHER = _unit(-0.15, -1.0)
THRESH = dict(threshold=0.6, margin=0.1, min_duration_s=1.5, half_min_cosine=0.25)


def test_mother_on_sons_phone_matches_mother_not_the_account():
    prints = [SpeakerPrintView("son", SON), SpeakerPrintView("mom", MOM)]
    decision = decide_speaker(
        _unit(0.04, 1.0),
        halves=None,
        duration_s=3.0,
        prints=prints,
        **THRESH,
    )
    assert decision.reason == "match"
    assert decision.user_id == "mom"
    assert decision.enroll_user_id == "mom"


def test_son_and_brother_on_mothers_phone_each_match_themselves():
    prints = [
        SpeakerPrintView("son", SON),
        SpeakerPrintView("mom", MOM),
        SpeakerPrintView("brother", BROTHER),
    ]
    son_turn = decide_speaker(
        _unit(1.0, 0.05),
        halves=None,
        duration_s=2.0,
        prints=prints,
        **THRESH,
    )
    brother_turn = decide_speaker(
        _unit(-0.1, -1.0),
        halves=None,
        duration_s=2.0,
        prints=prints,
        **THRESH,
    )
    assert son_turn.user_id == "son"
    assert brother_turn.user_id == "brother"


def test_unsure_short_and_mixed_do_not_switch():
    prints = [SpeakerPrintView("son", SON), SpeakerPrintView("mom", MOM)]
    unsure = decide_speaker(
        _unit(1.0, 1.0),
        halves=None,
        duration_s=3.0,
        prints=prints,
        **THRESH,
    )
    assert unsure.reason == "unsure"
    assert unsure.user_id is None
    assert unsure.enroll_user_id is None

    short = decide_speaker(
        MOM, halves=None, duration_s=0.8, prints=prints, **THRESH
    )
    assert short.reason == "short"

    mixed = decide_speaker(
        MOM,
        halves=(SON, MOM),
        duration_s=4.0,
        prints=prints,
        **THRESH,
    )
    assert mixed.reason == "mixed"
    assert mixed.enroll_user_id is None


def test_no_gallery_stays_on_the_account():
    decision = decide_speaker(
        MOM, halves=None, duration_s=3.0, prints=[], **THRESH
    )
    assert decision.reason == "no_gallery"
    assert decision.user_id is None


def test_seed_reassigns_cross_account_clips_and_does_not_invent_people():
    clips = [
        SeedClip("son", SON, trusted=True),
        SeedClip("mom", MOM, trusted=True),
        SeedClip("brother", BROTHER, trusted=True),
        # Mẹ on con's account.
        SeedClip("son", _unit(0.02, 1.0), trusted=False),
        # Con and anh on mẹ's account.
        SeedClip("mom", _unit(0.98, 0.02), trusted=False),
        SeedClip("mom", _unit(-0.05, -1.0), trusted=False),
        # Nobody we know.
        SeedClip("mom", _unit(1.0, 1.0), trusted=False),
        # A guest with only a turn and no anchor.
        SeedClip("guest", _unit(1.0, -1.0), trusted=False),
    ]
    assigned = assign_seed_clips(clips, threshold=0.6, margin=0.1)
    assert set(assigned) == {"son", "mom", "brother"}
    assert len(assigned["mom"]) == 2  # anchor + the clip from son's account
    assert len(assigned["son"]) == 2
    assert len(assigned["brother"]) == 2
    assert "guest" not in assigned


def test_turns_alone_do_not_open_a_print():
    clips = [SeedClip("son", SON, trusted=False), SeedClip("son", SON, trusted=False)]
    assert assign_seed_clips(clips, threshold=0.6, margin=0.1) == {}


def test_heritage_clone_is_not_an_anchor():
    heritage = SimpleNamespace(
        archived_at=None, subject_kind="heritage", subject_user_id=None
    )
    remembered = SimpleNamespace(status="remembered", linked_user_id=None)
    assert anchor_user_id(heritage, remembered) is None
    self_voice = SimpleNamespace(
        archived_at=None, subject_kind="self", subject_user_id="mom"
    )
    assert anchor_user_id(self_voice, None) == "mom"


def test_blend_caps_the_weight():
    updated, count = blend(SON, 32, MOM, cap=32)
    assert count == 32
    assert updated is not None
    # 31/32 of son plus 1/32 of mother — still mostly son, but she moved it.
    assert updated[0] > updated[1]


def _settings() -> Settings:
    return Settings(
        speaker_id_enabled=True,
        speaker_match_threshold=0.6,
        speaker_match_margin=0.1,
        speaker_min_duration_s=1.5,
        speaker_half_min_cosine=0.25,
        speaker_print_cap=32,
    )


def _print(db, space_id: str, user_id: str, vector: list[float], count: int = 1):
    now = datetime.now(timezone.utc)
    db.add(
        SpeakerPrint(
            id=generate(),
            space_id=space_id,
            user_id=user_id,
            embedding_json=json.dumps(vector),
            sample_count=count,
            created_at=now,
            updated_at=now,
        )
    )


def test_live_turn_enrolls_the_matched_person_not_the_account(client):
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        son = User(
            id=generate(),
            firebase_uid=generate(),
            email=f"{generate()}@example.com",
            name="Đình Anh",
            handle="dinh-anh",
            created_at=now,
        )
        mom = User(
            id=generate(),
            firebase_uid=generate(),
            email=f"{generate()}@example.com",
            name="Lê Thị Định",
            handle="dinh",
            created_at=now,
        )
        db.add_all([son, mom])
        db.commit()
        space = FamilySpace(
            id=generate(),
            name="Nhà",
            created_by=son.id,
            steward_user_id=son.id,
            created_at=now,
        )
        db.add(space)
        db.commit()
        thread = Thread(
            id=generate(),
            space_id=space.id,
            kind="heritage",
            title="Bố",
            audience_scope="direct",
            member_user_id=son.id,
            created_at=now,
        )
        db.add(thread)
        db.add(
            IdentityProfile(
                id=generate(),
                space_id=space.id,
                display_name="Mẹ",
                relation_label="Vợ",
                status="living",
                linked_user_id=mom.id,
                created_by=son.id,
                created_at=now,
            )
        )
        db.add(
            IdentityProfile(
                id=generate(),
                space_id=space.id,
                display_name="Anh",
                relation_label="Con",
                status="living",
                linked_user_id=son.id,
                created_by=son.id,
                created_at=now,
            )
        )
        db.commit()
        message = Message(
            id=generate(),
            thread_id=thread.id,
            sender_user_id=son.id,
            sender_kind="user",
            kind="voice",
            body="Con mới về nhà.",
            meta_json="",
            created_at=now,
        )
        db.add(message)
        _print(db, space.id, son.id, SON, 4)
        _print(db, space.id, mom.id, MOM, 4)
        db.commit()

        before_samples = db.query(VoiceSample).count()
        apply_speaker_turn(
            db,
            space_id=space.id,
            message=message,
            observation=EmbedObservation(_unit(0.03, 1.0), 3.2),
            settings=_settings(),
        )
        db.refresh(message)
        assert recognized_speaker_id(message) == mom.id
        assert message.sender_user_id == son.id
        mom_print = (
            db.query(SpeakerPrint)
            .filter(SpeakerPrint.user_id == mom.id, SpeakerPrint.space_id == space.id)
            .one()
        )
        son_print = (
            db.query(SpeakerPrint)
            .filter(SpeakerPrint.user_id == son.id, SpeakerPrint.space_id == space.id)
            .one()
        )
        assert mom_print.sample_count == 5
        assert son_print.sample_count == 4
        assert db.query(VoiceSample).count() == before_samples

        # A second pass must not enroll the same clip again.
        apply_speaker_turn(
            db,
            space_id=space.id,
            message=message,
            observation=EmbedObservation(_unit(0.03, 1.0), 3.2),
            settings=_settings(),
        )
        db.refresh(mom_print)
        assert mom_print.sample_count == 5

        assert (
            _detect_audience(
                db,
                space_id=space.id,
                sender_user_id=son.id,
                speaker_user_id=mom.id,
                user_text="Con mới về nhà.",
                thread=thread,
            )
            == "spouse"
        )
        assert (
            _detect_audience(
                db,
                space_id=space.id,
                sender_user_id=son.id,
                user_text="Con mới về nhà.",
                thread=thread,
            )
            == "child"
        )
    finally:
        db.close()


def test_unsure_clip_does_not_touch_the_account_print(client):
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        son = User(
            id=generate(),
            firebase_uid=generate(),
            email=f"{generate()}@example.com",
            name="Đình Anh",
            created_at=now,
        )
        db.add(son)
        db.commit()
        space = FamilySpace(
            id=generate(),
            name="Nhà",
            created_by=son.id,
            steward_user_id=son.id,
            created_at=now,
        )
        db.add(space)
        db.commit()
        thread = Thread(
            id=generate(),
            space_id=space.id,
            kind="heritage",
            title="Bố",
            audience_scope="family",
            created_at=now,
        )
        message = Message(
            id=generate(),
            thread_id=thread.id,
            sender_user_id=son.id,
            sender_kind="user",
            kind="voice",
            body="alo",
            meta_json="",
            created_at=now,
        )
        db.add_all([thread, message])
        _print(db, space.id, son.id, SON, 3)
        db.commit()
        apply_speaker_turn(
            db,
            space_id=space.id,
            message=message,
            observation=EmbedObservation(MOM, 2.5),
            settings=_settings(),
        )
        db.refresh(message)
        assert recognized_speaker_id(message) is None
        meta = json.loads(message.meta_json)
        assert meta["speaker"]["reason"] == "unsure"
        assert meta["speaker"]["enrolled"] is False
        row = db.query(SpeakerPrint).filter(SpeakerPrint.user_id == son.id).one()
        assert row.sample_count == 3
    finally:
        db.close()


SON_MEMBER = HouseholdMember("son", ("dinh anh",), "child", "con")
MOM_MEMBER = HouseholdMember("mom", ("le thi dinh", "thi dinh", "dinh"), "spouse", "vo")
BROTHER_MEMBER = HouseholdMember("brother", ("quang",), "sibling", "em")
SPOUSE_WORDS = dict(spouse_self="anh", spouse_other="em")


def test_named_intro_and_em_day_name_one_person():
    house = [SON_MEMBER, MOM_MEMBER, BROTHER_MEMBER]
    assert match_spoken_intro("Con Đình Anh đây ạ", house, **SPOUSE_WORDS) == "son"
    assert match_spoken_intro("Anh ơi, em đây", house, **SPOUSE_WORDS) == "mom"
    # «em đây» alone is also the younger brother. Don't guess.
    assert match_spoken_intro("Em đây", house, **SPOUSE_WORDS) is None
    assert match_spoken_intro("Em đây", [SON_MEMBER, MOM_MEMBER], **SPOUSE_WORDS) == "mom"


def test_mentioning_someone_is_not_an_introduction():
    house = [SON_MEMBER, MOM_MEMBER]
    assert match_spoken_intro("Con mới về nhà.", house, **SPOUSE_WORDS) is None
    assert match_spoken_intro("kể chuyện Đình Anh đây", house, **SPOUSE_WORDS) is None
    grandchild = HouseholdMember("chau", ("huong ly",), "grandchild", "chau")
    assert match_spoken_intro("Cháu Hương Ly mới đi học", [grandchild], **SPOUSE_WORDS) is None
    assert match_spoken_intro("Con đây rồi", house, **SPOUSE_WORDS) is None


def test_con_day_needs_a_single_child():
    other = HouseholdMember("sister", ("lan",), "child", "con")
    assert match_spoken_intro("Con đây ạ", [SON_MEMBER, MOM_MEMBER], **SPOUSE_WORDS) == "son"
    assert (
        match_spoken_intro("Con đây ạ", [SON_MEMBER, other, MOM_MEMBER], **SPOUSE_WORDS)
        is None
    )


def test_voice_wins_and_words_do_not_enroll():
    voice = SpeakerDecision("mom", True, "mom", 0.91, 0.2, "match")
    fused = fuse_speaker(voice, "son")
    assert fused.user_id == "mom"
    assert fused.enroll_user_id == "mom"
    assert fused.reason == "match"

    unsure = SpeakerDecision(None, False, None, 0.5, 0.48, "unsure")
    fused_words = fuse_speaker(unsure, "mom")
    assert fused_words.user_id == "mom"
    assert fused_words.enroll_user_id is None
    assert fused_words.reason == "words"
    assert fuse_speaker(unsure, None).reason == "unsure"


def test_words_name_the_speaker_when_the_voice_does_not(client):
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        son = User(
            id=generate(),
            firebase_uid=generate(),
            email=f"{generate()}@example.com",
            name="Đình Anh",
            created_at=now,
        )
        mom = User(
            id=generate(),
            firebase_uid=generate(),
            email=f"{generate()}@example.com",
            name="Lê Thị Định",
            created_at=now,
        )
        brother = User(
            id=generate(),
            firebase_uid=generate(),
            email=f"{generate()}@example.com",
            name="Quang",
            created_at=now,
        )
        db.add_all([son, mom, brother])
        db.commit()
        space = FamilySpace(
            id=generate(),
            name="Nhà",
            created_by=son.id,
            steward_user_id=son.id,
            created_at=now,
        )
        db.add(space)
        db.commit()
        father = IdentityProfile(
            id=generate(),
            space_id=space.id,
            display_name="Bố",
            relation_label="Bố",
            status="remembered",
            address_forms_json=json.dumps(
                {
                    "with_spouse": {"self": "anh", "other": "em"},
                    "with_children": {"self": "bố", "other": "con"},
                }
            ),
            created_by=son.id,
            created_at=now,
        )
        db.add(father)
        db.commit()
        thread = Thread(
            id=generate(),
            space_id=space.id,
            kind="heritage",
            title="Bố",
            heritage_identity_id=father.id,
            audience_scope="direct",
            member_user_id=son.id,
            created_at=now,
        )
        db.add(thread)
        db.add_all(
            [
                IdentityProfile(
                    id=generate(),
                    space_id=space.id,
                    display_name="Anh",
                    relation_label="Con",
                    status="living",
                    linked_user_id=son.id,
                    created_by=son.id,
                    created_at=now,
                ),
                IdentityProfile(
                    id=generate(),
                    space_id=space.id,
                    display_name="Mẹ",
                    relation_label="Vợ",
                    status="living",
                    linked_user_id=mom.id,
                    created_by=son.id,
                    created_at=now,
                ),
                IdentityProfile(
                    id=generate(),
                    space_id=space.id,
                    display_name="Quang",
                    relation_label="Em trai",
                    status="living",
                    linked_user_id=brother.id,
                    created_by=son.id,
                    created_at=now,
                ),
            ]
        )
        db.commit()

        assert spoken_speaker_id(db, thread, "Con Đình Anh đây ạ") == son.id
        assert spoken_speaker_id(db, thread, "Anh ơi em đây") == mom.id
        assert spoken_speaker_id(db, thread, "Con mới về nhà.") is None

        def _voice(body: str) -> Message:
            message = Message(
                id=generate(),
                thread_id=thread.id,
                sender_user_id=son.id,
                sender_kind="user",
                kind="voice",
                body=body,
                meta_json="",
                created_at=now,
            )
            db.add(message)
            db.commit()
            return message

        _print(db, space.id, son.id, SON, 4)
        _print(db, space.id, mom.id, MOM, 4)
        db.commit()

        # She says the son's name, but the voice is hers. Address her, and
        # enroll her print — not the person the sentence named.
        hers = _voice("Con Đình Anh đây ạ")
        apply_speaker_turn(
            db,
            space_id=space.id,
            message=hers,
            observation=EmbedObservation(_unit(0.03, 1.0), 3.2),
            settings=_settings(),
            spoken_user_id=son.id,
        )
        db.refresh(hers)
        assert recognized_speaker_id(hers) == mom.id
        meta = json.loads(hers.meta_json)
        assert meta["speaker"]["reason"] == "match"
        assert meta["speaker"]["words_user_id"] == son.id
        assert meta["speaker"]["enrolled"] is True
        mom_print = (
            db.query(SpeakerPrint)
            .filter(SpeakerPrint.user_id == mom.id, SpeakerPrint.space_id == space.id)
            .one()
        )
        son_print = (
            db.query(SpeakerPrint)
            .filter(SpeakerPrint.user_id == son.id, SpeakerPrint.space_id == space.id)
            .one()
        )
        assert mom_print.sample_count == 5
        assert son_print.sample_count == 4

        # Too short to trust the voice. The introduction still names her,
        # and the clip is not written into anyone's print.
        intro = _voice("Anh ơi em đây")
        apply_speaker_turn(
            db,
            space_id=space.id,
            message=intro,
            observation=EmbedObservation(MOM, 0.8),
            settings=_settings(),
            spoken_user_id=mom.id,
        )
        db.refresh(intro)
        db.refresh(mom_print)
        assert recognized_speaker_id(intro) == mom.id
        intro_meta = json.loads(intro.meta_json)
        assert intro_meta["speaker"]["reason"] == "words"
        assert intro_meta["speaker"]["voice_reason"] == "short"
        assert intro_meta["speaker"]["enrolled"] is False
        assert mom_print.sample_count == 5
        assert (
            _detect_audience(
                db,
                space_id=space.id,
                sender_user_id=son.id,
                speaker_user_id=mom.id,
                user_text="Anh ơi em đây",
                thread=thread,
            )
            == "spouse"
        )
    finally:
        db.close()
