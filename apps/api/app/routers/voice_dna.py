from __future__ import annotations

import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import (
    get_space_or_404,
    require_membership,
    require_steward_or_owner,
)
from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import (
    IdentityProfile,
    SpaceSettings,
    Thread,
    User,
    VoiceProfile,
    VoiceRender,
    VoiceSample,
)
from ..routers.settings import HERITAGE_CONSENT, SELF_CONSENT
from ..services import elevenlabs as el
from ..services import voice_providers as vp
from ..services.heritage import (
    heritage_readiness_payload,
    heritage_thread_title,
    mark_profile_reviewed,
    sync_heritage_thread_title,
)
from ..services.audio_combine import AudioCombineError, combine_audio_files, probe_duration_ms
from ..services.audio_info import probe_audio_info
from ..services.audio_extract import extract_audio_from_video
from ..services.audio_process import normalize_audio_file, normalize_audio_file_inplace
from ..services.audio_split import split_audio_file
from ..services.sample_quality import score_voice_sample_file
from ..services.storage import (
    MAX_UPLOAD_BYTES,
    MAX_VOICE_VIDEO_BYTES,
    absolute_media_path,
    is_audio_mime,
    is_video_mime,
    save_bytes,
    save_upload,
)
from ..services.heritage_tts import apply_tts_prefs, prefs_payload
from ..services.voice_script import generate_voice_sample_script

router = APIRouter(tags=["voice-dna"])

PIPELINE_STAGES = frozenset({"unprocessed", "processed", "archived"})
CLONE_MAX_SAMPLES = 3
CLONE_TARGET_DURATION_MS = 120_000
# ElevenLabs IVC degrades past a couple of minutes; MiniMax reads 5 full minutes,
# which needs more clips too — heritage samples are often under a minute each.
CLONE_MAX_DURATION_MS = 150_000
CLONE_MAX_DURATION_MS_BY_PROVIDER = {vp.MINIMAX: 300_000}
CLONE_MAX_SAMPLES_BY_PROVIDER = {vp.MINIMAX: 8}
CLONE_MAX_SAMPLES_ANY = max([CLONE_MAX_SAMPLES, *CLONE_MAX_SAMPLES_BY_PROVIDER.values()])
COMBINE_MIN_SAMPLES = 2
COMBINE_MAX_SAMPLES = 100
COMBINE_MAX_INPUT_DURATION_MS = 600_000
SPLIT_MIN_DURATION_MS = 20_000


class CreateIdentityBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    relation_label: str = Field(default="", max_length=80)
    status: str = Field(default="living", pattern="^(living|remembered)$")


class UpdateIdentityBody(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    relation_label: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, pattern="^(living|remembered)$")
    # Identity Lock fields (JSON-serializable structures or pre-stringified)
    life_stage: dict | list | None = None
    roles: list | None = None
    address_forms: dict | None = None
    speech_style: dict | None = None
    core_values: list | None = None
    philosophy: dict | None = None
    taboos: dict | None = None
    poetry_quote_mode: str | None = Field(
        default=None, pattern="^(paraphrase|verbatim)$"
    )
    dynamic_context: str | None = Field(default=None, max_length=4000)
    family_context_opt_in: bool | None = None
    mark_profile_reviewed: bool | None = None


class MarkProfileReviewedBody(BaseModel):
    reviewed: bool = True


class CreateSelfVoiceBody(BaseModel):
    consent: bool = True


class CreateHeritageVoiceBody(BaseModel):
    identity_profile_id: str = Field(min_length=1)
    consent: bool = True


class CreateVoiceForIdentityBody(BaseModel):
    identity_profile_id: str = Field(min_length=1)
    consent: bool = True


class CloneBody(BaseModel):
    remove_background_noise: bool | None = None
    # Bound covers every provider; the per-provider cap is enforced on the route.
    sample_ids: list[str] | None = Field(
        default=None, min_length=1, max_length=CLONE_MAX_SAMPLES_ANY
    )
    provider: str | None = Field(default=None, pattern="^(elevenlabs|minimax)$")


class SampleNoteBody(BaseModel):
    note: str = Field(default="", max_length=2000)


class SampleUpdateBody(BaseModel):
    note: str | None = Field(default=None, max_length=2000)
    pipeline_stage: str | None = Field(
        default=None, pattern="^(unprocessed|processed|archived)$"
    )


class BulkStageBody(BaseModel):
    sample_ids: list[str] = Field(min_length=1, max_length=200)
    pipeline_stage: str = Field(pattern="^(unprocessed|processed|archived)$")


class CombineSamplesBody(BaseModel):
    sample_ids: list[str] = Field(
        min_length=COMBINE_MIN_SAMPLES, max_length=COMBINE_MAX_SAMPLES
    )
    note: str = Field(default="", max_length=2000)
    normalize: bool = False


class ProcessSamplesBody(BaseModel):
    sample_ids: list[str] = Field(min_length=1, max_length=100)
    normalize: bool = True


class SplitSampleBody(BaseModel):
    sample_id: str = Field(min_length=1)
    at_ms: int | None = Field(default=None, ge=1_000)
    note: str = Field(default="", max_length=2000)


class VoiceScriptBody(BaseModel):
    theme: str = Field(default="", max_length=200)
    seed: int = Field(default=0, ge=0, le=10_000)


class TtsBody(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    model_id: str | None = Field(default=None, max_length=64)
    # Optional ElevenLabs voice_id override (past Instant Clone on the account).
    provider_voice_id: str | None = Field(default=None, max_length=120)
    provider_voice_name: str | None = Field(default=None, max_length=200)
    stability: float | None = Field(default=None, ge=0, le=1)
    similarity_boost: float | None = Field(default=None, ge=0, le=1)
    style: float | None = Field(default=None, ge=0, le=1)
    speed: float | None = Field(default=None, ge=0.7, le=1.2)
    use_speaker_boost: bool | None = None
    lengthen_pauses: bool | None = None
    # MiniMax-only. "auto" (or omitted) lets the model infer the mood.
    emotion: str | None = Field(default=None, max_length=32)
    pitch: int | None = Field(default=None, ge=-12, le=12)
    intensity: int | None = Field(default=None, ge=-100, le=100)
    timbre: int | None = Field(default=None, ge=-100, le=100)
    save: bool = False


class SelectCloneBody(BaseModel):
    provider_voice_id: str = Field(min_length=1, max_length=120)
    provider: str | None = Field(default=None, pattern="^(elevenlabs|minimax)$")


class ChatTtsPrefsBody(BaseModel):
    """Attach a clone + TTS knobs as the set used by heritage chat / Gọi."""

    provider_voice_id: str = Field(min_length=1, max_length=120)
    provider: str | None = Field(default=None, pattern="^(elevenlabs|minimax)$")
    provider_voice_name: str | None = Field(default=None, max_length=200)
    model_id: str | None = Field(default=None, max_length=64)
    stability: float | None = Field(default=None, ge=0, le=1)
    similarity_boost: float | None = Field(default=None, ge=0, le=1)
    style: float | None = Field(default=None, ge=0, le=1)
    speed: float | None = Field(default=None, ge=0.7, le=1.2)
    use_speaker_boost: bool | None = None
    lengthen_pauses: bool | None = None
    emotion: str | None = Field(default=None, max_length=32)
    pitch: int | None = Field(default=None, ge=-12, le=12)
    intensity: int | None = Field(default=None, ge=-100, le=100)
    timbre: int | None = Field(default=None, ge=-100, le=100)


def _resolve_tts_model(requested: str | None, default: str, provider: str) -> str:
    model = (requested or "").strip() or default.strip()
    allowed = set(vp.tts_models(provider)) | {default.strip()}
    if model not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model không hỗ trợ cho {vp.label(provider)}. "
                f"Chọn một trong: {', '.join(sorted(allowed))}"
            ),
        )
    return model


def _render_payload(row: VoiceRender, voice: VoiceProfile | None = None) -> dict:
    return {
        "id": row.id,
        "voice_profile_id": row.voice_profile_id,
        "space_id": row.space_id,
        "text": row.text,
        "media_mime": row.media_mime,
        "model_id": row.model_id or None,
        "provider": getattr(row, "provider", None)
        or vp.provider_for_model(row.model_id)
        or vp.ELEVENLABS,
        "provider_voice_id": row.provider_voice_id or None,
        "provider_voice_name": row.provider_voice_name or None,
        "stability": row.stability,
        "similarity_boost": row.similarity_boost,
        "style": getattr(row, "style", None),
        "speed": getattr(row, "speed", None),
        "use_speaker_boost": getattr(row, "use_speaker_boost", None),
        "lengthen_pauses": getattr(row, "lengthen_pauses", None),
        "emotion": getattr(row, "emotion", None) or None,
        "pitch": getattr(row, "pitch", None),
        "intensity": getattr(row, "intensity", None),
        "timbre": getattr(row, "timbre", None),
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat(),
        "voice_display_name": voice.display_name if voice else None,
        "voice_subject_kind": voice.subject_kind if voice else None,
    }


def _format_duration(duration_ms: int | None) -> str | None:
    if duration_ms is None or duration_ms < 0:
        return None
    total_sec = int(round(duration_ms / 1000))
    minutes, seconds = divmod(total_sec, 60)
    return f"{minutes}:{seconds:02d}"


def _enrich_sample_quality(sample: VoiceSample) -> None:
    """Fill quality fields for legacy rows missing score."""
    if sample.quality_score is not None and sample.quality_label:
        return
    size = sample.file_size_bytes or 0
    path = absolute_media_path(sample.media_path) if sample.media_path else None
    if size <= 0 and path is not None and path.exists():
        size = path.stat().st_size
        sample.file_size_bytes = size
    score, label, tip = score_voice_sample_file(
        path,
        duration_ms=sample.duration_ms,
        file_size_bytes=size,
    )
    sample.quality_score = score
    sample.quality_label = label
    sample.quality_tip = tip


def _effective_stage(sample: VoiceSample) -> str:
    stage = getattr(sample, "pipeline_stage", None) or "processed"
    return stage if stage in PIPELINE_STAGES else "processed"


def _voice_stage_stats(samples: list[VoiceSample]) -> dict[str, int]:
    unprocessed = processed = archived = 0
    processed_duration_ms = 0
    for sample in samples:
        stage = _effective_stage(sample)
        if stage == "unprocessed":
            unprocessed += 1
        elif stage == "processed":
            processed += 1
            processed_duration_ms += sample.duration_ms or 0
        else:
            archived += 1
    return {
        "sample_count": unprocessed + processed,
        "unprocessed_count": unprocessed,
        "processed_count": processed,
        "archived_count": archived,
        "processed_duration_ms": processed_duration_ms,
    }


def _invalidate_clone_if_ready(voice: VoiceProfile) -> None:
    if voice.status == "ready":
        voice.status = "draft"
        voice.provider_voice_id = None


def _parent_sample_ids(sample: VoiceSample) -> list[str]:
    raw = getattr(sample, "parent_sample_ids", None) or ""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except json.JSONDecodeError:
        pass
    return []


def _processing_applied(sample: VoiceSample) -> dict:
    raw = getattr(sample, "processing_applied", None) or ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {}


def _assert_unprocessed_samples(samples: list[VoiceSample]) -> None:
    for sample in samples:
        if _effective_stage(sample) != "unprocessed":
            raise HTTPException(
                status_code=400,
                detail="Chỉ xử lý mẫu ở trạng thái Chưa xử lý (unprocessed).",
            )


def _create_derived_sample(
    *,
    db: Session,
    voice: VoiceProfile,
    user: User,
    now: datetime,
    relative_path: str,
    duration_ms: int | None,
    file_size: int,
    source: str,
    note: str,
    parent_ids: list[str],
    processing: dict,
    pipeline_stage: str = "unprocessed",
) -> VoiceSample:
    if pipeline_stage not in PIPELINE_STAGES:
        raise ValueError(f"Invalid pipeline_stage: {pipeline_stage}")
    score, label, tip = score_voice_sample_file(
        absolute_media_path(relative_path),
        duration_ms=duration_ms,
        file_size_bytes=file_size,
    )
    row = VoiceSample(
        id=generate(),
        voice_profile_id=voice.id,
        media_path=relative_path.replace("\\", "/"),
        media_mime="audio/wav",
        source=source,
        note=note[:2000],
        duration_ms=duration_ms,
        file_size_bytes=file_size,
        quality_score=score,
        quality_label=label,
        quality_tip=tip,
        pipeline_stage=pipeline_stage,
        parent_sample_ids=json.dumps(parent_ids),
        processing_applied=json.dumps(processing),
        created_by=user.id,
        created_at=now,
    )
    db.add(row)
    return row


def _sample_payload(row: VoiceSample, *, voice: VoiceProfile | None = None) -> dict:
    _enrich_sample_quality(row)
    payload = {
        "id": row.id,
        "voice_profile_id": row.voice_profile_id,
        "source": row.source,
        "note": row.note or "",
        "media_mime": row.media_mime,
        "duration_ms": row.duration_ms,
        "duration_label": _format_duration(row.duration_ms),
        "file_size_bytes": row.file_size_bytes or 0,
        "quality_score": row.quality_score,
        "quality_label": row.quality_label or None,
        "quality_tip": row.quality_tip or None,
        "extract_job_id": getattr(row, "extract_job_id", None),
        "extract_segment_id": getattr(row, "extract_segment_id", None),
        "t_start": getattr(row, "t_start", None),
        "t_end": getattr(row, "t_end", None),
        "speaker_label": getattr(row, "speaker_label", None),
        "pipeline_stage": _effective_stage(row),
        "parent_sample_ids": _parent_sample_ids(row),
        "processing_applied": _processing_applied(row),
        "created_at": row.created_at.isoformat(),
    }
    if voice is not None:
        payload["voice_display_name"] = voice.display_name
        payload["voice_subject_kind"] = voice.subject_kind
        payload["voice_status"] = voice.status
    return payload


def _identity_payload(
    row: IdentityProfile,
    *,
    voice: VoiceProfile | None = None,
) -> dict:
    def _parse(raw: str | None):
        if not raw or not str(raw).strip():
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    payload = {
        "id": row.id,
        "space_id": row.space_id,
        "display_name": row.display_name,
        "relation_label": row.relation_label,
        "status": row.status,
        "linked_user_id": row.linked_user_id,
        "heritage_thread_id": row.heritage_thread_id,
        "heritage_entity_status": getattr(row, "heritage_entity_status", None)
        or "dormant",
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat(),
        "voice_profile_id": voice.id if voice else None,
        "voice_status": voice.status if voice else None,
        "voice_sample_count": None,
        "voice_provider_voice_id": voice.provider_voice_id if voice else None,
        "life_stage": _parse(getattr(row, "life_stage_json", None)),
        "roles": _parse(getattr(row, "roles_json", None)),
        "address_forms": _parse(getattr(row, "address_forms_json", None)),
        "speech_style": _parse(getattr(row, "speech_style_json", None)),
        "core_values": _parse(getattr(row, "core_values_json", None)),
        "philosophy": _parse(getattr(row, "philosophy_json", None)),
        "taboos": _parse(getattr(row, "taboos_json", None)),
        "poetry_quote_mode": getattr(row, "poetry_quote_mode", None) or "paraphrase",
        "dynamic_context": getattr(row, "dynamic_context", None) or "",
        "family_context_opt_in": bool(getattr(row, "family_context_opt_in", False)),
        "profile_reviewed_at": (
            row.profile_reviewed_at.isoformat()
            if getattr(row, "profile_reviewed_at", None)
            else None
        ),
        "profile_reviewed_by": getattr(row, "profile_reviewed_by", None),
        "archived_at": (
            row.archived_at.isoformat() if getattr(row, "archived_at", None) else None
        ),
    }
    return payload


def _voice_payload(
    row: VoiceProfile,
    samples: list[VoiceSample] | None = None,
) -> dict:
    stats = _voice_stage_stats(samples or [])
    payload = {
        "id": row.id,
        "space_id": row.space_id,
        "subject_kind": row.subject_kind,
        "subject_user_id": row.subject_user_id,
        "identity_profile_id": row.identity_profile_id,
        "provider": row.provider,
        "provider_voice_id": row.provider_voice_id,
        "status": row.status,
        "display_name": row.display_name,
        "consent_at": row.consent_at.isoformat() if row.consent_at else None,
        "error_message": row.error_message or None,
        "tts_prefs": prefs_payload(row),
        "sample_count": stats["sample_count"],
        "unprocessed_count": stats["unprocessed_count"],
        "processed_count": stats["processed_count"],
        "archived_count": stats["archived_count"],
        "processed_duration_ms": stats["processed_duration_ms"],
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "archived_at": (
            row.archived_at.isoformat() if getattr(row, "archived_at", None) else None
        ),
    }
    if samples is not None:
        payload["samples"] = [_sample_payload(s, voice=row) for s in samples]
    return payload


def _name_provider_clones(db: Session, space_id: str, rows: list[dict]) -> None:
    """Give unnamed provider clones a Forever name, in place.

    MiniMax stores no display name for a clone — only the id — so the readable
    name has to come from the Voice DNA row that created it.
    """
    unnamed = {
        str(row.get("voice_id")): row
        for row in rows
        if str(row.get("name") or "") == str(row.get("voice_id") or "")
    }
    if not unnamed:
        return
    profiles = (
        db.query(VoiceProfile)
        .filter(
            VoiceProfile.space_id == space_id,
            VoiceProfile.provider_voice_id.in_(list(unnamed)),
        )
        .all()
    )
    for profile in profiles:
        row = unnamed.get(profile.provider_voice_id or "")
        if row is not None:
            row["name"] = f"Forever · {profile.display_name}"


def _space_api_key(db: Session, space_id: str) -> str | None:
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    return row.elevenlabs_api_key if row else None


def _is_owner_or_steward(db: Session, space_id: str, user: User) -> bool:
    membership = require_membership(db, space_id=space_id, user=user)
    space = get_space_or_404(db, space_id)
    return space.steward_user_id == user.id or membership.role == "owner"


def _can_mutate_voice(db: Session, voice: VoiceProfile, user: User) -> bool:
    # Owner / steward manage every Voice DNA in the family space.
    if _is_owner_or_steward(db, voice.space_id, user):
        return True
    if voice.subject_user_id == user.id:
        return True
    if voice.identity_profile_id:
        identity = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == voice.identity_profile_id)
            .one_or_none()
        )
        if identity and identity.linked_user_id == user.id:
            return True
    return False


def _voice_display_label(identity: IdentityProfile) -> str:
    if identity.relation_label:
        return f"{identity.display_name} ({identity.relation_label})"
    return identity.display_name


def _subject_kind_for_identity(identity: IdentityProfile) -> str:
    if identity.linked_user_id:
        return "self"
    if identity.status == "remembered":
        return "heritage"
    return "person"


def _ensure_self_identity(
    db: Session,
    *,
    space_id: str,
    user: User,
) -> IdentityProfile:
    existing = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.linked_user_id == user.id,
        )
        .one_or_none()
    )
    if existing:
        return existing
    now = datetime.now(timezone.utc)
    row = IdentityProfile(
        id=generate(),
        space_id=space_id,
        display_name=user.name or "Tôi",
        relation_label="Tôi",
        status="living",
        linked_user_id=user.id,
        heritage_thread_id=None,
        created_by=user.id,
        created_at=now,
    )
    db.add(row)
    db.flush()
    return row


def _migrate_self_voices_to_identity(
    db: Session,
    *,
    space_id: str,
    user: User,
) -> None:
    """Link legacy self voices (no identity) to a Tôi IdentityProfile."""
    orphans = (
        db.query(VoiceProfile)
        .filter(
            VoiceProfile.space_id == space_id,
            VoiceProfile.subject_kind == "self",
            VoiceProfile.subject_user_id == user.id,
            VoiceProfile.identity_profile_id.is_(None),
        )
        .all()
    )
    if not orphans:
        return
    identity = _ensure_self_identity(db, space_id=space_id, user=user)
    for voice in orphans:
        voice.identity_profile_id = identity.id
        if not voice.display_name:
            voice.display_name = _voice_display_label(identity)


def _create_voice_for_identity(
    db: Session,
    *,
    space_id: str,
    identity: IdentityProfile,
    user: User,
    consent: bool,
) -> VoiceProfile:
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required.")

    existing = (
        db.query(VoiceProfile)
        .filter(VoiceProfile.identity_profile_id == identity.id)
        .one_or_none()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Hồ sơ này đã có Voice DNA.")

    # Link legacy self voice (no identity) instead of creating a duplicate.
    if identity.linked_user_id:
        orphan = (
            db.query(VoiceProfile)
            .filter(
                VoiceProfile.space_id == space_id,
                VoiceProfile.subject_kind == "self",
                VoiceProfile.subject_user_id == identity.linked_user_id,
                VoiceProfile.identity_profile_id.is_(None),
            )
            .one_or_none()
        )
        if orphan:
            orphan.identity_profile_id = identity.id
            orphan.display_name = orphan.display_name or _voice_display_label(identity)
            orphan.updated_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(orphan)
            return orphan

        linked = (
            db.query(VoiceProfile)
            .filter(
                VoiceProfile.space_id == space_id,
                VoiceProfile.subject_user_id == identity.linked_user_id,
            )
            .one_or_none()
        )
        if linked:
            raise HTTPException(status_code=409, detail="Hồ sơ này đã có Voice DNA.")

    now = datetime.now(timezone.utc)
    kind = _subject_kind_for_identity(identity)
    consent_text = SELF_CONSENT if kind == "self" else HERITAGE_CONSENT
    row = VoiceProfile(
        id=generate(),
        space_id=space_id,
        subject_kind=kind,
        subject_user_id=identity.linked_user_id,
        identity_profile_id=identity.id,
        provider="elevenlabs",
        provider_voice_id=None,
        status="draft",
        consent_text=consent_text,
        consent_at=now,
        consented_by_user_id=user.id,
        error_message="",
        display_name=_voice_display_label(identity),
        created_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _get_voice_or_404(db: Session, voice_id: str) -> VoiceProfile:
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).one_or_none()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice profile not found.")
    return voice


# --- Identities ---


@router.get("/api/spaces/{space_id}/identities")
def list_identities(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    include_archived: bool = False,
):
    require_membership(db, space_id=space_id, user=user)
    _migrate_self_voices_to_identity(db, space_id=space_id, user=user)
    # Ensure owner always sees a "Tôi" profile chip.
    if _is_owner_or_steward(db, space_id, user):
        _ensure_self_identity(db, space_id=space_id, user=user)
    db.commit()

    query = db.query(IdentityProfile).filter(IdentityProfile.space_id == space_id)
    if not include_archived:
        query = query.filter(IdentityProfile.archived_at.is_(None))
    rows = query.order_by(IdentityProfile.created_at.asc()).all()
    voices = (
        db.query(VoiceProfile)
        .filter(VoiceProfile.space_id == space_id)
        .all()
    )
    by_identity = {v.identity_profile_id: v for v in voices if v.identity_profile_id}
    # Legacy self without identity still map via linked user.
    for v in voices:
        if v.subject_kind == "self" and v.subject_user_id and not v.identity_profile_id:
            for ident in rows:
                if ident.linked_user_id == v.subject_user_id:
                    by_identity.setdefault(ident.id, v)

    sample_counts = {
        v.id: (
            db.query(VoiceSample)
            .filter(VoiceSample.voice_profile_id == v.id)
            .count()
        )
        for v in by_identity.values()
    }
    out = []
    for r in rows:
        voice = by_identity.get(r.id)
        payload = _identity_payload(r, voice=voice)
        if voice:
            payload["voice_sample_count"] = sample_counts.get(voice.id, 0)
        out.append(payload)
    return {"identities": out}


@router.post("/api/spaces/{space_id}/identities")
def create_identity(
    space_id: str,
    body: CreateIdentityBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    now = datetime.now(timezone.utc)
    thread_id = None
    thread = None
    if body.status == "remembered":
        title = heritage_thread_title(body.display_name, body.relation_label)
        thread = Thread(
            id=generate(),
            space_id=space_id,
            kind="heritage",
            title=title,
            audience_scope="family",
            created_at=now,
        )
        db.add(thread)
        db.flush()
        thread_id = thread.id

    row = IdentityProfile(
        id=generate(),
        space_id=space_id,
        display_name=body.display_name.strip(),
        relation_label=body.relation_label.strip(),
        status=body.status,
        linked_user_id=None,
        heritage_thread_id=thread_id,
        created_by=user.id,
        created_at=now,
    )
    db.add(row)
    db.flush()
    if thread is not None:
        thread.heritage_identity_id = row.id
    db.commit()
    db.refresh(row)
    return _identity_payload(row)


@router.patch("/api/spaces/{space_id}/identities/{identity_id}")
def update_identity(
    space_id: str,
    identity_id: str,
    body: UpdateIdentityBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Light edit: name, relation, living/remembered status."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Identity profile not found.")

    if body.status == "remembered" and row.linked_user_id:
        raise HTTPException(
            status_code=400,
            detail="Hồ sơ gắn tài khoản (Tôi) không thể đặt là Ký ức.",
        )

    if body.display_name is not None:
        row.display_name = body.display_name.strip()
    if body.relation_label is not None:
        row.relation_label = body.relation_label.strip()
    if body.status is not None and body.status != row.status:
        row.status = body.status
        if body.status == "remembered" and not row.heritage_thread_id:
            now = datetime.now(timezone.utc)
            title = heritage_thread_title(row.display_name, row.relation_label)
            thread = Thread(
                id=generate(),
                space_id=space_id,
                kind="heritage",
                title=title,
                heritage_identity_id=row.id,
                audience_scope="family",
                created_at=now,
            )
            db.add(thread)
            db.flush()
            row.heritage_thread_id = thread.id

    def _dump(value: dict | list) -> str:
        return json.dumps(value, ensure_ascii=False)

    if body.life_stage is not None:
        row.life_stage_json = _dump(body.life_stage)
    if body.roles is not None:
        row.roles_json = _dump(body.roles)
    if body.address_forms is not None:
        row.address_forms_json = _dump(body.address_forms)
    if body.speech_style is not None:
        row.speech_style_json = _dump(body.speech_style)
    if body.core_values is not None:
        row.core_values_json = _dump(body.core_values)
    if body.philosophy is not None:
        row.philosophy_json = _dump(body.philosophy)
    if body.taboos is not None:
        row.taboos_json = _dump(body.taboos)
    if body.poetry_quote_mode is not None:
        row.poetry_quote_mode = body.poetry_quote_mode
    if body.dynamic_context is not None:
        row.dynamic_context = body.dynamic_context.strip()
    if body.family_context_opt_in is not None:
        row.family_context_opt_in = body.family_context_opt_in
    if body.mark_profile_reviewed is True:
        mark_profile_reviewed(row, user_id=user.id)
    elif body.mark_profile_reviewed is False:
        row.profile_reviewed_at = None
        row.profile_reviewed_by = None

    sync_heritage_thread_title(db, row)

    # Keep linked Voice DNA label in sync.
    voice = (
        db.query(VoiceProfile)
        .filter(VoiceProfile.identity_profile_id == row.id)
        .one_or_none()
    )
    if voice:
        voice.display_name = _voice_display_label(row)
        if voice.subject_kind != "self":
            voice.subject_kind = _subject_kind_for_identity(row)
        voice.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(row)
    return _identity_payload(row, voice=voice)


@router.get("/api/spaces/{space_id}/identities/{identity_id}/heritage-readiness")
def get_heritage_readiness(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    row = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    return heritage_readiness_payload(db, identity=row)


@router.post("/api/spaces/{space_id}/identities/{identity_id}/activate-heritage")
def activate_heritage_entity(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Steward marks heritage entity ready for chat after voice + knowledge + profile gates."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    if row.status != "remembered":
        raise HTTPException(
            status_code=400,
            detail="Chỉ hồ sơ Ký ức mới kích hoạt thực thể chat.",
        )
    readiness = heritage_readiness_payload(db, identity=row)
    if not readiness["can_activate"]:
        missing = []
        if not readiness["voice_ready"]:
            missing.append("giọng (≥1 mẫu đã duyệt)")
        if not readiness["knowledge_ready"]:
            missing.append(
                f"{readiness['knowledge_target']} ký ức neo "
                f"(note/milestone/… — không tính thơ; tag heritage:{row.id})"
            )
        if not readiness["profile_ready"]:
            missing.append("Bản sắc đã hiệu đính (Identity Lock)")
        raise HTTPException(
            status_code=400,
            detail="Chưa đủ điều kiện kích hoạt: " + "; ".join(missing),
        )
    row.heritage_entity_status = "ready"
    db.commit()
    db.refresh(row)
    return heritage_readiness_payload(db, identity=row)


@router.post("/api/spaces/{space_id}/identities/{identity_id}/pause-heritage")
def pause_heritage_entity(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Kill switch — steward pauses heritage chat without deleting data."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    if (row.heritage_entity_status or "") != "ready":
        raise HTTPException(
            status_code=400,
            detail="Chỉ tạm dừng khi thực thể đang ở trạng thái ready.",
        )
    row.heritage_entity_status = "paused"
    db.commit()
    db.refresh(row)
    return heritage_readiness_payload(db, identity=row)


@router.post("/api/spaces/{space_id}/identities/{identity_id}/resume-heritage")
def resume_heritage_entity(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Resume after pause — only if voice + knowledge + profile gates still hold."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    if (row.heritage_entity_status or "") != "paused":
        raise HTTPException(status_code=400, detail="Thực thể không đang tạm dừng.")
    readiness = heritage_readiness_payload(db, identity=row)
    if not readiness["can_resume"]:
        raise HTTPException(
            status_code=400,
            detail="Chưa đủ điều kiện mở lại (giọng + ký ức neo + Bản sắc đã hiệu đính).",
        )
    row.heritage_entity_status = "ready"
    db.commit()
    db.refresh(row)
    return heritage_readiness_payload(db, identity=row)


# --- Archive ---


def _get_identity_or_404(db: Session, *, space_id: str, identity_id: str) -> IdentityProfile:
    row = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    return row


@router.post("/api/spaces/{space_id}/identities/{identity_id}/archive")
def archive_identity(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Shelve a person the family no longer wants listed, keeping every row."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = _get_identity_or_404(db, space_id=space_id, identity_id=identity_id)
    if row.linked_user_id:
        raise HTTPException(
            status_code=400,
            detail="Hồ sơ gắn tài khoản thành viên không thể lưu trữ.",
        )
    # Archiving a live heritage entity would silence it with no trace in the UI.
    if (row.heritage_entity_status or "") == "ready":
        raise HTTPException(
            status_code=400,
            detail="Hãy tạm dừng thực thể ký ức trước khi lưu trữ.",
        )
    if row.archived_at is None:
        row.archived_at = datetime.now(timezone.utc)
        archived_voices = (
            db.query(VoiceProfile)
            .filter(
                VoiceProfile.identity_profile_id == row.id,
                VoiceProfile.archived_at.is_(None),
            )
            .all()
        )
        for voice in archived_voices:
            voice.archived_at = row.archived_at
        db.commit()
        db.refresh(row)
    return _identity_payload(row)


@router.post("/api/spaces/{space_id}/identities/{identity_id}/unarchive")
def unarchive_identity(
    space_id: str,
    identity_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    row = _get_identity_or_404(db, space_id=space_id, identity_id=identity_id)
    if row.archived_at is not None:
        restored_voices = (
            db.query(VoiceProfile)
            .filter(
                VoiceProfile.identity_profile_id == row.id,
                VoiceProfile.archived_at.is_not(None),
            )
            .all()
        )
        for voice in restored_voices:
            voice.archived_at = None
        row.archived_at = None
        db.commit()
        db.refresh(row)
    return _identity_payload(row)


@router.post("/api/spaces/{space_id}/voices/{voice_id}/archive")
def archive_voice(
    space_id: str,
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    voice = _get_voice_or_404(db, voice_id)
    if voice.space_id != space_id:
        raise HTTPException(status_code=404, detail="Voice profile not found.")
    if voice.archived_at is None:
        voice.archived_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(voice)
    return _voice_payload(voice)


@router.post("/api/spaces/{space_id}/voices/{voice_id}/unarchive")
def unarchive_voice(
    space_id: str,
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    voice = _get_voice_or_404(db, voice_id)
    if voice.space_id != space_id:
        raise HTTPException(status_code=404, detail="Voice profile not found.")
    if voice.archived_at is not None:
        voice.archived_at = None
        db.commit()
        db.refresh(voice)
    return _voice_payload(voice)


# --- Voices ---


@router.get("/api/spaces/{space_id}/voices")
def list_voices(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    include_archived: bool = False,
):
    require_membership(db, space_id=space_id, user=user)
    query = db.query(VoiceProfile).filter(VoiceProfile.space_id == space_id)
    if not include_archived:
        query = query.filter(VoiceProfile.archived_at.is_(None))
    rows = query.order_by(VoiceProfile.created_at.asc()).all()
    voices = []
    for v in rows:
        samples = (
            db.query(VoiceSample)
            .filter(VoiceSample.voice_profile_id == v.id)
            .order_by(VoiceSample.created_at.asc())
            .all()
        )
        voices.append(_voice_payload(v, samples))
    db.commit()  # persist quality enrichment for legacy samples
    return {"voices": voices}


@router.post("/api/spaces/{space_id}/voices/self")
def create_self_voice(
    space_id: str,
    body: CreateSelfVoiceBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create Voice DNA for the current user (auto IdentityProfile \"Tôi\")."""
    require_membership(db, space_id=space_id, user=user)
    identity = _ensure_self_identity(db, space_id=space_id, user=user)
    db.commit()
    row = _create_voice_for_identity(
        db,
        space_id=space_id,
        identity=identity,
        user=user,
        consent=body.consent,
    )
    return _voice_payload(row)


@router.post("/api/spaces/{space_id}/voices/for-identity")
def create_voice_for_identity(
    space_id: str,
    body: CreateVoiceForIdentityBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Owner/steward: create Voice DNA for any person profile (Bố, Mẹ, Tôi…)."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == body.identity_profile_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not identity:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    # Members may only create for their own linked identity (future); owners for all.
    if identity.linked_user_id and identity.linked_user_id != user.id:
        if not _is_owner_or_steward(db, space_id, user):
            raise HTTPException(status_code=403, detail="Không được tạo Voice DNA này.")
    row = _create_voice_for_identity(
        db,
        space_id=space_id,
        identity=identity,
        user=user,
        consent=body.consent,
    )
    return _voice_payload(row)


@router.post("/api/spaces/{space_id}/voices/heritage")
def create_heritage_voice(
    space_id: str,
    body: CreateHeritageVoiceBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Backward-compatible alias → for-identity (any living/remembered profile)."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == body.identity_profile_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not identity:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    row = _create_voice_for_identity(
        db,
        space_id=space_id,
        identity=identity,
        user=user,
        consent=body.consent,
    )
    return _voice_payload(row)


@router.get("/api/spaces/{space_id}/voice-samples")
def list_space_voice_samples(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
    stage: str | None = None,
):
    require_membership(db, space_id=space_id, user=user)
    if stage is not None and stage not in PIPELINE_STAGES:
        raise HTTPException(status_code=400, detail="stage không hợp lệ.")
    q = (
        db.query(VoiceSample, VoiceProfile)
        .join(VoiceProfile, VoiceSample.voice_profile_id == VoiceProfile.id)
        .filter(VoiceProfile.space_id == space_id)
    )
    if voice_id:
        q = q.filter(VoiceSample.voice_profile_id == voice_id)
    if stage:
        q = q.filter(VoiceSample.pipeline_stage == stage)
    rows = q.order_by(VoiceSample.created_at.desc()).all()
    samples = [_sample_payload(sample, voice=voice) for sample, voice in rows]
    db.commit()
    return {"samples": samples}


@router.post("/api/spaces/{space_id}/voice-scripts/generate")
def generate_voice_script(
    space_id: str,
    body: VoiceScriptBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    settings = get_settings()
    script, source = generate_voice_sample_script(
        settings,
        theme=body.theme or None,
        seed=body.seed,
    )
    return {
        "script": script,
        "source": source,
        "approx_seconds": max(20, min(70, int(len(script.split()) * 0.45))),
    }


@router.get("/api/voices/{voice_id}")
def get_voice(
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, samples)


@router.delete("/api/voices/{voice_id}/samples/{sample_id}")
def delete_sample(
    voice_id: str,
    sample_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    sample = (
        db.query(VoiceSample)
        .filter(VoiceSample.id == sample_id, VoiceSample.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found.")
    db.delete(sample)
    voice.updated_at = datetime.now(timezone.utc)
    _invalidate_clone_if_ready(voice)
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, samples)


@router.post("/api/voices/{voice_id}/samples")
async def add_sample(
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    source: str = Form(default="upload"),
    duration_ms: int | None = Form(default=None),
    note: str = Form(default=""),
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")

    if source not in ("record", "upload", "memory", "extract"):
        source = "upload"

    # Allow video up to voice-video cap; audio still enforced at 25MB below.
    media_path, mime = save_upload(
        voice.space_id,
        file,
        max_bytes=MAX_VOICE_VIDEO_BYTES,
    )
    from_video = is_video_mime(mime)
    if not from_video and not is_audio_mime(mime):
        absolute_media_path(media_path).unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Chỉ chấp nhận file audio hoặc video (sẽ tách tiếng).",
        )
    if not from_video:
        path_check = absolute_media_path(media_path)
        if path_check.exists() and path_check.stat().st_size > MAX_UPLOAD_BYTES:
            path_check.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail="File audio quá lớn (tối đa 25MB).",
            )

    settings = get_settings()
    original_name = (file.filename or "").strip()
    user_note = (note or "").strip()
    processing: dict = {}

    if from_video:
        video_path = absolute_media_path(media_path)
        relative_audio = f"{voice.space_id}/{generate()}.wav"
        audio_path = Path(settings.upload_dir) / relative_audio
        try:
            dur_extracted, file_size = extract_audio_from_video(video_path, audio_path)
        except AudioCombineError as exc:
            video_path.unlink(missing_ok=True)
            audio_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=exc.message) from exc
        video_path.unlink(missing_ok=True)
        if file_size > MAX_UPLOAD_BYTES:
            audio_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=(
                    "Phần âm thanh sau khi tách vượt 25MB (WAV không nén ~4–5 phút). "
                    "Dùng Tách giọng từ băng dài cho video dài hơn."
                ),
            )
        media_path = relative_audio.replace("\\", "/")
        mime = "audio/wav"
        duration_ms = dur_extracted or duration_ms
        processing = {"from_video": True}
        if not user_note and original_name:
            user_note = f"Tách tiếng từ video ({original_name})"
        elif not user_note:
            user_note = "Tách tiếng từ video"

    path = absolute_media_path(media_path)
    file_size = path.stat().st_size if path.exists() else 0
    dur = duration_ms if duration_ms is not None and duration_ms > 0 else None
    if dur is None:
        dur = probe_duration_ms(path)
    score, label, tip = score_voice_sample_file(
        path, duration_ms=dur, file_size_bytes=file_size
    )
    if from_video and dur and dur > 180_000:
        tip = (
            "Video hơi dài cho 1 mẫu clone — cân nhắc Tách giọng từ băng dài "
            "nếu có nhiều người / đoạn."
        )

    # Video-derived and extract stay in inbox for human listen/approve.
    pipeline_stage = (
        "unprocessed" if source == "extract" or from_video else "processed"
    )

    now = datetime.now(timezone.utc)
    sample = VoiceSample(
        id=generate(),
        voice_profile_id=voice.id,
        media_path=media_path,
        media_mime=mime,
        source=source,
        note=user_note[:2000],
        duration_ms=dur,
        file_size_bytes=file_size,
        quality_score=score,
        quality_label=label,
        quality_tip=tip,
        pipeline_stage=pipeline_stage,
        processing_applied=json.dumps(processing) if processing else "",
        created_by=user.id,
        created_at=now,
    )
    voice.updated_at = now
    if voice.status in ("failed", "ready"):
        # New sample invalidates previous clone until re-clone.
        voice.status = "draft"
        voice.provider_voice_id = None
        voice.error_message = ""
    db.add(sample)
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return {
        "sample_id": sample.id,
        "from_video": from_video,
        "voice": _voice_payload(voice, samples),
    }


@router.patch("/api/voices/{voice_id}/samples/{sample_id}")
def update_sample(
    voice_id: str,
    sample_id: str,
    body: SampleUpdateBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    sample = (
        db.query(VoiceSample)
        .filter(VoiceSample.id == sample_id, VoiceSample.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found.")
    prev_stage = _effective_stage(sample)
    if body.note is not None:
        sample.note = (body.note or "").strip()[:2000]
    if body.pipeline_stage is not None:
        sample.pipeline_stage = body.pipeline_stage
    voice.updated_at = datetime.now(timezone.utc)
    if body.pipeline_stage is not None and body.pipeline_stage != prev_stage:
        _invalidate_clone_if_ready(voice)
    db.commit()
    db.refresh(sample)
    return _sample_payload(sample, voice=voice)


@router.post("/api/voices/{voice_id}/samples/bulk-stage")
def bulk_stage_samples(
    voice_id: str,
    body: BulkStageBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    rows = (
        db.query(VoiceSample)
        .filter(
            VoiceSample.voice_profile_id == voice.id,
            VoiceSample.id.in_(body.sample_ids),
        )
        .all()
    )
    if len(rows) != len(set(body.sample_ids)):
        raise HTTPException(status_code=404, detail="Một hoặc nhiều sample không tồn tại.")
    changed = False
    for sample in rows:
        if _effective_stage(sample) != body.pipeline_stage:
            sample.pipeline_stage = body.pipeline_stage
            changed = True
    if changed:
        voice.updated_at = datetime.now(timezone.utc)
        _invalidate_clone_if_ready(voice)
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, samples)


@router.post("/api/voices/{voice_id}/samples/combine")
def combine_samples(
    voice_id: str,
    body: CombineSamplesBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")

    unique_ids = list(dict.fromkeys(body.sample_ids))
    rows = (
        db.query(VoiceSample)
        .filter(
            VoiceSample.voice_profile_id == voice.id,
            VoiceSample.id.in_(unique_ids),
        )
        .all()
    )
    if len(rows) != len(unique_ids):
        raise HTTPException(status_code=404, detail="Một hoặc nhiều sample không tồn tại.")
    by_id = {row.id: row for row in rows}
    ordered = [by_id[sid] for sid in unique_ids]
    _assert_unprocessed_samples(ordered)

    input_paths = [absolute_media_path(sample.media_path) for sample in ordered]
    input_duration_ms = sum(sample.duration_ms or 0 for sample in ordered)
    if input_duration_ms > COMBINE_MAX_INPUT_DURATION_MS:
        raise HTTPException(
            status_code=400,
            detail="Tổng thời lượng mẫu chọn quá dài (tối đa ~10 phút).",
        )

    settings = get_settings()
    relative = f"{voice.space_id}/{generate()}.wav"
    output_path = Path(settings.upload_dir) / relative
    try:
        duration_ms, file_size = combine_audio_files(input_paths, output_path)
        if body.normalize:
            duration_ms, file_size = normalize_audio_file_inplace(output_path)
    except AudioCombineError as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=exc.message) from exc

    if file_size > MAX_UPLOAD_BYTES:
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="File ghép quá lớn (tối đa 25MB). Chọn ít mẫu hơn.",
        )

    processing = {"combine": True, "normalize": body.normalize, "denoise": "off"}
    auto_note = f"Ghép {len(ordered)} mẫu ({_format_duration(duration_ms) or '—:—'})"
    if body.normalize:
        auto_note += " · đã normalize"
    user_note = (body.note or "").strip()
    note = f"{auto_note}. {user_note}".strip() if user_note else auto_note

    now = datetime.now(timezone.utc)
    combined = _create_derived_sample(
        db=db,
        voice=voice,
        user=user,
        now=now,
        relative_path=relative,
        duration_ms=duration_ms or None,
        file_size=file_size,
        source="combine",
        note=note,
        parent_ids=unique_ids,
        processing=processing,
    )
    voice.updated_at = now
    db.commit()

    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return {
        "sample_id": combined.id,
        "voice": _voice_payload(voice, samples),
    }


@router.post("/api/voices/{voice_id}/samples/split")
def split_sample(
    voice_id: str,
    body: SplitSampleBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Split one sample into two halves (keeps original; archives if it was processed)."""
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")

    sample = (
        db.query(VoiceSample)
        .filter(
            VoiceSample.voice_profile_id == voice.id,
            VoiceSample.id == body.sample_id,
        )
        .first()
    )
    if sample is None:
        raise HTTPException(status_code=404, detail="Sample không tồn tại.")

    stage = _effective_stage(sample)
    if stage == "archived":
        raise HTTPException(
            status_code=400,
            detail="Không chia mẫu đã loại (archived).",
        )

    duration_ms = sample.duration_ms or 0
    if duration_ms < SPLIT_MIN_DURATION_MS:
        raise HTTPException(
            status_code=400,
            detail="Mẫu quá ngắn để chia (cần ≥ ~20 giây).",
        )
    if body.at_ms is not None and (
        body.at_ms < 1_000 or body.at_ms >= duration_ms - 1_000
    ):
        raise HTTPException(
            status_code=400,
            detail="Điểm chia không hợp lệ — mỗi nửa cần ít nhất ~1 giây.",
        )

    settings = get_settings()
    relative_a = f"{voice.space_id}/{generate()}.wav"
    relative_b = f"{voice.space_id}/{generate()}.wav"
    output_a = Path(settings.upload_dir) / relative_a
    output_b = Path(settings.upload_dir) / relative_b
    input_path = absolute_media_path(sample.media_path)

    try:
        (dur_a, size_a), (dur_b, size_b) = split_audio_file(
            input_path,
            output_a,
            output_b,
            at_ms=body.at_ms,
        )
    except AudioCombineError as exc:
        output_a.unlink(missing_ok=True)
        output_b.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=exc.message) from exc

    if size_a > MAX_UPLOAD_BYTES or size_b > MAX_UPLOAD_BYTES:
        output_a.unlink(missing_ok=True)
        output_b.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Một nửa sau khi chia vẫn quá lớn (tối đa 25MB).",
        )

    cut_label = _format_duration(body.at_ms if body.at_ms is not None else duration_ms // 2)
    auto_note = (
        f"Chia đôi từ mẫu ({_format_duration(duration_ms) or '—:—'}"
        f" · cắt @{cut_label or 'giữa'})"
    )
    user_note = (body.note or "").strip()
    base_note = f"{auto_note}. {user_note}".strip() if user_note else auto_note
    processing = {
        "split": True,
        "at_ms": body.at_ms if body.at_ms is not None else duration_ms // 2,
    }

    # Halves stay in the same inbox stage as the parent so Ready-to-clone
    # can immediately replace one oversized file with two shorter ones.
    half_stage = stage
    now = datetime.now(timezone.utc)
    half_a = _create_derived_sample(
        db=db,
        voice=voice,
        user=user,
        now=now,
        relative_path=relative_a,
        duration_ms=dur_a or None,
        file_size=size_a,
        source="split",
        note=f"{base_note} · nửa 1",
        parent_ids=[sample.id],
        processing=processing,
        pipeline_stage=half_stage,
    )
    half_b = _create_derived_sample(
        db=db,
        voice=voice,
        user=user,
        now=now,
        relative_path=relative_b,
        duration_ms=dur_b or None,
        file_size=size_b,
        source="split",
        note=f"{base_note} · nửa 2",
        parent_ids=[sample.id],
        processing=processing,
        pipeline_stage=half_stage,
    )

    archived_original = False
    if stage == "processed":
        # Avoid cloning original + halves together (duplicate audio / over sample cap).
        sample.pipeline_stage = "archived"
        archived_original = True
        _invalidate_clone_if_ready(voice)

    voice.updated_at = now
    db.commit()

    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return {
        "sample_ids": [half_a.id, half_b.id],
        "archived_original": archived_original,
        "voice": _voice_payload(voice, samples),
    }


@router.post("/api/voices/{voice_id}/samples/process")
def process_samples(
    voice_id: str,
    body: ProcessSamplesBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create new unprocessed samples from normalize (keeps originals untouched)."""
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")
    if not body.normalize:
        raise HTTPException(status_code=400, detail="Chọn ít nhất normalize.")

    unique_ids = list(dict.fromkeys(body.sample_ids))
    rows = (
        db.query(VoiceSample)
        .filter(
            VoiceSample.voice_profile_id == voice.id,
            VoiceSample.id.in_(unique_ids),
        )
        .all()
    )
    if len(rows) != len(unique_ids):
        raise HTTPException(status_code=404, detail="Một hoặc nhiều sample không tồn tại.")
    by_id = {row.id: row for row in rows}
    ordered = [by_id[sid] for sid in unique_ids]
    _assert_unprocessed_samples(ordered)

    settings = get_settings()
    now = datetime.now(timezone.utc)
    created_ids: list[str] = []

    for index, sample in enumerate(ordered, start=1):
        input_path = absolute_media_path(sample.media_path)
        relative = f"{voice.space_id}/{generate()}.wav"
        output_path = Path(settings.upload_dir) / relative
        try:
            duration_ms, file_size = normalize_audio_file(input_path, output_path)
        except AudioCombineError as exc:
            output_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"Mẫu #{index}: {exc.message}",
            ) from exc

        if file_size > MAX_UPLOAD_BYTES:
            output_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"Mẫu #{index} sau normalize quá lớn (tối đa 25MB).",
            )

        note = f"Normalize từ mẫu gốc ({_format_duration(duration_ms) or '—:—'})"
        row = _create_derived_sample(
            db=db,
            voice=voice,
            user=user,
            now=now,
            relative_path=relative,
            duration_ms=duration_ms or None,
            file_size=file_size,
            source="process",
            note=note,
            parent_ids=[sample.id],
            processing={"normalize": True, "denoise": "off"},
        )
        created_ids.append(row.id)

    voice.updated_at = now
    db.commit()

    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return {
        "created_sample_ids": created_ids,
        "voice": _voice_payload(voice, samples),
    }


@router.get("/api/voices/{voice_id}/samples/{sample_id}/media")
def get_sample_media(
    voice_id: str,
    sample_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    sample = (
        db.query(VoiceSample)
        .filter(VoiceSample.id == sample_id, VoiceSample.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not sample or not sample.media_path:
        raise HTTPException(status_code=404, detail="Sample not found.")
    path = absolute_media_path(sample.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sample file missing.")
    return FileResponse(
        path,
        media_type=sample.media_mime or "application/octet-stream",
        filename=path.name,
    )


@router.get("/api/voices/{voice_id}/samples/{sample_id}/audio-info")
def get_sample_audio_info(
    voice_id: str,
    sample_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    sample = (
        db.query(VoiceSample)
        .filter(VoiceSample.id == sample_id, VoiceSample.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not sample or not sample.media_path:
        raise HTTPException(status_code=404, detail="Sample not found.")
    path = absolute_media_path(sample.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sample file missing.")
    info = probe_audio_info(path, media_mime=sample.media_mime)
    info["source"] = sample.source
    info["pipeline_stage"] = _effective_stage(sample)
    return info


@router.get("/api/voices/{voice_id}/renders/{render_id}/audio-info")
def get_render_audio_info(
    voice_id: str,
    render_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    render = (
        db.query(VoiceRender)
        .filter(VoiceRender.id == render_id, VoiceRender.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not render or not render.media_path:
        raise HTTPException(status_code=404, detail="Render not found.")
    path = absolute_media_path(render.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Render file missing.")
    info = probe_audio_info(path, media_mime=render.media_mime)
    info["model_id"] = render.model_id or None
    return info


@router.post("/api/voices/{voice_id}/clone")
def clone_voice(
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    body: CloneBody | None = None,
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")

    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    processed = [s for s in samples if _effective_stage(s) == "processed"]
    if not processed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cần duyệt ít nhất một mẫu sang Sẵn sàng clone (Processed). "
                "Vào Mẫu giọng → chọn mẫu tốt → Duyệt."
            ),
        )

    settings = get_settings()
    provider = vp.normalize(
        (body.provider if body else None) or voice.provider,
        settings,
    )
    max_samples = CLONE_MAX_SAMPLES_BY_PROVIDER.get(provider, CLONE_MAX_SAMPLES)
    max_duration_ms = CLONE_MAX_DURATION_MS_BY_PROVIDER.get(
        provider, CLONE_MAX_DURATION_MS
    )

    requested_ids = list(dict.fromkeys(body.sample_ids)) if body and body.sample_ids else None
    if requested_ids is not None:
        by_id = {s.id: s for s in processed}
        missing = [sid for sid in requested_ids if sid not in by_id]
        if missing:
            raise HTTPException(
                status_code=400,
                detail="Mẫu chọn phải ở tab Sẵn sàng clone.",
            )
        if len(requested_ids) > max_samples:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{vp.label(provider)} nhận tối đa {max_samples} mẫu mỗi lần clone."
                ),
            )
        selected = [by_id[sid] for sid in requested_ids]
    else:
        if len(processed) > max_samples:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Có hơn {max_samples} mẫu sẵn sàng — chọn 1–{max_samples} "
                    "mẫu khi Clone (không clone cả kho)."
                ),
            )
        selected = processed

    total_ms = sum(s.duration_ms or 0 for s in selected)
    if total_ms > max_duration_ms:
        minutes = max_duration_ms / 60_000
        raise HTTPException(
            status_code=400,
            detail=(
                f"Tổng thời lượng mẫu chọn quá dài (~>{minutes:.1f} phút cho "
                f"{vp.label(provider)}). Bỏ bớt mẫu hoặc chia đôi file dài."
            ),
        )

    api_key = vp.resolve_api_key(provider, settings, _space_api_key(db, voice.space_id))
    paths = [absolute_media_path(s.media_path) for s in selected]
    for path in paths:
        if not path.exists():
            raise HTTPException(status_code=400, detail="Sample audio bị thiếu trên server.")

    remove_noise = (
        body.remove_background_noise
        if body and body.remove_background_noise is not None
        else vp.default_remove_noise(provider, settings)
    )

    stamp = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime("%Y-%m-%d %H:%M")
    clone_name = f"Forever · {voice.display_name} · {stamp}"[:100]
    try:
        provider_voice_id = vp.create_clone(
            provider,
            settings=settings,
            api_key=api_key,
            name=clone_name,
            file_paths=paths,
            remove_background_noise=remove_noise,
            voice_id_seed=voice.id,
        )
    except vp.VoiceProviderError as exc:
        voice.status = "failed"
        voice.error_message = exc.message
        voice.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    voice.provider = provider
    voice.provider_voice_id = provider_voice_id
    voice.status = "ready"
    voice.error_message = ""
    voice.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(voice)
    return _voice_payload(voice, samples)


@router.post("/api/voices/{voice_id}/tts")
def synthesize_tts(
    voice_id: str,
    body: TtsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    provider_voice_id = (body.provider_voice_id or "").strip() or (
        voice.provider_voice_id or ""
    ).strip()
    if voice.status != "ready" and not provider_voice_id:
        raise HTTPException(status_code=400, detail="Voice DNA chưa sẵn sàng để TTS.")
    if not provider_voice_id:
        raise HTTPException(
            status_code=400,
            detail="Chưa chọn bản clone (provider voice).",
        )

    settings = get_settings()
    provider = vp.normalize(
        vp.provider_for_model(body.model_id) or voice.provider,
        settings,
    )
    model_id = _resolve_tts_model(
        body.model_id, vp.default_model(provider, settings), provider
    )
    api_key = vp.resolve_api_key(provider, settings, _space_api_key(db, voice.space_id))
    provider_voice_name = (body.provider_voice_name or "").strip()
    is_minimax = provider == vp.MINIMAX
    # MiniMax only honours speed and pacing; storing the ElevenLabs knobs on
    # those renders would show numbers that never reached the provider.
    stability = (
        None
        if is_minimax
        else (
            body.stability
            if body.stability is not None
            else settings.elevenlabs_stability
        )
    )
    similarity_boost = (
        None
        if is_minimax
        else (
            body.similarity_boost
            if body.similarity_boost is not None
            else settings.elevenlabs_similarity_boost
        )
    )
    style = (
        None
        if is_minimax
        else (body.style if body.style is not None else settings.elevenlabs_style)
    )
    speed = (
        body.speed
        if body.speed is not None
        else (settings.minimax_speed if is_minimax else settings.elevenlabs_speed)
    )
    use_speaker_boost = (
        None
        if is_minimax
        else (
            body.use_speaker_boost
            if body.use_speaker_boost is not None
            else settings.elevenlabs_speaker_boost
        )
    )
    lengthen_pauses = (
        body.lengthen_pauses
        if body.lengthen_pauses is not None
        else (
            settings.minimax_lengthen_pauses
            if is_minimax
            else settings.elevenlabs_lengthen_pauses
        )
    )
    # Mirror image of the block above: MiniMax's own knobs are meaningless to
    # ElevenLabs, so they are dropped instead of stored as phantom settings.
    requested_emotion = (body.emotion or "").strip().lower()
    emotion = (
        requested_emotion
        if is_minimax and requested_emotion and requested_emotion != "auto"
        else None
    )
    pitch = body.pitch if is_minimax else None
    intensity = body.intensity if is_minimax else None
    timbre = body.timbre if is_minimax else None
    try:
        audio = vp.text_to_speech(
            provider,
            settings=settings,
            api_key=api_key,
            voice_id=provider_voice_id,
            text=body.text,
            model_id=model_id,
            stability=stability,
            similarity_boost=similarity_boost,
            style=style,
            speed=speed,
            use_speaker_boost=use_speaker_boost,
            lengthen_pauses=lengthen_pauses,
            emotion=emotion,
            pitch=pitch,
            intensity=intensity,
            timbre=timbre,
        )
    except vp.VoiceProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    if not body.save:
        return Response(content=audio, media_type="audio/mpeg")

    relative = save_bytes(voice.space_id, audio, ext=".mp3")
    now = datetime.now(timezone.utc)
    render = VoiceRender(
        id=generate(),
        voice_profile_id=voice.id,
        space_id=voice.space_id,
        text=body.text.strip(),
        media_path=relative,
        media_mime="audio/mpeg",
        model_id=model_id,
        provider=provider,
        provider_voice_id=provider_voice_id,
        provider_voice_name=provider_voice_name,
        stability=stability,
        similarity_boost=similarity_boost,
        style=style,
        speed=speed,
        use_speaker_boost=use_speaker_boost,
        lengthen_pauses=lengthen_pauses,
        emotion=emotion,
        pitch=pitch,
        intensity=intensity,
        timbre=timbre,
        created_by=user.id,
        created_at=now,
    )
    db.add(render)
    db.commit()
    db.refresh(render)
    return _render_payload(render, voice=voice)


@router.get("/api/spaces/{space_id}/elevenlabs-voices")
def list_elevenlabs_voices(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    cloned_only: bool = True,
    name_contains: str | None = None,
    voice_id: str | None = None,
    provider: str | None = None,
):
    """List clones on the shared provider account (ElevenLabs or MiniMax)."""
    require_membership(db, space_id=space_id, user=user)
    settings = get_settings()
    resolved_provider = vp.normalize(provider, settings)
    api_key = vp.resolve_api_key(
        resolved_provider, settings, _space_api_key(db, space_id)
    )
    try:
        voices = vp.list_voices(
            resolved_provider,
            settings=settings,
            api_key=api_key,
            cloned_only=cloned_only,
        )
    except vp.VoiceProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    _name_provider_clones(db, space_id, voices)
    needle = (name_contains or "").strip().lower()
    if voice_id:
        voice = _get_voice_or_404(db, voice_id)
        require_membership(db, space_id=voice.space_id, user=user)
        if voice.space_id != space_id:
            raise HTTPException(status_code=404, detail="Voice profile not found.")
        # Prefer Forever · {display_name} clones for this person.
        base = voice.display_name.split("(")[0].strip()
        needle = needle or f"forever · {base.lower()}"
        # Also match short display name without Forever prefix.
        alt = base.lower()

        def _match(v: dict) -> bool:
            # MiniMax clone ids carry the Voice DNA id, so past clones of this
            # person are still found even before they get a readable name.
            if voice.id in str(v.get("voice_id") or ""):
                return True
            name = str(v.get("name") or "").lower()
            if needle and needle in name:
                return True
            return bool(alt) and f"forever · {alt}" in name

        voices = [v for v in voices if _match(v)]
    elif needle:
        voices = [
            v for v in voices if needle in str(v.get("name") or "").lower()
        ]

    return {"voices": voices}


@router.delete("/api/spaces/{space_id}/elevenlabs-voices/{provider_voice_id}")
def delete_elevenlabs_voice(
    space_id: str,
    provider_voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    provider: str | None = None,
):
    """Delete a clone from the shared provider account."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    el_id = (provider_voice_id or "").strip()
    if not el_id:
        raise HTTPException(status_code=400, detail="Thiếu provider voice id.")

    settings = get_settings()
    resolved_provider = vp.normalize(provider, settings)
    api_key = vp.resolve_api_key(
        resolved_provider, settings, _space_api_key(db, space_id)
    )
    try:
        vp.delete_voice(
            resolved_provider, settings=settings, api_key=api_key, voice_id=el_id
        )
    except vp.VoiceProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    # Detach any Forever Voice DNA still pointing at this clone.
    now = datetime.now(timezone.utc)
    affected = (
        db.query(VoiceProfile)
        .filter(
            VoiceProfile.space_id == space_id,
            VoiceProfile.provider_voice_id == el_id,
        )
        .all()
    )
    for voice in affected:
        voice.provider_voice_id = None
        if voice.status == "ready":
            voice.status = "draft"
        voice.updated_at = now
    if affected:
        db.commit()

    return {"ok": True, "detached_voice_ids": [v.id for v in affected]}


@router.get("/api/spaces/{space_id}/voice-renders")
def list_space_voice_renders(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
    provider_voice_id: str | None = None,
):
    require_membership(db, space_id=space_id, user=user)
    q = (
        db.query(VoiceRender, VoiceProfile)
        .join(VoiceProfile, VoiceRender.voice_profile_id == VoiceProfile.id)
        .filter(VoiceRender.space_id == space_id)
    )
    if voice_id:
        q = q.filter(VoiceRender.voice_profile_id == voice_id)
    el_id = (provider_voice_id or "").strip()
    if el_id:
        q = q.filter(VoiceRender.provider_voice_id == el_id)
    rows = q.order_by(VoiceRender.created_at.desc()).all()
    return {
        "renders": [_render_payload(render, voice=voice) for render, voice in rows]
    }


@router.get("/api/voices/{voice_id}/renders")
def list_renders(
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    rows = (
        db.query(VoiceRender)
        .filter(VoiceRender.voice_profile_id == voice.id)
        .order_by(VoiceRender.created_at.desc())
        .all()
    )
    return {"renders": [_render_payload(r, voice=voice) for r in rows]}


@router.get("/api/voices/{voice_id}/renders/{render_id}/media")
def get_render_media(
    voice_id: str,
    render_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    render = (
        db.query(VoiceRender)
        .filter(VoiceRender.id == render_id, VoiceRender.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not render or not render.media_path:
        raise HTTPException(status_code=404, detail="Render not found.")
    path = absolute_media_path(render.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Render file missing.")
    return FileResponse(
        path,
        media_type=render.media_mime or "audio/mpeg",
        filename=path.name,
    )


@router.delete("/api/voices/{voice_id}/renders/{render_id}")
def delete_render(
    voice_id: str,
    render_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    render = (
        db.query(VoiceRender)
        .filter(VoiceRender.id == render_id, VoiceRender.voice_profile_id == voice.id)
        .one_or_none()
    )
    if not render:
        raise HTTPException(status_code=404, detail="Render not found.")
    try:
        path = absolute_media_path(render.media_path)
        if path.exists():
            path.unlink()
    except Exception:
        pass
    db.delete(render)
    db.commit()
    return {"ok": True}


@router.post("/api/voices/{voice_id}/pause")
def pause_voice(
    voice_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    voice.status = "paused"
    voice.updated_at = datetime.now(timezone.utc)
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, samples)


@router.post("/api/voices/{voice_id}/select-clone")
def select_clone(
    voice_id: str,
    body: SelectCloneBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Attach an existing Instant Clone as the default provider voice for TTS."""
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")

    el_id = body.provider_voice_id.strip()
    settings = get_settings()
    provider = vp.normalize(body.provider or voice.provider, settings)
    api_key = vp.resolve_api_key(provider, settings, _space_api_key(db, voice.space_id))
    try:
        clones = vp.list_voices(
            provider, settings=settings, api_key=api_key, cloned_only=True
        )
    except vp.VoiceProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    if not any(str(v.get("voice_id") or "") == el_id for v in clones):
        raise HTTPException(
            status_code=404,
            detail=f"Không tìm thấy bản clone trên tài khoản {vp.label(provider)}.",
        )

    voice.provider = provider
    voice.provider_voice_id = el_id
    voice.status = "ready"
    voice.error_message = ""
    voice.updated_at = datetime.now(timezone.utc)
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, samples)


@router.post("/api/voices/{voice_id}/chat-tts-prefs")
def set_chat_tts_prefs(
    voice_id: str,
    body: ChatTtsPrefsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Mark this clone + knobs as the set heritage chat / Gọi will speak with."""
    voice = _get_voice_or_404(db, voice_id)
    require_membership(db, space_id=voice.space_id, user=user)
    if not _can_mutate_voice(db, voice, user):
        raise HTTPException(status_code=403, detail="Không được sửa Voice DNA này.")
    if voice.status == "paused":
        raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")

    settings = get_settings()
    provider = vp.normalize(body.provider or voice.provider, settings)
    el_id = body.provider_voice_id.strip()
    api_key = vp.resolve_api_key(provider, settings, _space_api_key(db, voice.space_id))
    try:
        clones = vp.list_voices(
            provider, settings=settings, api_key=api_key, cloned_only=True
        )
    except vp.VoiceProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    if not any(str(v.get("voice_id") or "") == el_id for v in clones):
        raise HTTPException(
            status_code=404,
            detail=f"Không tìm thấy bản clone trên tài khoản {vp.label(provider)}.",
        )

    model_id = _resolve_tts_model(
        body.model_id, vp.default_model(provider, settings), provider
    )
    apply_tts_prefs(
        voice,
        {
            "provider": provider,
            "provider_voice_id": el_id,
            "provider_voice_name": (body.provider_voice_name or "").strip(),
            "model_id": model_id,
            "speed": body.speed,
            "lengthen_pauses": body.lengthen_pauses,
            "stability": body.stability,
            "similarity_boost": body.similarity_boost,
            "style": body.style,
            "use_speaker_boost": body.use_speaker_boost,
            "emotion": body.emotion,
            "pitch": body.pitch,
            "intensity": body.intensity,
            "timbre": body.timbre,
        },
    )
    voice.updated_at = datetime.now(timezone.utc)
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, samples)
