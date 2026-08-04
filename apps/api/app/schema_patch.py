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
        "voice_profiles",
        "identity_profile_id",
        "ALTER TABLE voice_profiles ADD COLUMN identity_profile_id VARCHAR(32)",
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
