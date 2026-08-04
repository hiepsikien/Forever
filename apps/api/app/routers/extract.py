from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_steward_or_owner
from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import (
    ExtractJob,
    ExtractSegment,
    IdentityProfile,
    MemoryItem,
    User,
    VoiceProfile,
    VoiceSample,
)
from ..routers.settings import HERITAGE_CONSENT, SELF_CONSENT
from ..services.sample_quality import score_voice_sample_file
from ..services.storage import (
    ALLOWED_MIME,
    EXT_BY_MIME,
    MAX_EXTRACT_UPLOAD_BYTES,
    absolute_media_path,
    guess_mime,
    is_extractable_mime,
)

router = APIRouter(tags=["extract"])
internal_router = APIRouter(tags=["extract-internal"])

DEFAULT_OPTIONS = {
    "pad": 0.05,
    "max_gap": 0.35,
    "min_duration": 2.0,
    "edge_trim": 0.05,
    "purity_min": 0.9,
    "exclusive_only": True,
    "keep_mixed": False,
    # Diarization runs at 16 kHz; clips follow the source so clone keeps bandwidth.
    "sample_rate": 16000,
    "clip_sample_rate": None,
    "device": "auto",
    "model": "pyannote/speaker-diarization-community-1",
}


class CreateIdentityBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    relation_label: str = Field(default="", max_length=80)
    status: str = Field(default="remembered", pattern="^(living|remembered)$")
    consent: bool = True


class CreateExtractFromMemoryBody(BaseModel):
    memory_id: str = Field(min_length=1, max_length=32)
    num_speakers: int = Field(ge=1, le=20)
    voice_profile_id: str | None = None


class AssignSpeakerBody(BaseModel):
    speaker_label: str = Field(min_length=1, max_length=64)
    voice_profile_id: str | None = Field(default=None, min_length=1, max_length=32)
    create_identity: CreateIdentityBody | None = None


class AcceptSegmentsBody(BaseModel):
    segment_ids: list[str] = Field(default_factory=list)
    speaker_label: str | None = Field(default=None, max_length=64)
    quality: str = Field(default="clean", pattern="^(clean|short|mixed)$")
    # Target Voice DNA for this import (pool → any profile).
    voice_profile_id: str | None = Field(default=None, min_length=1, max_length=32)
    create_identity: CreateIdentityBody | None = None


class CompleteBody(BaseModel):
    duration_seconds: float | None = None
    device: str = ""
    model: str = ""
    raw_turn_count: int | None = None
    options: dict[str, Any] | None = None
    segments: list[dict[str, Any]] = Field(default_factory=list)


class FailBody(BaseModel):
    error: str = Field(min_length=1, max_length=4000)


def _require_worker_token(
    x_extract_worker_token: Annotated[str | None, Header()] = None,
) -> None:
    settings = get_settings()
    expected = (settings.extract_worker_token or "").strip()
    if not expected or (x_extract_worker_token or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid extract worker token.")


def _get_voice_or_404(db: Session, voice_id: str) -> VoiceProfile:
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).one_or_none()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice DNA not found.")
    return voice


def _reclaim_stale_running_jobs(db: Session) -> int:
    """Re-queue Extract jobs stuck in running (worker died or timed out)."""
    settings = get_settings()
    stale_minutes = max(5, int(settings.extract_job_stale_minutes or 60))
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    stale = (
        db.query(ExtractJob)
        .filter(
            ExtractJob.status == "running",
            ExtractJob.started_at.isnot(None),
            ExtractJob.started_at < cutoff,
        )
        .all()
    )
    if not stale:
        return 0
    for job in stale:
        job.status = "queued"
        job.started_at = None
        job.error_message = (
            f"Worker timeout sau {stale_minutes} phút — đã đưa lại hàng đợi."
        )
    db.commit()
    return len(stale)


def _get_job_or_404(db: Session, space_id: str, job_id: str) -> ExtractJob:
    job = (
        db.query(ExtractJob)
        .filter(ExtractJob.id == job_id, ExtractJob.space_id == space_id)
        .one_or_none()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Extract job not found.")
    return job


def _options_dict(job: ExtractJob) -> dict[str, Any]:
    try:
        data = json.loads(job.options_json or "{}")
    except json.JSONDecodeError:
        data = {}
    merged = dict(DEFAULT_OPTIONS)
    if isinstance(data, dict):
        merged.update(data)
    return merged


def _assignments_dict(job: ExtractJob) -> dict[str, str]:
    try:
        data = json.loads(job.speaker_assignments_json or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in data.items():
        if isinstance(key, str) and isinstance(value, str) and key and value:
            out[key] = value
    return out


def _set_assignment(job: ExtractJob, speaker_label: str, voice_id: str) -> None:
    mapping = _assignments_dict(job)
    mapping[speaker_label] = voice_id
    job.speaker_assignments_json = json.dumps(mapping)
    job.assigned_speaker_label = speaker_label


def _format_duration(ms: int | None) -> str | None:
    if ms is None or ms < 0:
        return None
    total = int(round(ms / 1000))
    m, s = divmod(total, 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


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


def _ensure_voice_for_identity(
    db: Session,
    *,
    space_id: str,
    identity: IdentityProfile,
    user: User,
    consent: bool,
) -> VoiceProfile:
    existing = (
        db.query(VoiceProfile)
        .filter(VoiceProfile.identity_profile_id == identity.id)
        .one_or_none()
    )
    if existing:
        return existing
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required.")
    now = datetime.now(timezone.utc)
    kind = _subject_kind_for_identity(identity)
    row = VoiceProfile(
        id=generate(),
        space_id=space_id,
        subject_kind=kind,
        subject_user_id=identity.linked_user_id,
        identity_profile_id=identity.id,
        provider="elevenlabs",
        provider_voice_id=None,
        status="draft",
        consent_text=SELF_CONSENT if kind == "self" else HERITAGE_CONSENT,
        consent_at=now,
        consented_by_user_id=user.id,
        error_message="",
        display_name=_voice_display_label(identity),
        created_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def _resolve_target_voice(
    db: Session,
    *,
    space_id: str,
    user: User,
    voice_profile_id: str | None,
    create_identity: CreateIdentityBody | None,
) -> VoiceProfile:
    if voice_profile_id:
        voice = _get_voice_or_404(db, voice_profile_id)
        if voice.space_id != space_id:
            raise HTTPException(status_code=400, detail="Voice DNA không thuộc space này.")
        if voice.status == "paused":
            raise HTTPException(status_code=400, detail="Voice đang tạm dừng.")
        return voice

    if create_identity is None:
        raise HTTPException(
            status_code=400,
            detail="Chọn voice_profile_id hoặc create_identity cho người cần giữ.",
        )

    now = datetime.now(timezone.utc)
    identity = IdentityProfile(
        id=generate(),
        space_id=space_id,
        display_name=create_identity.display_name.strip(),
        relation_label=(create_identity.relation_label or "").strip(),
        status=create_identity.status,
        linked_user_id=None,
        heritage_thread_id=None,
        created_by=user.id,
        created_at=now,
    )
    db.add(identity)
    db.flush()
    return _ensure_voice_for_identity(
        db,
        space_id=space_id,
        identity=identity,
        user=user,
        consent=create_identity.consent,
    )


def _segment_payload(row: ExtractSegment) -> dict[str, Any]:
    return {
        "id": row.id,
        "job_id": row.job_id,
        "speaker_label": row.speaker_label,
        "t_start": row.t_start,
        "t_end": row.t_end,
        "duration_ms": row.duration_ms,
        "duration_label": _format_duration(row.duration_ms),
        "media_path": row.media_path or None,
        "purity": row.purity,
        "quality": row.quality,
        "review_status": row.review_status,
        "voice_sample_id": row.voice_sample_id,
        "created_at": row.created_at.isoformat(),
    }


def _job_payload(
    job: ExtractJob,
    *,
    segments: list[ExtractSegment] | None = None,
    include_segments: bool = False,
) -> dict[str, Any]:
    segs = segments
    if include_segments and segs is None:
        segs = sorted(job.segments, key=lambda s: (s.t_start, s.speaker_label, s.id))
    clean_count = sum(1 for s in (segs or job.segments) if s.quality == "clean")
    accepted_count = sum(
        1 for s in (segs or job.segments) if s.review_status == "accepted"
    )
    payload: dict[str, Any] = {
        "id": job.id,
        "space_id": job.space_id,
        "voice_profile_id": job.voice_profile_id,
        "source_kind": job.source_kind,
        "source_memory_id": getattr(job, "source_memory_id", None) or None,
        "original_filename": job.original_filename or None,
        "input_mime": job.input_mime or None,
        "num_speakers": job.num_speakers,
        "status": job.status,
        "error_message": job.error_message or None,
        "artifact_dir": job.artifact_dir or None,
        "options": _options_dict(job),
        "speaker_assignments": _assignments_dict(job),
        "duration_seconds": job.duration_seconds,
        "device": job.device or None,
        "model": job.model or None,
        "raw_turn_count": job.raw_turn_count,
        "assigned_speaker_label": job.assigned_speaker_label,
        "clean_segment_count": clean_count,
        "accepted_segment_count": accepted_count,
        "created_by": job.created_by,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }
    if include_segments and segs is not None:
        payload["segments"] = [_segment_payload(s) for s in segs]
    return payload


def _save_extract_upload(space_id: str, job_id: str, upload: UploadFile) -> tuple[str, str]:
    mime = guess_mime(upload)
    if mime not in ALLOWED_MIME or not is_extractable_mime(mime):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported media type: {mime or 'unknown'}. Chọn audio hoặc video.",
        )
    data = upload.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_EXTRACT_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 200MB).")

    ext = EXT_BY_MIME.get(mime) or Path(upload.filename or "").suffix.lower() or ".bin"
    relative = f"{space_id}/extract/{job_id}/input{ext}"
    dest = Path(get_settings().upload_dir) / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return relative.replace("\\", "/"), mime


def _copy_memory_to_extract_input(
    space_id: str, job_id: str, memory: MemoryItem
) -> tuple[str, str]:
    if not memory.media_path:
        raise HTTPException(status_code=400, detail="Ký ức không có file media.")
    mime = (memory.media_mime or "").strip()
    if not mime or not is_extractable_mime(mime):
        raise HTTPException(
            status_code=400,
            detail="Chỉ chọn ký ức audio hoặc video để tách giọng.",
        )
    src = absolute_media_path(memory.media_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail="File ký ức không còn trên máy chủ.")
    size = src.stat().st_size
    if size > MAX_EXTRACT_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 200MB).")

    ext = EXT_BY_MIME.get(mime) or src.suffix.lower() or ".bin"
    relative = f"{space_id}/extract/{job_id}/input{ext}"
    dest = Path(get_settings().upload_dir) / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return relative.replace("\\", "/"), mime


def _resolve_hint_voice(
    db: Session, space_id: str, voice_profile_id: str | None
) -> str | None:
    if not voice_profile_id:
        return None
    voice = _get_voice_or_404(db, voice_profile_id.strip())
    if voice.space_id != space_id:
        raise HTTPException(status_code=400, detail="Voice DNA không thuộc space này.")
    return voice.id


def _create_extract_job_record(
    db: Session,
    *,
    job_id: str,
    space_id: str,
    user: User,
    input_path: str,
    mime: str,
    original_filename: str,
    num_speakers: int,
    hint_voice_id: str | None,
    source_kind: str,
    source_memory_id: str | None = None,
) -> ExtractJob:
    now = datetime.now(timezone.utc)
    artifact_dir = f"{space_id}/extract/{job_id}"
    job = ExtractJob(
        id=job_id,
        space_id=space_id,
        voice_profile_id=hint_voice_id,
        source_kind=source_kind,
        source_memory_id=source_memory_id,
        input_path=input_path,
        input_mime=mime,
        original_filename=original_filename[:260],
        num_speakers=num_speakers,
        status="queued",
        artifact_dir=artifact_dir,
        options_json=json.dumps(DEFAULT_OPTIONS),
        speaker_assignments_json="{}",
        created_by=user.id,
        created_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.post("/api/spaces/{space_id}/extract/jobs")
async def create_extract_job(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    num_speakers: int = Form(...),
    voice_profile_id: str | None = Form(default=None),
):
    """Create a shared segment pool from one tape (not locked to one Voice DNA)."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    if num_speakers < 1 or num_speakers > 20:
        raise HTTPException(status_code=400, detail="num_speakers must be 1–20.")

    hint_voice_id = _resolve_hint_voice(db, space_id, voice_profile_id)

    job_id = generate()
    input_path, mime = _save_extract_upload(space_id, job_id, file)

    job = _create_extract_job_record(
        db,
        job_id=job_id,
        space_id=space_id,
        user=user,
        input_path=input_path,
        mime=mime,
        original_filename=file.filename or "",
        num_speakers=num_speakers,
        hint_voice_id=hint_voice_id,
        source_kind="upload",
    )
    return _job_payload(job, segments=[], include_segments=True)


@router.post("/api/spaces/{space_id}/extract/jobs/from-memory")
def create_extract_job_from_memory(
    space_id: str,
    body: CreateExtractFromMemoryBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Queue Extract from an existing library memory (audio or video)."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    memory = (
        db.query(MemoryItem)
        .filter(MemoryItem.id == body.memory_id.strip(), MemoryItem.space_id == space_id)
        .one_or_none()
    )
    if not memory:
        raise HTTPException(status_code=404, detail="Không tìm thấy ký ức.")
    if memory.kind not in {"voice", "video"}:
        raise HTTPException(
            status_code=400,
            detail="Chỉ chọn ký ức giọng nói hoặc video.",
        )

    hint_voice_id = _resolve_hint_voice(db, space_id, body.voice_profile_id)
    job_id = generate()
    input_path, mime = _copy_memory_to_extract_input(space_id, job_id, memory)
    label = memory.title or ("Video ký ức" if memory.kind == "video" else "Giọng ký ức")

    job = _create_extract_job_record(
        db,
        job_id=job_id,
        space_id=space_id,
        user=user,
        input_path=input_path,
        mime=mime,
        original_filename=label,
        num_speakers=body.num_speakers,
        hint_voice_id=hint_voice_id,
        source_kind="memory",
        source_memory_id=memory.id,
    )
    return _job_payload(job, segments=[], include_segments=True)


@router.get("/api/spaces/{space_id}/extract/jobs")
def list_extract_jobs(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    _reclaim_stale_running_jobs(db)
    q = db.query(ExtractJob).filter(ExtractJob.space_id == space_id)
    if voice_id:
        # Context hint OR speaker assignment targets this voice.
        jobs = q.order_by(ExtractJob.created_at.desc()).limit(100).all()
        filtered = []
        for job in jobs:
            if job.voice_profile_id == voice_id:
                filtered.append(job)
                continue
            if voice_id in _assignments_dict(job).values():
                filtered.append(job)
        return {"jobs": [_job_payload(j) for j in filtered[:50]]}
    jobs = q.order_by(ExtractJob.created_at.desc()).limit(50).all()
    return {"jobs": [_job_payload(j) for j in jobs]}


@router.get("/api/spaces/{space_id}/extract/jobs/{job_id}")
def get_extract_job(
    space_id: str,
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    _reclaim_stale_running_jobs(db)
    job = _get_job_or_404(db, space_id, job_id)
    segments = (
        db.query(ExtractSegment)
        .filter(ExtractSegment.job_id == job.id)
        .order_by(ExtractSegment.t_start.asc(), ExtractSegment.speaker_label.asc())
        .all()
    )
    return _job_payload(job, segments=segments, include_segments=True)


@router.get("/api/spaces/{space_id}/extract/jobs/{job_id}/segments")
def list_extract_segments(
    space_id: str,
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    quality: str | None = "clean",
    speaker_label: str | None = None,
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    job = _get_job_or_404(db, space_id, job_id)
    q = db.query(ExtractSegment).filter(ExtractSegment.job_id == job.id)
    if quality and quality != "all":
        q = q.filter(ExtractSegment.quality == quality)
    if speaker_label:
        q = q.filter(ExtractSegment.speaker_label == speaker_label)
    segments = q.order_by(
        ExtractSegment.duration_ms.desc(),
        ExtractSegment.speaker_label.asc(),
        ExtractSegment.t_start.asc(),
    ).all()
    return {"segments": [_segment_payload(s) for s in segments]}


@router.post("/api/spaces/{space_id}/extract/jobs/{job_id}/assign-speaker")
def assign_speaker(
    space_id: str,
    job_id: str,
    body: AssignSpeakerBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Map SPEAKER_xx → an existing or newly created Voice DNA in the pool."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    job = _get_job_or_404(db, space_id, job_id)
    label = body.speaker_label.strip()
    exists = (
        db.query(ExtractSegment)
        .filter(
            ExtractSegment.job_id == job.id,
            ExtractSegment.speaker_label == label,
        )
        .first()
    )
    if not exists:
        raise HTTPException(status_code=400, detail="Speaker label không có trong job.")

    voice = _resolve_target_voice(
        db,
        space_id=space_id,
        user=user,
        voice_profile_id=body.voice_profile_id,
        create_identity=body.create_identity,
    )
    _set_assignment(job, label, voice.id)
    db.commit()
    db.refresh(job)
    payload = _job_payload(job)
    payload["assigned_voice"] = {
        "id": voice.id,
        "display_name": voice.display_name,
        "subject_kind": voice.subject_kind,
        "identity_profile_id": voice.identity_profile_id,
    }
    return payload


@router.post("/api/spaces/{space_id}/extract/jobs/{job_id}/segments/accept")
def accept_segments(
    space_id: str,
    job_id: str,
    body: AcceptSegmentsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Import selected pool clips into any Voice DNA (existing or created now)."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    job = _get_job_or_404(db, space_id, job_id)
    if job.status not in ("needs_review", "done"):
        raise HTTPException(
            status_code=400,
            detail="Job chưa sẵn sàng review (cần needs_review).",
        )

    speaker = (body.speaker_label or job.assigned_speaker_label or "").strip()
    assignments = _assignments_dict(job)
    target_voice_id = body.voice_profile_id
    if not target_voice_id and not body.create_identity and speaker:
        target_voice_id = assignments.get(speaker)

    voice = _resolve_target_voice(
        db,
        space_id=space_id,
        user=user,
        voice_profile_id=target_voice_id,
        create_identity=body.create_identity,
    )

    q = db.query(ExtractSegment).filter(
        ExtractSegment.job_id == job.id,
        ExtractSegment.review_status == "pending",
    )
    if body.segment_ids:
        q = q.filter(ExtractSegment.id.in_(body.segment_ids))
    else:
        if not speaker:
            raise HTTPException(
                status_code=400,
                detail="Chọn speaker_label hoặc truyền segment_ids.",
            )
        q = q.filter(
            ExtractSegment.speaker_label == speaker,
            ExtractSegment.quality == body.quality,
        )

    rows = q.order_by(ExtractSegment.duration_ms.desc(), ExtractSegment.t_start.asc()).all()
    if not rows:
        raise HTTPException(status_code=400, detail="Không có segment phù hợp để import.")

    # Keep speaker→voice map in sync with this import.
    if rows[0].speaker_label:
        _set_assignment(job, rows[0].speaker_label, voice.id)

    now = datetime.now(timezone.utc)
    created: list[VoiceSample] = []
    for seg in rows:
        if not seg.media_path:
            continue
        src = absolute_media_path(seg.media_path)
        if not src.exists():
            continue
        ext = src.suffix or ".wav"
        new_rel = f"{space_id}/{generate()}{ext}"
        dest = Path(get_settings().upload_dir) / new_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        file_size = dest.stat().st_size
        score, label, tip = score_voice_sample_file(
            dest, duration_ms=seg.duration_ms, file_size_bytes=file_size
        )
        sample = VoiceSample(
            id=generate(),
            voice_profile_id=voice.id,
            media_path=new_rel.replace("\\", "/"),
            media_mime="audio/wav",
            source="extract",
            note=f"Extract {seg.speaker_label} {seg.t_start:.1f}-{seg.t_end:.1f}s",
            duration_ms=seg.duration_ms,
            file_size_bytes=file_size,
            quality_score=score,
            quality_label=label,
            quality_tip=tip,
            extract_job_id=job.id,
            extract_segment_id=seg.id,
            t_start=seg.t_start,
            t_end=seg.t_end,
            speaker_label=seg.speaker_label,
            pipeline_stage="unprocessed",
            created_by=user.id,
            created_at=now,
        )
        seg.review_status = "accepted"
        seg.voice_sample_id = sample.id
        db.add(sample)
        created.append(sample)

    if not created:
        raise HTTPException(status_code=400, detail="Không copy được file segment.")

    voice.updated_at = now
    if voice.status in ("failed", "ready"):
        voice.status = "draft"
        voice.provider_voice_id = None
        voice.error_message = ""
    db.commit()

    return {
        "imported": len(created),
        "sample_ids": [s.id for s in created],
        "voice_profile_id": voice.id,
        "voice_display_name": voice.display_name,
        "job": _job_payload(job),
        "total_clean_seconds": round(
            sum((s.duration_ms or 0) for s in created) / 1000.0, 2
        ),
    }


@router.post("/api/spaces/{space_id}/extract/jobs/{job_id}/finish")
def finish_extract_job(
    space_id: str,
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    job = _get_job_or_404(db, space_id, job_id)
    if job.status not in ("needs_review", "done"):
        raise HTTPException(status_code=400, detail="Job chưa review xong.")
    job.status = "done"
    job.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return _job_payload(job)


@router.get("/api/spaces/{space_id}/extract/segments/{segment_id}/media")
def get_segment_media(
    space_id: str,
    segment_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    seg = (
        db.query(ExtractSegment)
        .join(ExtractJob, ExtractJob.id == ExtractSegment.job_id)
        .filter(ExtractSegment.id == segment_id, ExtractJob.space_id == space_id)
        .one_or_none()
    )
    if not seg or not seg.media_path:
        raise HTTPException(status_code=404, detail="Segment media not found.")
    path = absolute_media_path(seg.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Media file missing.")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@internal_router.post("/api/internal/extract/claim")
def claim_extract_job(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_worker_token)],
):
    """Worker claims the oldest queued job (one at a time)."""
    _reclaim_stale_running_jobs(db)
    job = (
        db.query(ExtractJob)
        .filter(ExtractJob.status == "queued")
        .order_by(ExtractJob.created_at.asc())
        .first()
    )
    if not job:
        return Response(status_code=204)

    running = db.query(ExtractJob).filter(ExtractJob.status == "running").first()
    if running:
        return Response(status_code=204)

    now = datetime.now(timezone.utc)
    job.status = "running"
    job.started_at = now
    job.error_message = ""
    db.commit()
    db.refresh(job)

    settings = get_settings()
    root = Path(settings.upload_dir).resolve()
    input_abs = (root / job.input_path).resolve()
    artifact_abs = (root / job.artifact_dir).resolve()
    artifact_abs.mkdir(parents=True, exist_ok=True)

    return {
        "job": _job_payload(job),
        "input_absolute_path": str(input_abs),
        "artifact_dir_absolute": str(artifact_abs),
        "options": _options_dict(job),
    }


@internal_router.post("/api/internal/extract/{job_id}/complete")
def complete_extract_job(
    job_id: str,
    body: CompleteBody,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_worker_token)],
):
    job = db.query(ExtractJob).filter(ExtractJob.id == job_id).one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Extract job not found.")
    if job.status != "running":
        raise HTTPException(status_code=400, detail="Job is not running.")

    now = datetime.now(timezone.utc)
    db.query(ExtractSegment).filter(ExtractSegment.job_id == job.id).delete()

    for row in body.segments:
        try:
            speaker = str(row.get("speaker") or "")
            start = float(row["start"])
            end = float(row["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start or not speaker:
            continue
        rel_file = row.get("file") or ""
        media_path = ""
        if rel_file:
            media_path = f"{job.artifact_dir}/{rel_file}".replace("\\", "/")
        duration_ms = int(round((end - start) * 1000))
        purity = row.get("purity")
        try:
            purity_f = float(purity) if purity is not None else None
        except (TypeError, ValueError):
            purity_f = None
        quality = str(row.get("quality") or "clean")
        if quality not in ("clean", "mixed", "short"):
            quality = "clean"
        db.add(
            ExtractSegment(
                id=generate(),
                job_id=job.id,
                speaker_label=speaker[:64],
                t_start=start,
                t_end=end,
                duration_ms=duration_ms,
                media_path=media_path,
                purity=purity_f,
                quality=quality,
                review_status="pending",
                created_at=now,
            )
        )

    job.status = "needs_review"
    job.duration_seconds = body.duration_seconds
    job.device = (body.device or "")[:32]
    job.model = (body.model or "")[:200]
    job.raw_turn_count = body.raw_turn_count
    if body.options:
        merged = _options_dict(job)
        merged.update(body.options)
        job.options_json = json.dumps(merged)
    job.error_message = ""
    job.finished_at = now
    db.commit()
    db.refresh(job)
    segments = (
        db.query(ExtractSegment)
        .filter(ExtractSegment.job_id == job.id)
        .order_by(ExtractSegment.duration_ms.desc(), ExtractSegment.t_start.asc())
        .all()
    )
    return _job_payload(job, segments=segments, include_segments=True)


@internal_router.post("/api/internal/extract/{job_id}/fail")
def fail_extract_job(
    job_id: str,
    body: FailBody,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_worker_token)],
):
    job = db.query(ExtractJob).filter(ExtractJob.id == job_id).one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Extract job not found.")
    job.status = "failed"
    job.error_message = body.error.strip()[:4000]
    job.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return _job_payload(job)
