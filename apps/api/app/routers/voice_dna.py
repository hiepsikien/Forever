from __future__ import annotations

from datetime import datetime, timezone
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
from ..services.sample_quality import score_voice_sample
from ..services.storage import absolute_media_path, save_bytes, save_upload
from ..services.voice_script import generate_voice_sample_script

router = APIRouter(tags=["voice-dna"])


class CreateIdentityBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    relation_label: str = Field(default="", max_length=80)
    status: str = Field(default="living", pattern="^(living|remembered)$")


class UpdateIdentityBody(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    relation_label: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, pattern="^(living|remembered)$")


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


class SampleNoteBody(BaseModel):
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
    use_speaker_boost: bool | None = None
    save: bool = False


def _resolve_tts_model(requested: str | None, default: str) -> str:
    model = (requested or "").strip() or default.strip()
    allowed = set(el.VI_TTS_MODELS) | {default.strip()}
    if model not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Model không hỗ trợ. Chọn một trong: {', '.join(sorted(allowed))}",
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
        "provider_voice_id": row.provider_voice_id or None,
        "provider_voice_name": row.provider_voice_name or None,
        "stability": row.stability,
        "similarity_boost": row.similarity_boost,
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
    if size <= 0 and sample.media_path:
        path = absolute_media_path(sample.media_path)
        if path.exists():
            size = path.stat().st_size
            sample.file_size_bytes = size
    score, label, tip = score_voice_sample(
        duration_ms=sample.duration_ms,
        file_size_bytes=size,
    )
    sample.quality_score = score
    sample.quality_label = label
    sample.quality_tip = tip


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
    payload = {
        "id": row.id,
        "space_id": row.space_id,
        "display_name": row.display_name,
        "relation_label": row.relation_label,
        "status": row.status,
        "linked_user_id": row.linked_user_id,
        "heritage_thread_id": row.heritage_thread_id,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat(),
        "voice_profile_id": voice.id if voice else None,
        "voice_status": voice.status if voice else None,
        "voice_sample_count": None,
        "voice_provider_voice_id": voice.provider_voice_id if voice else None,
    }
    return payload


def _voice_payload(
    row: VoiceProfile,
    sample_count: int = 0,
    samples: list[VoiceSample] | None = None,
) -> dict:
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
        "sample_count": sample_count,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
    if samples is not None:
        payload["samples"] = [_sample_payload(s, voice=row) for s in samples]
    return payload


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
):
    require_membership(db, space_id=space_id, user=user)
    _migrate_self_voices_to_identity(db, space_id=space_id, user=user)
    # Ensure owner always sees a "Tôi" profile chip.
    if _is_owner_or_steward(db, space_id, user):
        _ensure_self_identity(db, space_id=space_id, user=user)
    db.commit()

    rows = (
        db.query(IdentityProfile)
        .filter(IdentityProfile.space_id == space_id)
        .order_by(IdentityProfile.created_at.asc())
        .all()
    )
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
    if body.status == "remembered":
        title = body.display_name
        if body.relation_label:
            title = f"Ký ức · {body.display_name}"
        thread = Thread(
            id=generate(),
            space_id=space_id,
            kind="heritage",
            title=title,
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
            title = row.display_name
            if row.relation_label:
                title = f"Ký ức · {row.display_name}"
            thread = Thread(
                id=generate(),
                space_id=space_id,
                kind="heritage",
                title=title,
                created_at=now,
            )
            db.add(thread)
            db.flush()
            row.heritage_thread_id = thread.id

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


# --- Voices ---


@router.get("/api/spaces/{space_id}/voices")
def list_voices(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    rows = (
        db.query(VoiceProfile)
        .filter(VoiceProfile.space_id == space_id)
        .order_by(VoiceProfile.created_at.asc())
        .all()
    )
    voices = []
    for v in rows:
        samples = (
            db.query(VoiceSample)
            .filter(VoiceSample.voice_profile_id == v.id)
            .order_by(VoiceSample.created_at.asc())
            .all()
        )
        voices.append(_voice_payload(v, len(samples), samples))
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
    return _voice_payload(row, 0)


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
    return _voice_payload(row, 0)


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
    return _voice_payload(row, 0)


@router.get("/api/spaces/{space_id}/voice-samples")
def list_space_voice_samples(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
):
    require_membership(db, space_id=space_id, user=user)
    q = (
        db.query(VoiceSample, VoiceProfile)
        .join(VoiceProfile, VoiceSample.voice_profile_id == VoiceProfile.id)
        .filter(VoiceProfile.space_id == space_id)
    )
    if voice_id:
        q = q.filter(VoiceSample.voice_profile_id == voice_id)
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
    return _voice_payload(voice, len(samples), samples)


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
    # After sample change, clone is stale until re-cloned.
    if voice.status == "ready":
        voice.status = "draft"
        voice.provider_voice_id = None
    db.commit()
    samples = (
        db.query(VoiceSample)
        .filter(VoiceSample.voice_profile_id == voice.id)
        .order_by(VoiceSample.created_at.asc())
        .all()
    )
    return _voice_payload(voice, len(samples), samples)


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

    media_path, mime = save_upload(voice.space_id, file)
    if not mime.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file audio.")

    path = absolute_media_path(media_path)
    file_size = path.stat().st_size if path.exists() else 0
    dur = duration_ms if duration_ms is not None and duration_ms > 0 else None
    score, label, tip = score_voice_sample(duration_ms=dur, file_size_bytes=file_size)

    now = datetime.now(timezone.utc)
    sample = VoiceSample(
        id=generate(),
        voice_profile_id=voice.id,
        media_path=media_path,
        media_mime=mime,
        source=source,
        note=(note or "").strip()[:2000],
        duration_ms=dur,
        file_size_bytes=file_size,
        quality_score=score,
        quality_label=label,
        quality_tip=tip,
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
    return {"sample_id": sample.id, "voice": _voice_payload(voice, len(samples), samples)}


@router.patch("/api/voices/{voice_id}/samples/{sample_id}")
def update_sample_note(
    voice_id: str,
    sample_id: str,
    body: SampleNoteBody,
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
    sample.note = (body.note or "").strip()[:2000]
    voice.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sample)
    return _sample_payload(sample, voice=voice)


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
    if not samples:
        raise HTTPException(status_code=400, detail="Cần upload ít nhất một sample audio.")
    if len(samples) > 4:
        raise HTTPException(
            status_code=400,
            detail=(
                "IVC tốt nhất với 1–3 sample sạch (~1–2 phút tổng). "
                "Xóa bớt sample kém rồi clone lại."
            ),
        )

    settings = get_settings()
    api_key = el.resolve_api_key(settings, _space_api_key(db, voice.space_id))
    paths = [absolute_media_path(s.media_path) for s in samples]
    for path in paths:
        if not path.exists():
            raise HTTPException(status_code=400, detail="Sample audio bị thiếu trên server.")

    remove_noise = (
        body.remove_background_noise
        if body and body.remove_background_noise is not None
        else settings.elevenlabs_remove_noise
    )

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    clone_name = f"Forever · {voice.display_name} · {stamp}"[:100]
    try:
        provider_voice_id = el.create_instant_voice_clone(
            settings=settings,
            api_key=api_key,
            name=clone_name,
            file_paths=paths,
            remove_background_noise=remove_noise,
            language="vi",
            description="Forever Voice DNA — Vietnamese family vault clone",
        )
    except el.ElevenLabsError as exc:
        voice.status = "failed"
        voice.error_message = exc.message
        voice.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    voice.provider_voice_id = provider_voice_id
    voice.status = "ready"
    voice.error_message = ""
    voice.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(voice)
    return _voice_payload(voice, len(samples), samples)


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
            detail="Chưa chọn bản clone ElevenLabs (provider voice).",
        )

    settings = get_settings()
    model_id = _resolve_tts_model(body.model_id, settings.elevenlabs_tts_model)
    api_key = el.resolve_api_key(settings, _space_api_key(db, voice.space_id))
    provider_voice_name = (body.provider_voice_name or "").strip()
    try:
        audio = el.text_to_speech(
            settings=settings,
            api_key=api_key,
            voice_id=provider_voice_id,
            text=body.text,
            model_id=model_id,
            stability=body.stability,
            similarity_boost=body.similarity_boost,
            style=body.style,
            use_speaker_boost=body.use_speaker_boost,
        )
    except el.ElevenLabsError as exc:
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
        provider_voice_id=provider_voice_id,
        provider_voice_name=provider_voice_name,
        stability=body.stability,
        similarity_boost=body.similarity_boost,
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
):
    """List Instant Clones / custom voices on the shared ElevenLabs account."""
    require_membership(db, space_id=space_id, user=user)
    settings = get_settings()
    api_key = el.resolve_api_key(settings, _space_api_key(db, space_id))
    try:
        voices = el.list_voices(
            settings=settings,
            api_key=api_key,
            cloned_only=cloned_only,
        )
    except el.ElevenLabsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

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


@router.get("/api/spaces/{space_id}/voice-renders")
def list_space_voice_renders(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
):
    require_membership(db, space_id=space_id, user=user)
    q = (
        db.query(VoiceRender, VoiceProfile)
        .join(VoiceProfile, VoiceRender.voice_profile_id == VoiceProfile.id)
        .filter(VoiceRender.space_id == space_id)
    )
    if voice_id:
        q = q.filter(VoiceRender.voice_profile_id == voice_id)
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
    return _voice_payload(voice, len(samples), samples)
