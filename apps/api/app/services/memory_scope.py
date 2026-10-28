"""Who may read a memory.

A fact told in a private room may be worth keeping forever without being worth
telling the family. Before this, the review queue offered only two endings:
share it with everyone, or let it expire with the thread memory. `visibility`
is the third: kept, and still only yours.

The rule is deliberately narrow — `family` or `private`, owned by `created_by`.
Per-member sharing lists are a different feature and a much larger one.
"""

from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.sql.elements import ColumnElement

from ..models import MemoryItem, Message, Thread

FAMILY = "family"
PRIVATE = "private"
VISIBILITIES = (FAMILY, PRIVATE)


def normalize_visibility(value: str | None) -> str:
    """Anything unrecognised is shared, which is what every old row was."""
    text = (value or "").strip().lower()
    return text if text in VISIBILITIES else FAMILY


def readable_by(user_id: str | None) -> ColumnElement[bool]:
    """SQL condition for what a member may read: shared, plus their own private."""
    shared = or_(MemoryItem.visibility.is_(None), MemoryItem.visibility != PRIVATE)
    if not user_id:
        return shared
    return or_(shared, MemoryItem.created_by == user_id)


def visible_to(item: MemoryItem, user_id: str | None) -> bool:
    if normalize_visibility(item.visibility) != PRIVATE:
        return True
    return bool(user_id) and item.created_by == user_id


def reader_for_thread(thread: Thread) -> str | None:
    """Whose private memories this room may quote.

    A family room may quote none of them, however much it would help the
    answer — the wall only holds if the entity cannot speak through it.
    """
    if getattr(thread, "audience_scope", FAMILY) == "direct":
        return thread.member_user_id
    return None


def prompt_reader(thread: Thread, message: Message) -> str | None:
    """Reader for one heritage reply.

    Addressing follows a recognized speaker. The private vault does not.
    When this is a direct room and the person just recognized is not the
    room owner, the prompt sees family-visible rows only. The review queue
    is a different door and still uses `reviewer_for`.
    """
    owner = reader_for_thread(thread)
    if not owner:
        return None
    # Local import: speaker_id pulls the heritage stack, and this module is
    # the visibility wall those call sites already share.
    from .speaker_id import recognized_speaker_id

    heard = recognized_speaker_id(message)
    if heard and heard != getattr(thread, "member_user_id", None):
        return None
    return owner
