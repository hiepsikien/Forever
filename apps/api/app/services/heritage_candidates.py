"""Stage 5 — chat proposes a fact, a person decides whether it is kept.

The hard rule is that no remembered person's biography grows without a human
saying yes. So the chat may only ever queue what it heard; approving is what
turns it into a `MemoryItem` the library shows and retrieval feeds back.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy import or_, select
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
from .heritage_memory import PERISHABLE_KINDS
from .memory_scope import FAMILY, normalize_visibility, readable_by

CANDIDATE_KIND = "knowledge"
MAX_PENDING_PER_IDENTITY = 40
_FULL_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Shortest overlap we will treat as one fact restated at a different length.
_PREFIX_MIN = 60


def _same_fact(one: str, other: str) -> bool:
    """One fact stated twice, possibly clipped to a different length.

    A statement is capped before it is stored, so the same sentence can arrive
    both whole and clipped — and a library that shows a memory twice, once cut
    off mid-word, reads like a bug in the family's own archive.
    """
    a, b = normalize_text(one), normalize_text(other)
    if a == b:
        return True
    short, long = sorted((a, b), key=len)
    return len(short) >= _PREFIX_MIN and long.startswith(short)


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
    return any(_same_fact(row.statement, statement) for row in existing)


def _in_library(
    db: Session,
    *,
    space_id: str,
    identity_id: str,
    statement: str,
    reader: str | None = None,
) -> bool:
    """Only what this reviewer can see counts as already kept.

    Deduplicating against someone else's private memory would refuse the fact
    without being able to say why — and that refusal is itself a leak.
    """
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind == CANDIDATE_KIND,
            readable_by(reader),
        )
        .all()
    )
    tag = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    return any(
        tag in (item.tags or "") and _same_fact(item.body or "", statement)
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
        # "Công việc hôm nay tốt đẹp" is true today and noise in a life story.
        # It still lives in the thread memory, it just is not offered as one.
        if fact.get("kind") in PERISHABLE_KINDS:
            continue
        if _already_queued(db, identity_id=identity.id, statement=statement):
            continue
        if _in_library(
            db,
            space_id=thread.space_id,
            identity_id=identity.id,
            statement=statement,
            reader=reviewer,
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
    db: Session,
    *,
    candidate: MemoryCandidate,
    user_id: str,
    visibility: str = FAMILY,
    statement: str | None = None,
) -> MemoryItem:
    """Turn a candidate into library knowledge the chat can cite next time.

    Keeping something is no longer the same as telling everyone: a fact heard in
    a private room can be kept `private`, and then only that member's own room
    with the remembered person may quote it back.

    `statement` lets the reviewer fix a near-miss before it is written — the
    model often has the right fact with one wrong word.
    """
    now = datetime.now(timezone.utc)
    kept = (statement or "").strip() or candidate.statement
    if statement is not None and statement.strip():
        candidate.statement = kept
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
        title=kept[:120],
        body=kept,
        source_message_id=candidate.source_message_id,
        tags=f"{HERITAGE_TAG_PREFIX}{candidate.identity_id}",
        visibility=normalize_visibility(visibility),
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


def family_thread_ids(db: Session, space_id: str):
    """Threads the whole family shares — everything except a member's own room."""
    return select(Thread.id).where(
        Thread.space_id == space_id,
        or_(Thread.audience_scope.is_(None), Thread.audience_scope != "direct"),
    )


def candidates_for_reviewer(
    db: Session,
    *,
    space_id: str,
    user_id: str,
    status: str = "pending",
    include_family_scope: bool = False,
) -> list[MemoryCandidate]:
    """The queue this person may act on.

    `include_family_scope` widens it for a moderator, but only to what was said
    in a shared thread. A fact overheard in someone's private room stays on
    that member's desk no matter who is asking.
    """
    query = db.query(MemoryCandidate).filter(
        MemoryCandidate.space_id == space_id,
        MemoryCandidate.status == status,
    )
    if include_family_scope:
        query = query.filter(
            or_(
                MemoryCandidate.reviewer_user_id == user_id,
                MemoryCandidate.thread_id.in_(family_thread_ids(db, space_id)),
            )
        )
    else:
        query = query.filter(MemoryCandidate.reviewer_user_id == user_id)
    return query.order_by(MemoryCandidate.created_at.desc()).all()
