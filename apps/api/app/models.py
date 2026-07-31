from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
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
    sender_kind: Mapped[str] = mapped_column(String(32), default="user")  # user | heritage
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
