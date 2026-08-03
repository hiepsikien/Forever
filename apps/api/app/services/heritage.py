from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import IdentityProfile, MemoryItem, Thread, VoiceProfile, VoiceSample

KNOWLEDGE_TARGET = 5
HERITAGE_TAG_PREFIX = "heritage:"


def heritage_thread_title(display_name: str, relation_label: str | None) -> str:
    name = (display_name or "").strip()
    rel = (relation_label or "").strip()
    if rel:
        return f"{name} · {rel}"
    return name


def knowledge_count_for_identity(
    db: Session, *, space_id: str, identity_id: str
) -> int:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    return (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.tags.contains(needle),
        )
        .count()
    )


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


def compute_heritage_entity_status(
    *,
    identity: IdentityProfile,
    processed_count: int,
    knowledge_count: int,
) -> str:
    stored = getattr(identity, "heritage_entity_status", None) or "dormant"
    if stored == "ready":
        return "ready"
    voice_ok = processed_count >= 1
    if knowledge_count >= KNOWLEDGE_TARGET and voice_ok:
        return "awakening"
    if knowledge_count > 0 or processed_count > 0 or voice_ok:
        return "awakening"
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
    entity_status = compute_heritage_entity_status(
        identity=identity,
        processed_count=stats["processed_count"],
        knowledge_count=knowledge_count,
    )
    voice_ok = stats["processed_count"] >= 1
    knowledge_ok = knowledge_count >= KNOWLEDGE_TARGET
    chat_ready = entity_status == "ready"
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
        "chat_ready": chat_ready,
        "can_activate": voice_ok and knowledge_ok and entity_status != "ready",
    }


def sync_heritage_thread_title(db: Session, identity: IdentityProfile) -> None:
    if not identity.heritage_thread_id:
        return
    thread = (
        db.query(Thread)
        .filter(Thread.id == identity.heritage_thread_id)
        .one_or_none()
    )
    if not thread:
        return
    thread.title = heritage_thread_title(
        identity.display_name, identity.relation_label
    )
