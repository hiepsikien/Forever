"""voice_for_identity must prefer «Dùng cho Gọi», not the newest clone row."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from nanoid import generate

from app.db import SessionLocal
from app.models import FamilySpace, IdentityProfile, User, VoiceProfile
from app.services.heritage import voice_for_identity


def test_voice_for_identity_prefers_call_tts_prefs_over_newer_clone():
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    steward = User(
        id=generate(),
        firebase_uid=generate(),
        email=f"{generate()}@example.com",
        name="Steward",
        created_at=now,
    )
    db.add(steward)
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
        display_name="Đoàn Thị Thông",
        relation_label="Bà Nội",
        status="remembered",
        created_by=steward.id,
        created_at=now,
    )
    db.add(identity)
    db.commit()

    older_call = VoiceProfile(
        id=generate(),
        space_id=space.id,
        subject_kind="heritage",
        identity_profile_id=identity.id,
        provider="minimax",
        provider_voice_id="clone-northern",
        status="ready",
        display_name="Bà Bắc",
        tts_prefs_json=json.dumps(
            {"provider": "minimax", "provider_voice_id": "clone-northern"},
            ensure_ascii=False,
        ),
        created_by=steward.id,
        created_at=now - timedelta(days=30),
        updated_at=now - timedelta(days=30),
    )
    newer_bare = VoiceProfile(
        id=generate(),
        space_id=space.id,
        subject_kind="heritage",
        identity_profile_id=identity.id,
        provider="minimax",
        provider_voice_id="clone-southern",
        status="ready",
        display_name="Bà Nam mới",
        tts_prefs_json="",
        created_by=steward.id,
        created_at=now,
        updated_at=now,
    )
    db.add_all([older_call, newer_bare])
    db.commit()
    db.refresh(identity)

    try:
        picked = voice_for_identity(db, identity)
        assert picked is not None
        assert picked.id == older_call.id
        assert picked.provider_voice_id == "clone-northern"
    finally:
        db.close()


def test_voice_for_identity_skips_archived():
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    steward = User(
        id=generate(),
        firebase_uid=generate(),
        email=f"{generate()}@example.com",
        name="Steward",
        created_at=now,
    )
    db.add(steward)
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
        display_name="Bà",
        relation_label="Bà Nội",
        status="remembered",
        created_by=steward.id,
        created_at=now,
    )
    db.add(identity)
    db.commit()

    archived = VoiceProfile(
        id=generate(),
        space_id=space.id,
        subject_kind="heritage",
        identity_profile_id=identity.id,
        provider="minimax",
        provider_voice_id="old-archived",
        status="ready",
        display_name="Archived",
        tts_prefs_json=json.dumps(
            {"provider": "minimax", "provider_voice_id": "old-archived"},
            ensure_ascii=False,
        ),
        archived_at=now,
        created_by=steward.id,
        created_at=now - timedelta(days=1),
        updated_at=now,
    )
    active = VoiceProfile(
        id=generate(),
        space_id=space.id,
        subject_kind="heritage",
        identity_profile_id=identity.id,
        provider="minimax",
        provider_voice_id="active-clone",
        status="ready",
        display_name="Active",
        tts_prefs_json="",
        created_by=steward.id,
        created_at=now - timedelta(days=2),
        updated_at=now - timedelta(days=2),
    )
    db.add_all([archived, active])
    db.commit()
    db.refresh(identity)

    try:
        picked = voice_for_identity(db, identity)
        assert picked is not None
        assert picked.id == active.id
    finally:
        db.close()
