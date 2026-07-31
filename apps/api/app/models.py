from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    handle: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[Membership]] = relationship(back_populates="user")


class FamilySpace(Base):
    __tablename__ = "family_spaces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    steward_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[Membership]] = relationship(back_populates="space")
    threads: Mapped[list[Thread]] = relationship(back_populates="space")
    invites: Mapped[list[Invite]] = relationship(back_populates="space")
    memories: Mapped[list[MemoryItem]] = relationship(back_populates="space")
    successions: Mapped[list[StewardSuccession]] = relationship(back_populates="space")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("space_id", "user_id", name="uq_membership"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")  # owner | member
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


class Thread(Base):
    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="family")  # family | heritage
    title: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="threads")
    messages: Mapped[list[Message]] = relationship(back_populates="thread")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("threads.id"), index=True)
    sender_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    sender_kind: Mapped[str] = mapped_column(String(32), default="user")  # user | agent | heritage
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    thread: Mapped[Thread] = relationship(back_populates="messages")


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="invites")


class MemoryItem(Base):
    __tablename__ = "memory_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="note")  # note | voice | photo | letter
    title: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    media_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source_message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id"), nullable=True
    )
    tags: Mapped[str] = mapped_column(String(500), default="")
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    space: Mapped[FamilySpace] = relationship(back_populates="memories")


class InterviewPrompt(Base):
    __tablename__ = "interview_prompts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str | None] = mapped_column(
        ForeignKey("family_spaces.id"), nullable=True, index=True
    )
    body: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"
    __table_args__ = (
        UniqueConstraint("prompt_id", "space_id", "user_id", name="uq_interview_answer"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("interview_prompts.id"), index=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    memory_item_id: Mapped[str] = mapped_column(ForeignKey("memory_items.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StewardSuccession(Base):
    """Designated successor for family-space stewardship (longevity / handover)."""

    __tablename__ = "steward_successions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    nominee_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    nominated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    # pending | accepted | declined | activated | revoked
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    space: Mapped[FamilySpace] = relationship(back_populates="successions")
