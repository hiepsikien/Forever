"""Photo/poem artifacts on the family heritage chat — the room already talking to them.

Poems are complete: show and listen. Photos ask the family to fill in what the
album caption does not say. Chat still only proposes facts; the steward reviews.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..models import IdentityProfile, Keepsake, MemoryItem, Message, Thread
from .heritage import identity_for_thread

logger = logging.getLogger(__name__)

DEFAULT_PHOTO_OPENER = (
    "Nhà mình nhớ tấm này không? Anh giữ vì nó quý — ai nhớ hôm ấy thì kể lại giúp anh."
)
ALBUM_TAG = "nguon:album-2016"
STATUSES = ("draft", "ready", "heard", "skipped", "retired")
PHOTO_KIND = "photo"
POEM_KIND = "poem"
MAX_PHOTOS_PER_DAY = 2
PHOTO_GAP = timedelta(hours=3)
# Mother's calendar day, not UTC.
FAMILY_TZ = timezone(timedelta(hours=7))


def default_photo_opener(caption: str | None) -> str:
    cap = (caption or "").strip()
    if not cap:
        return DEFAULT_PHOTO_OPENER
    return f"{DEFAULT_PHOTO_OPENER} Anh ghi: {cap[:120]}"


def family_heritage_threads(db: Session, *, space_id: str) -> list[Thread]:
    return (
        db.query(Thread)
        .filter(
            Thread.space_id == space_id,
            Thread.kind == "heritage",
            Thread.audience_scope == "family",
        )
        .all()
    )


def most_active_family_heritage_thread(db: Session, *, space_id: str) -> Thread | None:
    """The shared chat with a remembered person that has the newest message.

    Same rule as the mobile home hero: not kind=family (Người giữ nhà), not a
    private direct room.
    """
    threads = family_heritage_threads(db, space_id=space_id)
    if not threads:
        return None
    last_by_thread: dict[str, datetime] = {}
    ids = [t.id for t in threads]
    messages = (
        db.query(Message.thread_id, Message.created_at)
        .filter(Message.thread_id.in_(ids))
        .all()
    )
    for thread_id, created_at in messages:
        prev = last_by_thread.get(thread_id)
        if prev is None or created_at > prev:
            last_by_thread[thread_id] = created_at
    return max(
        threads,
        key=lambda t: last_by_thread.get(t.id) or t.created_at,
    )


def family_thread_for_identity(
    db: Session, *, space_id: str, identity_id: str
) -> Thread | None:
    rows = [
        t
        for t in family_heritage_threads(db, space_id=space_id)
        if t.heritage_identity_id == identity_id
    ]
    if not rows:
        identity = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == identity_id)
            .one_or_none()
        )
        if identity and identity.heritage_thread_id:
            thread = (
                db.query(Thread).filter(Thread.id == identity.heritage_thread_id).one_or_none()
            )
            if (
                thread
                and thread.kind == "heritage"
                and (thread.audience_scope or "family") == "family"
            ):
                return thread
        return None
    last_by_thread: dict[str, datetime] = {}
    messages = (
        db.query(Message.thread_id, Message.created_at)
        .filter(Message.thread_id.in_([t.id for t in rows]))
        .all()
    )
    for thread_id, created_at in messages:
        prev = last_by_thread.get(thread_id)
        if prev is None or created_at > prev:
            last_by_thread[thread_id] = created_at
    return max(rows, key=lambda t: last_by_thread.get(t.id) or t.created_at)


def _family_day(value: datetime | None):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(FAMILY_TZ).date()


def _slot_at(row: Keepsake) -> datetime | None:
    if row.last_opened_at:
        return row.last_opened_at
    if row.status == "skipped":
        return row.updated_at
    return None


def _offered_today(db: Session, *, space_id: str, identity_id: str) -> list[Keepsake]:
    today = _family_day(datetime.now(timezone.utc))
    rows = (
        db.query(Keepsake)
        .filter(
            Keepsake.space_id == space_id,
            Keepsake.identity_id == identity_id,
            Keepsake.kind == PHOTO_KIND,
            Keepsake.status.in_(("ready", "heard", "skipped")),
        )
        .all()
    )
    return [row for row in rows if _family_day(_slot_at(row)) == today]


def _can_offer_another(db: Session, *, space_id: str, identity_id: str) -> bool:
    used = _offered_today(db, space_id=space_id, identity_id=identity_id)
    if len(used) >= MAX_PHOTOS_PER_DAY:
        return False
    if not used:
        return True
    latest = max(
        used,
        key=lambda row: _slot_at(row) or datetime.min.replace(tzinfo=timezone.utc),
    )
    ts = _slot_at(latest)
    if ts is None:
        return True
    if latest.status == "ready" and latest.opened_message_id:
        return False
    now = datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return now - ts >= PHOTO_GAP


def _pinned_open(db: Session, *, space_id: str, identity_id: str) -> Keepsake | None:
    """The photo currently offered: still ready, or heard and waiting out the gap.

    At most two photos a day, three hours apart. Heard yesterday yields.
    """
    row = (
        db.query(Keepsake)
        .filter(
            Keepsake.space_id == space_id,
            Keepsake.identity_id == identity_id,
            Keepsake.kind == PHOTO_KIND,
            Keepsake.status.in_(("ready", "heard")),
            Keepsake.opened_message_id.isnot(None),
        )
        .order_by(Keepsake.last_opened_at.desc())
        .first()
    )
    if not row:
        return None
    now = datetime.now(timezone.utc)
    if row.status == "heard":
        if _family_day(row.last_opened_at) < _family_day(now):
            return None
        used = _offered_today(db, space_id=space_id, identity_id=identity_id)
        waited = False
        if row.updated_at:
            ts = row.updated_at
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            waited = now - ts >= PHOTO_GAP
        if waited and len(used) < MAX_PHOTOS_PER_DAY:
            return None
        return row
    return row


def _next_ready(
    db: Session, *, space_id: str, identity_id: str, kind: str
) -> Keepsake | None:
    return (
        db.query(Keepsake)
        .filter(
            Keepsake.space_id == space_id,
            Keepsake.identity_id == identity_id,
            Keepsake.status == "ready",
            Keepsake.kind == kind,
            Keepsake.opened_message_id.is_(None),
        )
        .order_by(Keepsake.created_at.asc())
        .first()
    )


def pick_today(db: Session, *, space_id: str) -> tuple[Keepsake | None, Thread | None]:
    thread = most_active_family_heritage_thread(db, space_id=space_id)
    if not thread:
        return None, None
    identity = identity_for_thread(db, thread)
    if not identity:
        return None, thread
    pinned = _pinned_open(db, space_id=space_id, identity_id=identity.id)
    if pinned:
        sync_heard(db, pinned)
        return pinned, thread
    photo = _next_ready(
        db, space_id=space_id, identity_id=identity.id, kind=PHOTO_KIND
    )
    if photo and _can_offer_another(
        db, space_id=space_id, identity_id=identity.id
    ):
        return photo, thread
    poem = _next_ready(db, space_id=space_id, identity_id=identity.id, kind=POEM_KIND)
    return poem, thread


def active_photo_keepsake(db: Session, thread: Thread) -> Keepsake | None:
    """The photo currently open on this family heritage thread, if any."""
    if thread.kind != "heritage" or (thread.audience_scope or "family") != "family":
        return None
    return (
        db.query(Keepsake)
        .filter(
            Keepsake.opened_thread_id == thread.id,
            Keepsake.status.in_(("ready", "heard")),
            Keepsake.kind == PHOTO_KIND,
            Keepsake.opened_message_id.isnot(None),
        )
        .order_by(Keepsake.last_opened_at.desc())
        .first()
    )


def story_facts_from_turn(
    db: Session, *, thread: Thread, user_message: Message
) -> list[dict]:
    """What the family said about today's photo — for the steward to keep or edit.

    Analyzer is off by default and often marks a story as implied. The ritual
    still needs a row in «Điều nghe được», so the spoken sentence itself is the
    proposal. Chat does not write the library; approving does.
    """
    active = active_photo_keepsake(db, thread)
    if not active or active.status != "ready":
        return []
    body = (user_message.body or "").strip()
    if len(body) < 12:
        return []
    memory = db.query(MemoryItem).filter(MemoryItem.id == active.memory_item_id).one_or_none()
    title = ((memory.title if memory else "") or "tấm ảnh").strip()
    statement = f"Về {title}: {body}"
    return [
        {
            "statement": statement[:800],
            "kind": "event",
            "source_message_id": user_message.id,
        }
    ]


def payload(
    db: Session,
    row: Keepsake,
    *,
    thread: Thread | None = None,
    can_skip: bool = False,
) -> dict:
    memory = db.query(MemoryItem).filter(MemoryItem.id == row.memory_item_id).one_or_none()
    identity = (
        db.query(IdentityProfile).filter(IdentityProfile.id == row.identity_id).one_or_none()
    )
    return {
        "id": row.id,
        "space_id": row.space_id,
        "identity_id": row.identity_id,
        "identity_name": (identity.display_name if identity else "") or "",
        "memory_item_id": row.memory_item_id,
        "kind": row.kind,
        "opener": row.opener,
        "status": row.status,
        "title": (memory.title if memory else "") or "",
        "body": (memory.body if memory else "") or "",
        "body_tts": (memory.body_tts if memory else "") or "",
        "has_media": bool(memory and memory.media_path),
        "media_mime": memory.media_mime if memory else None,
        "occurred_at": memory.occurred_at.isoformat() if memory and memory.occurred_at else None,
        "thread_id": (thread.id if thread else row.opened_thread_id),
        "opened_message_id": row.opened_message_id,
        "already_open": bool(row.opened_message_id),
        "can_skip": can_skip,
        "heard": row.status == "heard",
        "last_opened_at": row.last_opened_at.isoformat() if row.last_opened_at else None,
    }


def open_on_family_thread(
    db: Session,
    *,
    row: Keepsake,
    thread: Thread,
) -> Message:
    """Post the heritage opener (with photo) into the existing family chat.

    Idempotent: a second open of the same row returns the existing message.
    """
    now = datetime.now(timezone.utc)
    if row.opened_message_id:
        existing = db.query(Message).filter(Message.id == row.opened_message_id).one_or_none()
        if existing:
            return existing

    memory = db.query(MemoryItem).filter(MemoryItem.id == row.memory_item_id).one()
    media_path = None
    media_mime = None
    if memory.media_path and row.kind == PHOTO_KIND:
        # Reuse the library file — copying a multi-MB album scan blocks «Nói chuyện».
        media_path = memory.media_path
        media_mime = memory.media_mime
    opener = (row.opener or "").strip() or default_photo_opener(memory.body)
    meta = {
        "keepsake_id": row.id,
        "memory_item_id": memory.id,
        "keepsake_kind": row.kind,
    }
    message = Message(
        id=generate(),
        thread_id=thread.id,
        sender_user_id=None,
        sender_kind="heritage",
        kind="text",
        body=opener,
        media_path=media_path,
        media_mime=media_mime,
        meta_json=json.dumps(meta, ensure_ascii=False),
        created_at=now,
    )
    db.add(message)
    db.flush()
    row.opened_message_id = message.id
    row.opened_thread_id = thread.id
    row.last_opened_at = now
    row.updated_at = now
    db.commit()
    db.refresh(message)
    return message


def opener_tts_path(message: Message) -> str | None:
    raw = getattr(message, "meta_json", None) or ""
    if not raw.strip():
        return None
    try:
        meta = json.loads(raw)
    except json.JSONDecodeError:
        return None
    tts = meta.get("tts") if isinstance(meta, dict) else None
    if not isinstance(tts, dict):
        return None
    path = (tts.get("media_path") or "").strip()
    return path or None


def attach_opener_tts(message_id: str) -> None:
    """Fill cloned-voice audio onto a keepsake opener. Never raises to the request."""
    from ..config import get_settings
    from ..db import SessionLocal
    from .heritage import identity_for_thread, voice_for_identity
    from .heritage_pipeline import load_heritage_pipeline
    from .heritage_tts import synthesize_chat_reply

    db = SessionLocal()
    try:
        message = db.query(Message).filter(Message.id == message_id).one_or_none()
        if not message or opener_tts_path(message):
            return
        thread = db.query(Thread).filter(Thread.id == message.thread_id).one_or_none()
        if not thread:
            return
        identity = identity_for_thread(db, thread)
        if not identity:
            return
        settings = get_settings()
        pipeline = load_heritage_pipeline(db, thread.space_id, settings=settings)
        if not pipeline.tts:
            return
        voice = voice_for_identity(db, identity)
        if voice is None:
            return
        tts = synthesize_chat_reply(
            db, voice=voice, text=message.body or "", settings=settings
        )
        if tts is None:
            return
        meta: dict = {}
        raw = getattr(message, "meta_json", None) or ""
        if raw.strip():
            try:
                loaded = json.loads(raw)
                if isinstance(loaded, dict):
                    meta = loaded
            except json.JSONDecodeError:
                meta = {}
        meta["tts"] = {
            **tts.meta,
            "media_path": tts.media_path,
            "media_mime": tts.media_mime,
        }
        message.meta_json = json.dumps(meta, ensure_ascii=False)
        db.commit()
    except Exception:  # noqa: BLE001 — opener photo must still land
        logger.exception("keepsake opener TTS failed")
        db.rollback()
    finally:
        db.close()


def mark_heard(row: Keepsake) -> None:
    """Family told the story — collapse the pin; next photo waits until tomorrow or skip."""
    if row.status != "ready":
        return
    now = datetime.now(timezone.utc)
    row.status = "heard"
    row.updated_at = now


def family_spoke_after_open(db: Session, row: Keepsake) -> bool:
    if not row.opened_message_id or not row.opened_thread_id:
        return False
    opener = db.query(Message).filter(Message.id == row.opened_message_id).one_or_none()
    if not opener:
        return False
    later = (
        db.query(Message)
        .filter(
            Message.thread_id == row.opened_thread_id,
            Message.created_at > opener.created_at,
            Message.sender_kind == "user",
        )
        .all()
    )
    return any(len((m.body or "").strip()) >= 12 for m in later)


def sync_heard(db: Session, row: Keepsake) -> None:
    """Align status with the thread so Nhà and Gọi show the same pin."""
    if row.status == "ready" and family_spoke_after_open(db, row):
        mark_heard(row)
        db.commit()


def skip(row: Keepsake) -> None:
    now = datetime.now(timezone.utc)
    row.status = "skipped"
    row.updated_at = now


def ensure_keepsake(
    db: Session,
    *,
    space_id: str,
    identity_id: str,
    memory: MemoryItem,
    kind: str,
    opener: str = "",
    status: str = "draft",
) -> Keepsake:
    existing = (
        db.query(Keepsake)
        .filter(
            Keepsake.memory_item_id == memory.id,
            Keepsake.identity_id == identity_id,
        )
        .one_or_none()
    )
    now = datetime.now(timezone.utc)
    if existing:
        return existing
    row = Keepsake(
        id=generate(),
        space_id=space_id,
        identity_id=identity_id,
        memory_item_id=memory.id,
        kind=kind,
        opener=opener if kind == PHOTO_KIND else "",
        status=status,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    return row
