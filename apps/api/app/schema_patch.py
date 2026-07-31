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
