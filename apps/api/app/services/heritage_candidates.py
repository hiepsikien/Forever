"""Stage 5 — chat proposes a fact, a person decides whether it is kept.

The hard rule is that no remembered person's biography grows without a human
saying yes. So the chat may only ever queue what it heard; approving is what
turns it into a `MemoryItem` the library shows and retrieval feeds back.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..models import (
    FamilySpace,
    IdentityProfile,
    MemoryCandidate,
    MemoryItem,
    Message,
    Thread,
)
from .heritage import HERITAGE_TAG_PREFIX, normalize_text

CANDIDATE_KIND = "knowledge"
MAX_PENDING_PER_IDENTITY = 40
_FULL_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def reviewer_for(thread: Thread, space: FamilySpace) -> str | None:
    """Who may judge a fact heard in this thread.

    A private thread is reviewed by its own member. Routing it to the steward
    would hand one person everything the rest of the family said in confidence.
    """
    if getattr(thread, "audience_scope", "family") == "direct":
        return thread.member_user_id
    return space.steward_user_id or space.created_by


def _already_queued(db: Session, *, identity_id: str, statement: str) -> bool:
    existing = (
        db.query(MemoryCandidate)
        .filter(
            MemoryCandidate.identity_id == identity_id,
            MemoryCandidate.status.in_(("pending", "approved")),
        )
        .all()
    )
    needle = normalize_text(statement)
    return any(normalize_text(row.statement) == needle for row in existing)


def _in_library(db: Session, *, space_id: str, identity_id: str, statement: str) -> bool:
    needle = normalize_text(statement)
    items = (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == CANDIDATE_KIND)
        .all()
    )
    tag = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    return any(
        tag in (item.tags or "") and normalize_text(item.body) == needle
        for item in items
    )


def enqueue_facts(
    db: Session,
    *,
    thread: Thread,
    identity: IdentityProfile,
    user_message: Message,
    facts: list[dict],
) -> list[MemoryCandidate]:
    """Queue the facts from one turn. Silent about duplicates and full queues."""
    if not facts:
        return []
    space = (
        db.query(FamilySpace).filter(FamilySpace.id == thread.space_id).one_or_none()
    )
    if not space:
        return []
    reviewer = reviewer_for(thread, space)
    if not reviewer:
        return []

    pending = (
        db.query(MemoryCandidate)
        .filter(
            MemoryCandidate.identity_id == identity.id,
            MemoryCandidate.status == "pending",
        )
        .count()
    )
    now = datetime.now(timezone.utc)
    queued: list[MemoryCandidate] = []
    for fact in facts:
        statement = (fact.get("statement") or "").strip()
        if not statement or pending + len(queued) >= MAX_PENDING_PER_IDENTITY:
            continue
        if _already_queued(db, identity_id=identity.id, statement=statement):
            continue
        if _in_library(
            db, space_id=thread.space_id, identity_id=identity.id, statement=statement
        ):
            continue
        row = MemoryCandidate(
            id=generate(),
            space_id=thread.space_id,
            identity_id=identity.id,
            thread_id=thread.id,
            source_message_id=fact.get("source_message_id") or user_message.id,
            reviewer_user_id=reviewer,
            statement=statement,
            fact_kind=fact.get("kind") or "event",
            subject_slug=fact.get("subject_slug") or "",
            occurred_at=fact.get("occurred_at") or "",
            status="pending",
            created_at=now,
        )
        db.add(row)
        queued.append(row)
    if queued:
        db.commit()
    return queued


def approve(
    db: Session, *, candidate: MemoryCandidate, user_id: str
) -> MemoryItem:
    """Turn a candidate into library knowledge the chat can cite next time."""
    now = datetime.now(timezone.utc)
    occurred = None
    if _FULL_DATE.match(candidate.occurred_at or ""):
        occurred = datetime.fromisoformat(candidate.occurred_at).replace(
            tzinfo=timezone.utc
        )
    item = MemoryItem(
        id=generate(),
        space_id=candidate.space_id,
        created_by=user_id,
        kind=CANDIDATE_KIND,
        title=candidate.statement[:120],
        body=candidate.statement,
        source_message_id=candidate.source_message_id,
        tags=f"{HERITAGE_TAG_PREFIX}{candidate.identity_id}",
        occurred_at=occurred,
        created_at=now,
    )
    db.add(item)
    db.flush()
    candidate.status = "approved"
    candidate.memory_item_id = item.id
    candidate.reviewed_at = now
    candidate.reviewed_by = user_id
    db.commit()
    db.refresh(item)
    return item


def dismiss(db: Session, *, candidate: MemoryCandidate, user_id: str) -> None:
    candidate.status = "dismissed"
    candidate.reviewed_at = datetime.now(timezone.utc)
    candidate.reviewed_by = user_id
    db.commit()


def candidates_for_reviewer(
    db: Session, *, space_id: str, user_id: str, status: str = "pending"
) -> list[MemoryCandidate]:
    return (
        db.query(MemoryCandidate)
        .filter(
            MemoryCandidate.space_id == space_id,
            MemoryCandidate.reviewer_user_id == user_id,
            MemoryCandidate.status == status,
        )
        .order_by(MemoryCandidate.created_at.desc())
        .all()
    )
