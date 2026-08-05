from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..models import IdentityProfile, MemoryItem, Thread, VoiceProfile, VoiceSample

KNOWLEDGE_TARGET = 3
HERITAGE_TAG_PREFIX = "heritage:"
# Kinds that count toward activate knowledge gate (poems do NOT).
KNOWLEDGE_KINDS = ("note", "voice", "photo", "video", "letter", "milestone")
POEM_KIND = "poem"

_TAG_SPLIT = re.compile(r"[,;\s]+")


def normalize_text(text: str) -> str:
    """Lowercase, strip Vietnamese tone marks, and fold đ → d.

    NFD leaves đ intact, so folding it explicitly is what lets patterns like
    "con đang" match after normalization.
    """
    folded = unicodedata.normalize("NFD", (text or "").lower())
    stripped = "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d")


def heritage_thread_title(display_name: str, relation_label: str | None) -> str:
    name = (display_name or "").strip()
    rel = (relation_label or "").strip()
    if rel:
        return f"{name} · {rel}"
    return name


def tag_tokens(tags: str | None) -> list[str]:
    if not tags:
        return []
    return [t for t in _TAG_SPLIT.split(tags.strip()) if t]


def has_heritage_tag(tags: str | None, identity_id: str) -> bool:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    return needle in tag_tokens(tags)


def knowledge_count_for_identity(
    db: Session, *, space_id: str, identity_id: str
) -> int:
    """Count non-poem memories tagged exactly heritage:{id}."""
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind.in_(KNOWLEDGE_KINDS),
        )
        .all()
    )
    return sum(1 for item in items if needle in tag_tokens(item.tags))


def poem_count_for_identity(
    db: Session, *, space_id: str, identity_id: str
) -> int:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == POEM_KIND)
        .all()
    )
    return sum(1 for item in items if needle in tag_tokens(item.tags))


def voice_for_identity(db: Session, identity: IdentityProfile) -> VoiceProfile | None:
    if identity.voice_profiles:
        return identity.voice_profiles[0]
    return (
        db.query(VoiceProfile)
        .filter(VoiceProfile.identity_profile_id == identity.id)
        .order_by(VoiceProfile.created_at.desc())
        .first()
    )


def voice_stage_stats(db: Session, voice: VoiceProfile | None) -> dict:
    if not voice:
        return {
            "processed_count": 0,
            "unprocessed_count": 0,
            "status": None,
        }
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .all()
    )
    processed = 0
    unprocessed = 0
    for sample in samples:
        stage = getattr(sample, "pipeline_stage", None) or "processed"
        if stage == "archived":
            continue
        if stage == "unprocessed":
            unprocessed += 1
        else:
            processed += 1
    return {
        "processed_count": processed,
        "unprocessed_count": unprocessed,
        "status": voice.status,
    }


def _json_loads(raw: str | None) -> object | None:
    if not raw or not str(raw).strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def profile_lock_ready(identity: IdentityProfile) -> bool:
    """Human-reviewed Identity Lock with minimum non-empty fields."""
    reviewed = getattr(identity, "profile_reviewed_at", None)
    if not reviewed:
        return False
    values = _json_loads(getattr(identity, "core_values_json", None) or "")
    if not isinstance(values, list) or len(values) < 3:
        return False
    # Reject if every value is still a placeholder marker.
    real = 0
    for item in values:
        if isinstance(item, dict):
            status = str(item.get("status") or "")
            if status.startswith("placeholder"):
                continue
            label = (item.get("label") or item.get("text") or "").strip()
            if label and "PLACEHOLDER" not in label.upper():
                real += 1
        elif isinstance(item, str) and item.strip() and "PLACEHOLDER" not in item.upper():
            real += 1
    if real < 3:
        return False
    speech = _json_loads(getattr(identity, "speech_style_json", None) or "")
    if not isinstance(speech, dict):
        return False
    traits = speech.get("traits")
    if not isinstance(traits, list) or len(traits) < 1:
        return False
    address = _json_loads(getattr(identity, "address_forms_json", None) or "")
    if not isinstance(address, dict) or not address:
        return False
    taboos = _json_loads(getattr(identity, "taboos_json", None) or "")
    if not isinstance(taboos, dict):
        return False
    hard = taboos.get("hard")
    if not isinstance(hard, list) or len(hard) < 1:
        return False
    return True


def compute_heritage_entity_status(
    *,
    identity: IdentityProfile,
    processed_count: int,
    knowledge_count: int,
    profile_ready: bool,
) -> str:
    stored = getattr(identity, "heritage_entity_status", None) or "dormant"
    if stored == "ready":
        return "ready"
    if stored == "paused":
        return "paused"

    voice_ok = processed_count >= 1
    knowledge_ok = knowledge_count >= KNOWLEDGE_TARGET
    if voice_ok and knowledge_ok and profile_ready:
        return "awakening"  # đủ điều kiện — chờ steward kích hoạt
    if knowledge_count > 0 or processed_count > 0 or voice_ok or profile_ready:
        return "gathering"
    return "dormant"


def heritage_readiness_payload(
    db: Session,
    *,
    identity: IdentityProfile,
) -> dict:
    voice = voice_for_identity(db, identity)
    stats = voice_stage_stats(db, voice)
    knowledge_count = knowledge_count_for_identity(
        db, space_id=identity.space_id, identity_id=identity.id
    )
    poem_count = poem_count_for_identity(
        db, space_id=identity.space_id, identity_id=identity.id
    )
    profile_ready = profile_lock_ready(identity)
    entity_status = compute_heritage_entity_status(
        identity=identity,
        processed_count=stats["processed_count"],
        knowledge_count=knowledge_count,
        profile_ready=profile_ready,
    )
    voice_ok = stats["processed_count"] >= 1
    knowledge_ok = knowledge_count >= KNOWLEDGE_TARGET
    chat_ready = entity_status == "ready"
    can_activate = (
        voice_ok
        and knowledge_ok
        and profile_ready
        and entity_status == "awakening"
    )
    reviewed_at = getattr(identity, "profile_reviewed_at", None)
    return {
        "identity_id": identity.id,
        "display_name": identity.display_name,
        "relation_label": identity.relation_label,
        "entity_status": entity_status,
        "voice_profile_id": voice.id if voice else None,
        "voice_status": stats["status"],
        "processed_count": stats["processed_count"],
        "unprocessed_count": stats["unprocessed_count"],
        "voice_ready": voice_ok,
        "knowledge_count": knowledge_count,
        "knowledge_target": KNOWLEDGE_TARGET,
        "knowledge_ready": knowledge_ok,
        "poem_count": poem_count,
        "profile_ready": profile_ready,
        "profile_reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "chat_ready": chat_ready,
        "can_activate": can_activate,
        "can_pause": entity_status == "ready",
        "can_resume": entity_status == "paused"
        and voice_ok
        and knowledge_ok
        and profile_ready,
    }


def sync_heritage_thread_title(db: Session, identity: IdentityProfile) -> None:
    title = heritage_thread_title(identity.display_name, identity.relation_label)
    for thread in heritage_threads_for_identity(db, identity.id):
        thread.title = title


def heritage_threads_for_identity(db: Session, identity_id: str) -> list[Thread]:
    return (
        db.query(Thread)
        .filter(Thread.heritage_identity_id == identity_id)
        .order_by(Thread.created_at.asc())
        .all()
    )


def identity_for_thread(db: Session, thread: Thread) -> IdentityProfile | None:
    """The remembered person a heritage thread talks to.

    Reads the thread's own link first; the legacy one-thread-per-identity
    pointer stays as a fallback for rows created before the 1-1 split.
    """
    if thread.kind != "heritage":
        return None
    identity_id = getattr(thread, "heritage_identity_id", None)
    if identity_id:
        return (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == identity_id)
            .one_or_none()
        )
    return (
        db.query(IdentityProfile)
        .filter(IdentityProfile.heritage_thread_id == thread.id)
        .one_or_none()
    )


def direct_thread_for(
    db: Session, *, identity: IdentityProfile, user_id: str
) -> Thread | None:
    return (
        db.query(Thread)
        .filter(
            Thread.heritage_identity_id == identity.id,
            Thread.audience_scope == "direct",
            Thread.member_user_id == user_id,
        )
        .one_or_none()
    )


def get_or_create_direct_thread(
    db: Session, *, identity: IdentityProfile, user_id: str
) -> Thread:
    """The member's own room with this person. Created the first time they open it."""
    existing = direct_thread_for(db, identity=identity, user_id=user_id)
    if existing:
        return existing
    thread = Thread(
        id=generate(),
        space_id=identity.space_id,
        kind="heritage",
        title=heritage_thread_title(identity.display_name, identity.relation_label),
        heritage_identity_id=identity.id,
        audience_scope="direct",
        member_user_id=user_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread


def mark_profile_reviewed(
    identity: IdentityProfile, *, user_id: str, at: datetime | None = None
) -> None:
    identity.profile_reviewed_at = at or datetime.now(timezone.utc)
    identity.profile_reviewed_by = user_id
