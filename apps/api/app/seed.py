from __future__ import annotations

from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from .auth import hash_password
from .models import FamilySpace, Membership, Message, Thread, User


def seed_if_empty(db: Session) -> None:
    if db.query(User).first() is not None:
        return

    now = datetime.now(timezone.utc)
    mother = User(
        id=generate(),
        firebase_uid="dev-mother",
        email="me@forever.family",
        name="Mẹ",
        password_hash=hash_password("forever123"),
        created_at=now,
    )
    child = User(
        id=generate(),
        firebase_uid="dev-child",
        email="con@forever.family",
        name="Con",
        password_hash=hash_password("forever123"),
        created_at=now,
    )
    db.add_all([mother, child])
    db.flush()

    space = FamilySpace(
        id=generate(),
        name="Nhà mình",
        created_by=child.id,
        steward_user_id=child.id,
        created_at=now,
    )
    db.add(space)
    db.flush()

    db.add_all(
        [
            Membership(
                id=generate(),
                space_id=space.id,
                user_id=child.id,
                role="owner",
                joined_at=now,
            ),
            Membership(
                id=generate(),
                space_id=space.id,
                user_id=mother.id,
                role="member",
                joined_at=now,
            ),
        ]
    )

    thread = Thread(
        id=generate(),
        space_id=space.id,
        kind="family",
        title="Phòng khách",
        created_at=now,
    )
    db.add(thread)
    db.flush()

    db.add(
        Message(
            id=generate(),
            thread_id=thread.id,
            sender_user_id=child.id,
            sender_kind="user",
            body="Con tạo không gian này cho cả nhà mình. Mẹ vào nhắn con nhé.",
            created_at=now,
        )
    )
    db.commit()
