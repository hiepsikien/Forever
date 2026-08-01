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
