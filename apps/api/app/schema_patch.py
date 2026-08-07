from __future__ import annotations

from sqlalchemy import inspect, text

from .db import SessionLocal, engine
from .models import User
from .services.handles import allocate_handle


def _add_column_if_missing(table: str, column: str, ddl: str) -> None:
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns(table)}
    if column in columns:
        return
    with engine.begin() as conn:
        conn.execute(text(ddl))


def _backfill_heritage_threads() -> None:
    """Point pre-split heritage threads at their identity as the family thread.

    Before the 1-1 split, IdentityProfile.heritage_thread_id was the only link
    and every heritage thread was shared. Those become the family thread.
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if not {"threads", "identity_profiles"} <= tables:
        return
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE threads SET heritage_identity_id = ("
                    "  SELECT p.id FROM identity_profiles p"
                    "  WHERE p.heritage_thread_id = threads.id"
                    ") WHERE kind = 'heritage' AND heritage_identity_id IS NULL"
                )
            )
            conn.execute(
                text(
                    "UPDATE threads SET audience_scope = 'family' "
                    "WHERE audience_scope IS NULL"
                )
            )
    except Exception:
        pass


def _rename_agent_phong_khach() -> None:
    """Restore agent onboard thread title if a prior patch renamed it away.

    Hero «Phòng khách» is kind=family again; Cả nhà với bố stays a list item.
    """
    inspector = inspect(engine)
    if "threads" not in inspector.get_table_names():
        return
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE threads SET title = 'Phòng khách' "
                    "WHERE kind = 'family' AND title = 'Người giữ nhà'"
                )
            )
    except Exception:
        pass


def ensure_schema() -> None:
    """Additive schema tweaks for local create_all demos (no Alembic yet)."""
    _add_column_if_missing(
        "users",
        "handle",
        "ALTER TABLE users ADD COLUMN handle VARCHAR(64)",
    )
    _add_column_if_missing(
        "users",
        "phone",
        "ALTER TABLE users ADD COLUMN phone VARCHAR(32)",
    )
    _add_column_if_missing(
        "messages",
        "kind",
        "ALTER TABLE messages ADD COLUMN kind VARCHAR(32) DEFAULT 'text'",
    )
    _add_column_if_missing(
        "messages",
        "media_path",
        "ALTER TABLE messages ADD COLUMN media_path VARCHAR(512)",
    )
    _add_column_if_missing(
        "messages",
        "media_mime",
        "ALTER TABLE messages ADD COLUMN media_mime VARCHAR(120)",
    )
    _add_column_if_missing(
        "voice_samples",
        "duration_ms",
        "ALTER TABLE voice_samples ADD COLUMN duration_ms INTEGER",
    )
    _add_column_if_missing(
        "voice_samples",
        "file_size_bytes",
        "ALTER TABLE voice_samples ADD COLUMN file_size_bytes INTEGER DEFAULT 0",
    )
    _add_column_if_missing(
        "voice_samples",
        "quality_score",
        "ALTER TABLE voice_samples ADD COLUMN quality_score INTEGER",
    )
    _add_column_if_missing(
        "voice_samples",
        "quality_label",
        "ALTER TABLE voice_samples ADD COLUMN quality_label VARCHAR(32) DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_samples",
        "quality_tip",
        "ALTER TABLE voice_samples ADD COLUMN quality_tip TEXT DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_samples",
        "note",
        "ALTER TABLE voice_samples ADD COLUMN note TEXT DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_renders",
        "model_id",
        "ALTER TABLE voice_renders ADD COLUMN model_id VARCHAR(64) DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_renders",
        "provider_voice_id",
        "ALTER TABLE voice_renders ADD COLUMN provider_voice_id VARCHAR(120) DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_renders",
        "provider_voice_name",
        "ALTER TABLE voice_renders ADD COLUMN provider_voice_name VARCHAR(200) DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_renders",
        "provider",
        "ALTER TABLE voice_renders ADD COLUMN provider VARCHAR(32) DEFAULT 'elevenlabs'",
    )
    _add_column_if_missing(
        "voice_profiles",
        "identity_profile_id",
        "ALTER TABLE voice_profiles ADD COLUMN identity_profile_id VARCHAR(32)",
    )
    _add_column_if_missing(
        "identity_profiles",
        "archived_at",
        "ALTER TABLE identity_profiles ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE",
    )
    _add_column_if_missing(
        "voice_profiles",
        "archived_at",
        "ALTER TABLE voice_profiles ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE",
    )
    _add_column_if_missing(
        "voice_samples",
        "extract_job_id",
        "ALTER TABLE voice_samples ADD COLUMN extract_job_id VARCHAR(32)",
    )
    _add_column_if_missing(
        "voice_samples",
        "extract_segment_id",
        "ALTER TABLE voice_samples ADD COLUMN extract_segment_id VARCHAR(32)",
    )
    _add_column_if_missing(
        "voice_samples",
        "t_start",
        "ALTER TABLE voice_samples ADD COLUMN t_start FLOAT",
    )
    _add_column_if_missing(
        "voice_samples",
        "t_end",
        "ALTER TABLE voice_samples ADD COLUMN t_end FLOAT",
    )
    _add_column_if_missing(
        "voice_samples",
        "speaker_label",
        "ALTER TABLE voice_samples ADD COLUMN speaker_label VARCHAR(64)",
    )
    _add_column_if_missing(
        "voice_samples",
        "pipeline_stage",
        "ALTER TABLE voice_samples ADD COLUMN pipeline_stage VARCHAR(32) DEFAULT 'processed'",
    )
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE voice_samples SET pipeline_stage = 'unprocessed' "
                    "WHERE source = 'extract' AND pipeline_stage = 'processed'"
                )
            )
    except Exception:
        pass
    _add_column_if_missing(
        "voice_samples",
        "parent_sample_ids",
        "ALTER TABLE voice_samples ADD COLUMN parent_sample_ids TEXT DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_samples",
        "processing_applied",
        "ALTER TABLE voice_samples ADD COLUMN processing_applied TEXT DEFAULT ''",
    )
    _add_column_if_missing(
        "voice_renders",
        "stability",
        "ALTER TABLE voice_renders ADD COLUMN stability FLOAT",
    )
    _add_column_if_missing(
        "voice_renders",
        "similarity_boost",
        "ALTER TABLE voice_renders ADD COLUMN similarity_boost FLOAT",
    )
    _add_column_if_missing(
        "voice_renders",
        "style",
        "ALTER TABLE voice_renders ADD COLUMN style FLOAT",
    )
    _add_column_if_missing(
        "voice_renders",
        "speed",
        "ALTER TABLE voice_renders ADD COLUMN speed FLOAT",
    )
    _add_column_if_missing(
        "voice_renders",
        "use_speaker_boost",
        "ALTER TABLE voice_renders ADD COLUMN use_speaker_boost BOOLEAN",
    )
    _add_column_if_missing(
        "voice_renders",
        "lengthen_pauses",
        "ALTER TABLE voice_renders ADD COLUMN lengthen_pauses BOOLEAN",
    )
    _add_column_if_missing(
        "voice_renders",
        "emotion",
        "ALTER TABLE voice_renders ADD COLUMN emotion VARCHAR(32)",
    )
    _add_column_if_missing(
        "voice_renders",
        "pitch",
        "ALTER TABLE voice_renders ADD COLUMN pitch INTEGER",
    )
    _add_column_if_missing(
        "voice_renders",
        "intensity",
        "ALTER TABLE voice_renders ADD COLUMN intensity INTEGER",
    )
    _add_column_if_missing(
        "voice_renders",
        "timbre",
        "ALTER TABLE voice_renders ADD COLUMN timbre INTEGER",
    )
    _add_column_if_missing(
        "extract_jobs",
        "source_memory_id",
        "ALTER TABLE extract_jobs ADD COLUMN source_memory_id VARCHAR(32)",
    )
    _add_column_if_missing(
        "extract_jobs",
        "speaker_assignments_json",
        "ALTER TABLE extract_jobs ADD COLUMN speaker_assignments_json TEXT DEFAULT '{}'",
    )
    _add_column_if_missing(
        "identity_profiles",
        "heritage_entity_status",
        "ALTER TABLE identity_profiles ADD COLUMN heritage_entity_status VARCHAR(32) DEFAULT 'dormant'",
    )
    for col, ddl in (
        ("life_stage_json", "ALTER TABLE identity_profiles ADD COLUMN life_stage_json TEXT DEFAULT ''"),
        ("roles_json", "ALTER TABLE identity_profiles ADD COLUMN roles_json TEXT DEFAULT ''"),
        (
            "address_forms_json",
            "ALTER TABLE identity_profiles ADD COLUMN address_forms_json TEXT DEFAULT ''",
        ),
        (
            "speech_style_json",
            "ALTER TABLE identity_profiles ADD COLUMN speech_style_json TEXT DEFAULT ''",
        ),
        (
            "core_values_json",
            "ALTER TABLE identity_profiles ADD COLUMN core_values_json TEXT DEFAULT ''",
        ),
        ("philosophy_json", "ALTER TABLE identity_profiles ADD COLUMN philosophy_json TEXT DEFAULT ''"),
        ("taboos_json", "ALTER TABLE identity_profiles ADD COLUMN taboos_json TEXT DEFAULT ''"),
        (
            "poetry_quote_mode",
            "ALTER TABLE identity_profiles ADD COLUMN poetry_quote_mode VARCHAR(32) DEFAULT 'paraphrase'",
        ),
        (
            "dynamic_context",
            "ALTER TABLE identity_profiles ADD COLUMN dynamic_context TEXT DEFAULT ''",
        ),
        (
            "family_context_opt_in",
            "ALTER TABLE identity_profiles ADD COLUMN family_context_opt_in BOOLEAN DEFAULT FALSE",
        ),
        (
            "profile_reviewed_at",
            "ALTER TABLE identity_profiles ADD COLUMN profile_reviewed_at TIMESTAMP WITH TIME ZONE",
        ),
        (
            "profile_reviewed_by",
            "ALTER TABLE identity_profiles ADD COLUMN profile_reviewed_by VARCHAR(32)",
        ),
    ):
        _add_column_if_missing("identity_profiles", col, ddl)
    _add_column_if_missing(
        "messages",
        "meta_json",
        "ALTER TABLE messages ADD COLUMN meta_json TEXT DEFAULT ''",
    )
    _add_column_if_missing(
        "memory_items",
        "body_tts",
        "ALTER TABLE memory_items ADD COLUMN body_tts TEXT DEFAULT ''",
    )
    # Everything saved before there was a choice was saved to be shared.
    _add_column_if_missing(
        "memory_items",
        "visibility",
        "ALTER TABLE memory_items ADD COLUMN visibility VARCHAR(16) DEFAULT 'family'",
    )
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE memory_items SET visibility = 'family' "
                    "WHERE visibility IS NULL OR visibility = ''"
                )
            )
    except Exception:
        pass
    for col, ddl in (
        (
            "heritage_identity_id",
            "ALTER TABLE threads ADD COLUMN heritage_identity_id VARCHAR(32)",
        ),
        (
            "audience_scope",
            "ALTER TABLE threads ADD COLUMN audience_scope VARCHAR(32) DEFAULT 'family'",
        ),
        (
            "member_user_id",
            "ALTER TABLE threads ADD COLUMN member_user_id VARCHAR(32)",
        ),
    ):
        _add_column_if_missing("threads", col, ddl)
    _add_column_if_missing(
        "voice_profiles",
        "tts_prefs_json",
        "ALTER TABLE voice_profiles ADD COLUMN tts_prefs_json TEXT DEFAULT ''",
    )
    _add_column_if_missing(
        "space_settings",
        "heritage_daily_turn_limit",
        "ALTER TABLE space_settings ADD COLUMN heritage_daily_turn_limit INTEGER DEFAULT 20",
    )
    _add_column_if_missing(
        "space_settings",
        "heritage_warn_remaining",
        "ALTER TABLE space_settings ADD COLUMN heritage_warn_remaining INTEGER DEFAULT 3",
    )
    _add_column_if_missing(
        "space_settings",
        "heritage_max_utterance_sec",
        "ALTER TABLE space_settings ADD COLUMN heritage_max_utterance_sec INTEGER DEFAULT 60",
    )
    _backfill_heritage_threads()
    _rename_agent_phong_khach()
    try:
        with engine.begin() as conn:
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_handle ON users (handle)")
            )
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone ON users (phone)")
            )
    except Exception:
        pass

    db = SessionLocal()
    try:
        for user in db.query(User).filter(User.handle.is_(None)).all():
            user.handle = allocate_handle(db, name=user.name, email=user.email)
            db.flush()
        db.commit()
    finally:
        db.close()
