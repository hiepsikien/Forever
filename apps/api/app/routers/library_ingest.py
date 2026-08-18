"""Library document ingest — upload → Gemini proposals → Approve."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
)
from fastapi.responses import Response
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_steward_or_owner
from ..auth import get_current_user
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import (
    IdentityProfile,
    LibraryIngestJob,
    LibraryIngestProposal,
    MemoryItem,
    User,
)
from ..services.heritage import (
    HERITAGE_TAG_PREFIX,
    POEM_KIND,
    normalize_poem_authorship,
    poem_authorship_tag,
)
from ..services.library_ingest import process_library_ingest_job
from ..services.poetry_clean import clean_body_lines, format_body, format_body_tts
from ..services.storage import absolute_media_path, save_library_ingest_upload

logger = logging.getLogger(__name__)

router = APIRouter(tags=["library-ingest"])
internal_router = APIRouter(tags=["library-ingest-internal"])

ALLOWED_UPLOAD_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
MAX_INGEST_BYTES = 100 * 1024 * 1024  # tạm nới cho tập DOC/DOCX lớn
UNTITLED_POEM = "Thơ không đề"


def _require_worker_token(
    x_library_ingest_worker_token: Annotated[str | None, Header()] = None,
    x_extract_worker_token: Annotated[str | None, Header()] = None,
) -> None:
    settings = get_settings()
    expected = (settings.library_ingest_worker_token or "").strip()
    # Fall back to extract token so one local secret covers both workers.
    if not expected:
        expected = (settings.extract_worker_token or "").strip()
    got = (x_library_ingest_worker_token or x_extract_worker_token or "").strip()
    if not expected or got != expected:
        raise HTTPException(status_code=401, detail="Invalid library ingest worker token.")


def _run_job_bg(job_id: str) -> None:
    db = SessionLocal()
    try:
        process_library_ingest_job(db, job_id)
    finally:
        db.close()


def _themes(prop: LibraryIngestProposal) -> list[str]:
    try:
        data = json.loads(prop.themes_json or "[]")
        return [t for t in data if isinstance(t, str)]
    except json.JSONDecodeError:
        return []


def _job_payload(job: LibraryIngestJob, *, proposal_count: int | None = None) -> dict:
    return {
        "id": job.id,
        "space_id": job.space_id,
        "identity_id": job.identity_id,
        "original_filename": job.original_filename,
        "input_mime": job.input_mime,
        "status": job.status,
        "error_message": job.error_message or "",
        "model": job.model or "",
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "proposal_count": proposal_count,
    }


def _proposal_payload(prop: LibraryIngestProposal) -> dict:
    return {
        "id": prop.id,
        "job_id": prop.job_id,
        "kind": prop.kind,
        "title": prop.title,
        "body": prop.body,
        "body_tts": prop.body_tts or "",
        "meter": prop.meter or "",
        "themes": _themes(prop),
        "authorship": normalize_poem_authorship(prop.authorship),
        "occurred_at": prop.occurred_at.isoformat() if prop.occurred_at else None,
        "identity_id": prop.identity_id,
        "review_status": prop.review_status,
        "memory_item_id": prop.memory_item_id,
        "sort_order": prop.sort_order,
        "created_at": prop.created_at.isoformat(),
    }


def _poem_fingerprint(body: str) -> str:
    return " ".join((body or "").lower().split())


def _poem_tags(
    identity_id: str, meter: str, themes: list[str], *, authorship: str = "own"
) -> str:
    parts = [
        f"{HERITAGE_TAG_PREFIX}{identity_id}",
        "tho",
        poem_authorship_tag(authorship),
    ]
    if meter and meter != "unknown":
        parts.append(f"meter:{meter}")
    for theme in themes:
        parts.append(f"chu-de:{theme}")
    return " ".join(parts)[:500]


def _heritage_tags(identity_id: str | None, extra: str = "") -> str:
    parts: list[str] = []
    if identity_id:
        parts.append(f"{HERITAGE_TAG_PREFIX}{identity_id}")
    if extra:
        parts.append(extra)
    return " ".join(parts).strip()[:500]


@router.post("/api/spaces/{space_id}/library-ingest/jobs")
async def create_library_ingest_job(
    space_id: str,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    identity_id: str = Form(default=""),
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    filename = (file.filename or "document").strip() or "document"

    hint_id = (identity_id or "").strip() or None
    if not hint_id:
        raise HTTPException(
            status_code=400,
            detail="Chọn người để neo tài liệu vào Thư viện trước khi tải lên.",
        )
    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == hint_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not identity:
        raise HTTPException(status_code=404, detail="Identity profile not found.")

    job_id = generate()
    relative, mime = save_library_ingest_upload(
        space_id,
        job_id,
        file,
        max_bytes=MAX_INGEST_BYTES,
    )
    if mime not in ALLOWED_UPLOAD_MIME and not mime.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ nhận ảnh, PDF, DOC hoặc DOCX.",
        )

    now = datetime.now(timezone.utc)
    job = LibraryIngestJob(
        id=job_id,
        space_id=space_id,
        identity_id=hint_id,
        input_path=relative,
        input_mime=mime,
        original_filename=filename[:260],
        status="queued",
        error_message="",
        artifact_dir=f"{space_id}/library-ingest/{job_id}",
        model="",
        created_by=user.id,
        created_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(_run_job_bg, job.id)
    return _job_payload(job, proposal_count=0)


@router.get("/api/spaces/{space_id}/library-ingest/jobs")
def list_library_ingest_jobs(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    jobs = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.space_id == space_id)
        .order_by(LibraryIngestJob.created_at.desc())
        .limit(50)
        .all()
    )
    return {"jobs": [_job_payload(j) for j in jobs]}


@router.get("/api/spaces/{space_id}/library-ingest/jobs/{job_id}")
def get_library_ingest_job(
    space_id: str,
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    job = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.id == job_id, LibraryIngestJob.space_id == space_id)
        .one_or_none()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    count = (
        db.query(LibraryIngestProposal)
        .filter(LibraryIngestProposal.job_id == job.id)
        .count()
    )
    return _job_payload(job, proposal_count=count)


class PatchJobBody(BaseModel):
    identity_id: str = Field(min_length=1, max_length=32)


@router.patch("/api/spaces/{space_id}/library-ingest/jobs/{job_id}")
def patch_library_ingest_job(
    space_id: str,
    job_id: str,
    body: PatchJobBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Neo / đổi người cho job — áp dụng cho mọi đề nghị còn pending."""
    require_steward_or_owner(db, space_id=space_id, user=user)
    job = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.id == job_id, LibraryIngestJob.space_id == space_id)
        .one_or_none()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    ident = body.identity_id.strip()
    identity = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == ident,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )
    if not identity:
        raise HTTPException(status_code=404, detail="Identity profile not found.")
    job.identity_id = ident
    pending = (
        db.query(LibraryIngestProposal)
        .filter(
            LibraryIngestProposal.job_id == job.id,
            LibraryIngestProposal.review_status == "pending",
        )
        .all()
    )
    for prop in pending:
        prop.identity_id = ident
    db.commit()
    count = (
        db.query(LibraryIngestProposal)
        .filter(LibraryIngestProposal.job_id == job.id)
        .count()
    )
    return _job_payload(job, proposal_count=count)


@router.get("/api/spaces/{space_id}/library-ingest/jobs/{job_id}/proposals")
def list_library_ingest_proposals(
    space_id: str,
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    job = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.id == job_id, LibraryIngestJob.space_id == space_id)
        .one_or_none()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    rows = (
        db.query(LibraryIngestProposal)
        .filter(LibraryIngestProposal.job_id == job.id)
        .order_by(LibraryIngestProposal.sort_order.asc())
        .all()
    )
    return {"proposals": [_proposal_payload(p) for p in rows]}


class EditProposalBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=8000)
    kind: str | None = Field(default=None, max_length=32)
    themes: list[str] | None = None
    meter: str | None = Field(default=None, max_length=32)
    authorship: str | None = Field(default=None, max_length=16)
    occurred_at: str | None = None
    identity_id: str | None = None


@router.patch(
    "/api/spaces/{space_id}/library-ingest/jobs/{job_id}/proposals/{proposal_id}"
)
def edit_library_ingest_proposal(
    space_id: str,
    job_id: str,
    proposal_id: str,
    body: EditProposalBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    prop = (
        db.query(LibraryIngestProposal)
        .join(LibraryIngestJob)
        .filter(
            LibraryIngestProposal.id == proposal_id,
            LibraryIngestProposal.job_id == job_id,
            LibraryIngestJob.space_id == space_id,
        )
        .one_or_none()
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    if prop.review_status != "pending":
        raise HTTPException(status_code=400, detail="Đề nghị đã duyệt hoặc đã bỏ.")
    if body.title is not None:
        prop.title = body.title.strip()[:200]
    if body.body is not None:
        prop.body = body.body.strip()[:8000]
    if body.kind is not None:
        kind = body.kind.strip().lower()
        if kind not in {"poem", "milestone", "note", "knowledge"}:
            raise HTTPException(status_code=400, detail="kind không hợp lệ.")
        prop.kind = kind
    if body.themes is not None:
        prop.themes_json = json.dumps(body.themes, ensure_ascii=False)
    if body.meter is not None:
        prop.meter = body.meter.strip()[:32]
    if body.authorship is not None:
        prop.authorship = normalize_poem_authorship(body.authorship)
    if body.occurred_at is not None:
        raw = body.occurred_at.strip()
        if not raw:
            prop.occurred_at = None
        else:
            try:
                if len(raw) == 4 and raw.isdigit():
                    prop.occurred_at = datetime(int(raw), 1, 1, tzinfo=timezone.utc)
                else:
                    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    prop.occurred_at = parsed
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="occurred_at không hợp lệ.") from exc
    if body.identity_id is not None:
        ident = body.identity_id.strip() or None
        if ident:
            row = (
                db.query(IdentityProfile)
                .filter(
                    IdentityProfile.id == ident,
                    IdentityProfile.space_id == space_id,
                )
                .one_or_none()
            )
            if not row:
                raise HTTPException(status_code=404, detail="Identity not found.")
        prop.identity_id = ident
    db.commit()
    db.refresh(prop)
    return _proposal_payload(prop)


class SettleProposalsBody(BaseModel):
    proposal_ids: list[str] = Field(min_length=1, max_length=100)
    action: str = Field(description="approve | reject")


@router.post(
    "/api/spaces/{space_id}/library-ingest/jobs/{job_id}/proposals/settle"
)
def settle_library_ingest_proposals(
    space_id: str,
    job_id: str,
    body: SettleProposalsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_steward_or_owner(db, space_id=space_id, user=user)
    action = body.action.strip().lower()
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="action must be approve or reject.")
    job = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.id == job_id, LibraryIngestJob.space_id == space_id)
        .one_or_none()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    props = (
        db.query(LibraryIngestProposal)
        .filter(
            LibraryIngestProposal.job_id == job.id,
            LibraryIngestProposal.id.in_(body.proposal_ids),
        )
        .all()
    )
    if len(props) != len(set(body.proposal_ids)):
        raise HTTPException(status_code=404, detail="Một đề nghị không tìm thấy.")

    now = datetime.now(timezone.utc)
    created: list[str] = []
    skipped: list[dict[str, str]] = []

    if action == "reject":
        for prop in props:
            if prop.review_status != "pending":
                skipped.append({"id": prop.id, "reason": "already_settled"})
                continue
            prop.review_status = "rejected"
        _maybe_finish_job(db, job)
        db.commit()
        return {"action": "reject", "settled": len(props) - len(skipped), "skipped": skipped}

    # approve
    poem_existing: set[str] = set()
    for item in (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == POEM_KIND)
        .all()
    ):
        poem_existing.add(_poem_fingerprint(item.body))

    for prop in props:
        if prop.review_status != "pending":
            skipped.append({"id": prop.id, "reason": "already_settled"})
            continue
        body_text = (prop.body or "").strip()
        if not body_text:
            skipped.append({"id": prop.id, "reason": "empty_body"})
            continue
        kind = prop.kind if prop.kind in {"poem", "milestone", "note", "knowledge"} else "note"
        title = (prop.title or "").strip()
        if kind == "poem":
            title = title or UNTITLED_POEM
            meter = (prop.meter or "unknown").strip() or "unknown"
            lines = clean_body_lines(body_text, meter=meter)
            text = format_body(lines)
            fp = _poem_fingerprint(text)
            if fp in poem_existing:
                skipped.append({"id": prop.id, "reason": "duplicate"})
                prop.review_status = "rejected"
                continue
            poem_existing.add(fp)
            identity_id = prop.identity_id or job.identity_id
            if not identity_id:
                skipped.append({"id": prop.id, "reason": "missing_identity"})
                continue
            tags = _poem_tags(
                identity_id,
                meter,
                _themes(prop),
                authorship=normalize_poem_authorship(prop.authorship),
            )
            item = MemoryItem(
                id=generate(),
                space_id=space_id,
                created_by=user.id,
                kind=POEM_KIND,
                title=title[:200],
                body=text,
                body_tts=(prop.body_tts or "").strip()
                or format_body_tts(lines, meter=meter),
                media_path=None,
                media_mime=None,
                source_message_id=None,
                tags=tags,
                occurred_at=prop.occurred_at,
                created_at=now,
            )
        else:
            if kind == "milestone":
                title = title or "Ngày gia đình"
            elif kind == "knowledge":
                title = title or "Điều nghe được"
            else:
                title = title or "Ghi chú"
            identity_id = prop.identity_id or job.identity_id
            if not identity_id:
                skipped.append({"id": prop.id, "reason": "missing_identity"})
                continue
            item = MemoryItem(
                id=generate(),
                space_id=space_id,
                created_by=user.id,
                kind=kind,
                title=title[:200],
                body=body_text[:8000],
                body_tts="",
                media_path=None,
                media_mime=None,
                source_message_id=None,
                tags=_heritage_tags(identity_id),
                occurred_at=prop.occurred_at if kind == "milestone" else (prop.occurred_at or now),
                created_at=now,
            )
        db.add(item)
        db.flush()
        prop.review_status = "approved"
        prop.memory_item_id = item.id
        created.append(item.id)

    _maybe_finish_job(db, job)
    db.commit()
    return {
        "action": "approve",
        "created_memory_ids": created,
        "skipped": skipped,
    }


def _maybe_finish_job(db: Session, job: LibraryIngestJob) -> None:
    pending = (
        db.query(LibraryIngestProposal)
        .filter(
            LibraryIngestProposal.job_id == job.id,
            LibraryIngestProposal.review_status == "pending",
        )
        .count()
    )
    if pending == 0 and job.status == "needs_review":
        job.status = "done"
        job.finished_at = datetime.now(timezone.utc)


@internal_router.post("/api/internal/library-ingest/claim")
def claim_library_ingest_job(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_worker_token)],
):
    running = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.status == "running")
        .first()
    )
    if running:
        return Response(status_code=204)
    job = (
        db.query(LibraryIngestJob)
        .filter(LibraryIngestJob.status == "queued")
        .order_by(LibraryIngestJob.created_at.asc())
        .first()
    )
    if not job:
        return Response(status_code=204)
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return {
        "job_id": job.id,
        "space_id": job.space_id,
        "input_path": str(absolute_media_path(job.input_path)),
        "input_mime": job.input_mime,
        "original_filename": job.original_filename,
        "identity_id": job.identity_id,
    }


@internal_router.post("/api/internal/library-ingest/{job_id}/process")
def process_claimed_job(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_worker_token)],
):
    process_library_ingest_job(db, job_id)
    job = db.query(LibraryIngestJob).filter(LibraryIngestJob.id == job_id).one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _job_payload(job)


@internal_router.post("/api/internal/library-ingest/{job_id}/fail")
def fail_library_ingest_job(
    job_id: str,
    body: dict[str, Any],
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(_require_worker_token)],
):
    job = db.query(LibraryIngestJob).filter(LibraryIngestJob.id == job_id).one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    job.status = "failed"
    job.error_message = str(body.get("error") or "failed")[:800]
    job.finished_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
