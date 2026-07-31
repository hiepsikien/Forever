from __future__ import annotations

from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from .auth import hash_password
from .models import (
    FamilySpace,
    InterviewPrompt,
    Membership,
    MemoryItem,
    Message,
    Thread,
    User,
)

ORIGIN_PROMPTS = [
    "Món ăn nào khiến cả nhà nhớ về nhà nhất?",
    "Câu cửa miệng nào của bố/mẹ/ông/bà mà con vẫn nhớ?",
    "Kể một kỷ niệm nhỏ với mẹ mà con muốn giữ mãi.",
    "Lời khuyên nào của người lớn trong nhà từng cứu con khỏi sai lầm?",
    "Khi nhớ nhà, hình ảnh đầu tiên hiện ra là gì?",
    "Biệt danh hoặc cách xưng hô đặc biệt trong gia đình mình là gì?",
    "Có truyền thống nhỏ nào (Tết, giỗ, cuối tuần) mà con muốn con cháu biết?",
    "Nếu gửi một câu cho thế hệ sau, con sẽ nói gì?",
]


def seed_interview_prompts(db: Session) -> None:
    if db.query(InterviewPrompt).first() is not None:
        return
    now = datetime.now(timezone.utc)
    for index, body in enumerate(ORIGIN_PROMPTS):
        db.add(
            InterviewPrompt(
                id=generate(),
                space_id=None,
                body=body,
                sort_order=index,
                active=True,
                created_at=now,
            )
        )
    db.commit()


def seed_if_empty(db: Session) -> None:
    seed_interview_prompts(db)

    if db.query(User).first() is not None:
        return

    now = datetime.now(timezone.utc)
    mother = User(
        id=generate(),
        firebase_uid="dev-mother",
        email="me@forever.family",
        name="Mẹ",
        handle="me",
        password_hash=hash_password("forever123"),
        created_at=now,
    )
    child = User(
        id=generate(),
        firebase_uid="dev-child",
        email="con@forever.family",
        name="Con",
        handle="con",
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
    db.add(
        Message(
            id=generate(),
            thread_id=thread.id,
            sender_user_id=None,
            sender_kind="agent",
            body=(
                "Chào cả nhà — mình là Người giữ nhà, trợ lý của Forever "
                "(không phải người đã mất). Cứ nhắn trong Phòng khách; "
                "cần mã mời hay một câu hỏi ký ức nhẹ thì gọi mình nhé."
            ),
            created_at=now,
        )
    )
    db.add(
        MemoryItem(
            id=generate(),
            space_id=space.id,
            created_by=child.id,
            kind="note",
            title="Ghi chú đầu tiên",
            body=(
                "Đây là thư viện ký ức của nhà mình. "
                "Có thể lưu tin nhắn từ Phòng khách hoặc trả lời Time-Capsule."
            ),
            media_path=None,
            media_mime=None,
            source_message_id=None,
            tags="demo",
            occurred_at=now,
            created_at=now,
        )
    )
    db.commit()
