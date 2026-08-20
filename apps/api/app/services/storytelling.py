"""Seed + helpers for classic storytelling shelves."""

from __future__ import annotations

import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path

from nanoid import generate
from sqlalchemy.orm import Session

from ..models import (
    IdentityProfile,
    IdentityStoryWork,
    StoryChunk,
    StoryRecording,
    StoryWork,
)

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "storytelling"

# ~10 lục bát couplets ≈ 60–90s elderly reading.
VERSE_LINES_PER_CHUNK = 20
# Prose: ~90–120 words / ~500 chars Việt.
PROSE_CHARS_PER_CHUNK = 520


def expand_ritual_spoken(text: str) -> str:
    """Prepare kinh / nghi thức text for reading aloud.

    - Expand «(N lần)» into N spoken repeats of the preceding line (do not read «N lần»).
    - Drop «(N lạy)» stage directions (physical bows, not spoken).
    """
    out = text.replace("\r\n", "\n").replace("\r", "\n")
    out = re.sub(r"\s*\(\s*\d+\s*lạy\s*\)\.?", "", out, flags=re.I)

    def repl_lan(m: re.Match[str]) -> str:
        before = m.group(1).rstrip()
        n = int(m.group(2))
        lines = before.split("\n")
        i = len(lines) - 1
        while i >= 0 and not lines[i].strip():
            i -= 1
        if i < 0:
            return before
        phrase = lines[i].strip()
        head = "\n".join(lines[:i])
        repeated = "\n".join([phrase] * max(1, n))
        if head.strip():
            return head.rstrip() + "\n\n" + repeated
        return repeated

    out = re.sub(
        r"((?:^|\n)[^\n]*?)\s*\(\s*(\d+)\s*lần\s*\)\.?",
        repl_lan,
        out,
        flags=re.I,
    )
    out = re.sub(r"(?m)^\*\s*", "", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _load_work_payload(slug: str) -> dict | None:
    chunk_path = DATA_DIR / f"{slug}.chunks.json"
    if not chunk_path.is_file():
        return None
    return json.loads(chunk_path.read_text(encoding="utf-8"))


def seed_storytelling_corpus(db: Session) -> None:
    """Upsert catalog works from JSON — adds missing slugs without wiping recordings."""
    index_path = DATA_DIR / "index.json"
    if not index_path.is_file():
        return
    index = json.loads(index_path.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    existing = {w.slug: w for w in db.query(StoryWork).all()}
    changed = False
    for meta in index.get("works") or []:
        slug = str(meta.get("slug") or "").strip()
        if not slug:
            continue
        payload = _load_work_payload(slug) or meta
        category = str(
            payload.get("category") or meta.get("category") or "classic"
        ).strip() or "classic"
        sort_order = int(payload.get("sort_order") or meta.get("sort_order") or 100)
        work = existing.get(slug)
        if work is None:
            work = StoryWork(
                id=generate(),
                slug=slug,
                title=str(payload.get("title") or meta.get("title") or slug),
                author=str(payload.get("author") or meta.get("author") or ""),
                source_note=str(
                    payload.get("source_note") or meta.get("source_note") or ""
                ),
                category=category,
                sort_order=sort_order,
                created_at=now,
            )
            db.add(work)
            db.flush()
            existing[slug] = work
            changed = True
            for chunk in payload.get("chunks") or []:
                _add_chunk_row(db, work.id, chunk)
                changed = True
        else:
            # Keep metadata in sync when catalog JSON gains category/order.
            if getattr(work, "category", None) != category:
                work.category = category
                changed = True
            if getattr(work, "sort_order", None) != sort_order:
                work.sort_order = sort_order
                changed = True
            new_title = str(payload.get("title") or meta.get("title") or "").strip()
            if new_title and work.title != new_title:
                work.title = new_title
                changed = True
            new_author = str(payload.get("author") or meta.get("author") or "").strip()
            if new_author and work.author != new_author:
                work.author = new_author
                changed = True
            new_note = str(
                payload.get("source_note") or meta.get("source_note") or ""
            ).strip()
            if new_note and work.source_note != new_note:
                work.source_note = new_note
                changed = True
            disk_chunks = payload.get("chunks") or []
            db_count = (
                db.query(StoryChunk.id).filter(StoryChunk.work_id == work.id).count()
            )
            if disk_chunks and db_count == 0:
                for chunk in disk_chunks:
                    _add_chunk_row(db, work.id, chunk)
                    changed = True
            elif (
                disk_chunks
                and db_count > 0
                and db_count != len(disk_chunks)
                and slug == "kinh_duoc_su"
            ):
                # One-shot sync when family sutra text lands on disk after empty seed.
                replace_work_chunks(db, work=work, chunks=disk_chunks)
                changed = True
                # replace_work_chunks already commits
                continue
    if changed:
        db.commit()


def _add_chunk_row(db: Session, work_id: str, chunk: dict) -> None:
    chunk_id = str(chunk.get("id") or "").strip() or generate()
    if len(chunk_id) > 32:
        chunk_id = generate()
    body = str(chunk.get("body") or "").strip()
    if not body:
        return
    db.add(
        StoryChunk(
            id=chunk_id,
            work_id=work_id,
            sort_order=int(chunk.get("sort_order") or 0),
            label=str(chunk.get("label") or ""),
            body=body,
            line_start=int(chunk.get("line_start") or 0),
            line_end=int(chunk.get("line_end") or 0),
            approx_seconds=int(chunk.get("approx_seconds") or 60),
        )
    )


def chunk_verse_text(text: str, *, work_slug: str) -> list[dict]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return _chunk_line_list(lines, work_slug=work_slug, kind="verse")


def chunk_prose_text(text: str, *, work_slug: str) -> list[dict]:
    """Split prose into reading-sized paragraphs groups."""
    cleaned = re.sub(r"\r\n?", "\n", text).strip()
    if not cleaned:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n+", cleaned) if p.strip()]
    if len(paras) <= 1:
        # Single block — slice by character budget on sentence boundaries.
        paras = _split_long_prose(cleaned)
    chunks: list[dict] = []
    buf: list[str] = []
    buf_len = 0
    idx = 1
    line_cursor = 1

    def flush() -> None:
        nonlocal idx, buf, buf_len, line_cursor
        if not buf:
            return
        body = "\n\n".join(buf)
        start = line_cursor
        end = line_cursor + len(buf) - 1
        approx = max(35, int(len(body) / 7))
        chunks.append(
            {
                "id": f"{work_slug}-{idx:04d}"[:32],
                "sort_order": idx,
                "label": f"Đoạn {idx}",
                "body": body,
                "line_start": start,
                "line_end": end,
                "approx_seconds": approx,
            }
        )
        idx += 1
        line_cursor = end + 1
        buf = []
        buf_len = 0

    for para in paras:
        plen = len(para)
        if buf and buf_len + plen > PROSE_CHARS_PER_CHUNK:
            flush()
        buf.append(para)
        buf_len += plen
        if buf_len >= PROSE_CHARS_PER_CHUNK:
            flush()
    flush()
    return chunks


def _split_long_prose(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    out: list[str] = []
    buf = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if buf and len(buf) + len(s) > PROSE_CHARS_PER_CHUNK:
            out.append(buf.strip())
            buf = s
        else:
            buf = f"{buf} {s}".strip() if buf else s
    if buf:
        out.append(buf.strip())
    return out or [text]


def _chunk_line_list(lines: list[str], *, work_slug: str, kind: str) -> list[dict]:
    chunks: list[dict] = []
    i = 0
    idx = 1
    step = VERSE_LINES_PER_CHUNK
    while i < len(lines):
        piece = lines[i : i + step]
        line_start = i + 1
        line_end = i + len(piece)
        couplets = (len(piece) + 1) // 2
        approx = max(30, int(couplets * 7.5)) if kind == "verse" else max(
            35, int(sum(len(x) for x in piece) / 7)
        )
        chunks.append(
            {
                "id": f"{work_slug}-{idx:04d}"[:32],
                "sort_order": idx,
                "label": f"Đoạn {idx} (câu {line_start}–{line_end})",
                "body": "\n".join(piece),
                "line_start": line_start,
                "line_end": line_end,
                "approx_seconds": approx,
            }
        )
        idx += 1
        i += step
    return chunks


def replace_work_chunks(
    db: Session,
    *,
    work: StoryWork,
    chunks: list[dict],
) -> int:
    """Replace all chunks for a work. Deletes prior recordings for those chunks."""
    old_ids = [
        row[0]
        for row in db.query(StoryChunk.id).filter(StoryChunk.work_id == work.id).all()
    ]
    if old_ids:
        (
            db.query(StoryRecording)
            .filter(StoryRecording.chunk_id.in_(old_ids))
            .delete(synchronize_session=False)
        )
        (
            db.query(StoryChunk)
            .filter(StoryChunk.work_id == work.id)
            .delete(synchronize_session=False)
        )
        db.flush()
    for chunk in chunks:
        _add_chunk_row(db, work.id, chunk)
    db.commit()
    return len(chunks)


def get_identity_in_space(
    db: Session, *, space_id: str, identity_id: str
) -> IdentityProfile | None:
    return (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.id == identity_id,
            IdentityProfile.space_id == space_id,
        )
        .one_or_none()
    )


def ready_recording_for_chunk(
    db: Session, *, identity_id: str, chunk_id: str
) -> StoryRecording | None:
    return (
        db.query(StoryRecording)
        .filter(
            StoryRecording.identity_id == identity_id,
            StoryRecording.chunk_id == chunk_id,
            StoryRecording.status == "ready",
        )
        .order_by(StoryRecording.created_at.desc())
        .first()
    )


def recorded_chunk_ids(
    db: Session, *, identity_id: str, work_id: str | None = None
) -> set[str]:
    q = db.query(StoryRecording.chunk_id).filter(
        StoryRecording.identity_id == identity_id,
        StoryRecording.status == "ready",
    )
    if work_id:
        q = q.join(StoryChunk, StoryChunk.id == StoryRecording.chunk_id).filter(
            StoryChunk.work_id == work_id
        )
    return {row[0] for row in q.all()}


def pick_next_to_record(
    db: Session,
    *,
    identity_id: str,
    work_id: str | None = None,
    rng: random.Random | None = None,
) -> StoryChunk | None:
    """Prefer unrecorded chunks on enabled works; random among them."""
    enabled = (
        db.query(IdentityStoryWork.work_id)
        .filter(IdentityStoryWork.identity_id == identity_id)
        .all()
    )
    work_ids = [row[0] for row in enabled]
    if work_id:
        if work_id not in work_ids:
            return None
        work_ids = [work_id]
    if not work_ids:
        return None
    done = recorded_chunk_ids(db, identity_id=identity_id)
    candidates = (
        db.query(StoryChunk)
        .filter(StoryChunk.work_id.in_(work_ids))
        .order_by(StoryChunk.sort_order.asc())
        .all()
    )
    open_chunks = [c for c in candidates if c.id not in done]
    if not open_chunks:
        return None
    return (rng or random.SystemRandom()).choice(open_chunks)


def pick_next_to_listen(
    db: Session,
    *,
    identity_id: str,
    work_id: str | None = None,
    rng: random.Random | None = None,
) -> tuple[StoryChunk, StoryRecording] | None:
    """Prefer a ready cache; otherwise None (caller synthesizes)."""
    q = (
        db.query(StoryRecording, StoryChunk)
        .join(StoryChunk, StoryChunk.id == StoryRecording.chunk_id)
        .filter(
            StoryRecording.identity_id == identity_id,
            StoryRecording.status == "ready",
        )
    )
    if work_id:
        q = q.filter(StoryChunk.work_id == work_id)
    rows = q.all()
    if not rows:
        return None
    recording, chunk = (rng or random.SystemRandom()).choice(rows)
    return chunk, recording


def pick_next_chunk_to_hear(
    db: Session,
    *,
    identity_id: str,
    work_id: str | None = None,
    rng: random.Random | None = None,
) -> StoryChunk | None:
    """Any chunk on an enabled work — for TTS-on-demand when nothing is cached yet."""
    enabled = (
        db.query(IdentityStoryWork.work_id)
        .filter(IdentityStoryWork.identity_id == identity_id)
        .all()
    )
    work_ids = [row[0] for row in enabled]
    if work_id:
        if work_id not in work_ids:
            return None
        work_ids = [work_id]
    if not work_ids:
        return None
    candidates = (
        db.query(StoryChunk)
        .filter(StoryChunk.work_id.in_(work_ids))
        .order_by(StoryChunk.sort_order.asc())
        .all()
    )
    if not candidates:
        return None
    done = recorded_chunk_ids(db, identity_id=identity_id)
    # Prefer uncached so the shelf fills out; fall back to any chunk.
    open_chunks = [c for c in candidates if c.id not in done]
    pool = open_chunks or candidates
    return (rng or random.SystemRandom()).choice(pool)


def enabled_readable_works(db: Session, *, identity_id: str) -> list[StoryWork]:
    """Enabled shelf works that already have at least one chunk of text."""
    rows = (
        db.query(StoryWork)
        .join(IdentityStoryWork, IdentityStoryWork.work_id == StoryWork.id)
        .filter(IdentityStoryWork.identity_id == identity_id)
        .order_by(StoryWork.category.asc(), StoryWork.sort_order.asc())
        .all()
    )
    if not rows:
        return []
    work_ids = [w.id for w in rows]
    with_text = {
        row[0]
        for row in (
            db.query(StoryChunk.work_id)
            .filter(StoryChunk.work_id.in_(work_ids))
            .distinct()
            .all()
        )
    }
    return [w for w in rows if w.id in with_text]


def pick_random_chunk_for_work(
    db: Session,
    *,
    work_id: str,
    rng: random.Random | None = None,
) -> StoryChunk | None:
    """Uniform random passage — recorded or not; chat recite must not prefer cache."""
    candidates = (
        db.query(StoryChunk)
        .filter(StoryChunk.work_id == work_id)
        .order_by(StoryChunk.sort_order.asc())
        .all()
    )
    if not candidates:
        return None
    return (rng or random.SystemRandom()).choice(candidates)


def _work_search_blob(work: StoryWork) -> str:
    from .heritage import normalize_text

    slug = (work.slug or "").replace("_", " ")
    return normalize_text(f"{slug} {work.title or ''} {work.author or ''}")


def score_work_for_recite(work: StoryWork, query: str) -> int:
    """How well a user ask matches this classic/sutra title (not category alone)."""
    from .heritage import normalize_text

    query_norm = normalize_text(query)
    blob = _work_search_blob(work)
    title_norm = normalize_text(work.title or "")
    slug_norm = normalize_text((work.slug or "").replace("_", " "))
    score = 0
    if title_norm and title_norm in query_norm:
        score += 60
    if slug_norm and slug_norm in query_norm:
        score += 50
    # Significant tokens from the title/slug that appear in the ask.
    skip = {"kinh", "truyen", "tho", "phat", "tac", "gia"}
    for tok in re.split(r"[^\w]+", blob):
        if len(tok) < 3 or tok in skip:
            continue
        if tok in query_norm:
            score += 12
    return score


def pick_work_for_recite(
    works: list[StoryWork],
    query: str,
    *,
    rng: random.Random | None = None,
    allow_category_fallback: bool = True,
) -> StoryWork | None:
    """Match a specific work, or fall back to a random enabled kinh / truyện."""
    from .heritage import normalize_text

    if not works:
        return None
    query_norm = normalize_text(query)
    best: StoryWork | None = None
    best_score = 0
    for work in works:
        score = score_work_for_recite(work, query)
        if score > best_score:
            best_score = score
            best = work
    if best is not None and best_score >= 12:
        return best
    if not allow_category_fallback:
        return None

    want_sutra = bool(re.search(r"\b(kinh|niem|tung)\b", query_norm))
    want_classic = bool(re.search(r"\btruyen\b", query_norm))
    if want_sutra and not want_classic:
        pool = [w for w in works if (w.category or "classic") == "sutra"]
    elif want_classic and not want_sutra:
        pool = [w for w in works if (w.category or "classic") == "classic"]
    else:
        return None
    if not pool:
        return None
    return (rng or random.SystemRandom()).choice(pool)


class StoryTtsError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(detail)


def ensure_story_tts_recording(
    db: Session,
    *,
    identity: IdentityProfile,
    chunk: StoryChunk,
    user_id: str,
) -> StoryRecording:
    """Synthesize Voice DNA for a chunk and cache as StoryRecording(source=tts).

    Reuses a ready row when fingerprint still matches voice+text.
    """
    from ..config import get_settings
    from .heritage import voice_for_identity
    from .heritage_tts import PoemReciteError, synthesize_poem_audio
    from .poem_recite import recite_fingerprint, voice_can_recite
    from .storage import absolute_media_path, delete_media_artifacts, save_bytes

    text = (chunk.body or "").strip()
    if not text:
        raise StoryTtsError(400, "Đoạn trống.")
    voice = voice_for_identity(db, identity)
    if not voice_can_recite(voice):
        raise StoryTtsError(
            409,
            "Chưa có Voice DNA sẵn để đọc. Steward hoàn thiện Giọng từ ký ức trước.",
        )
    assert voice is not None
    fingerprint = recite_fingerprint(voice, text)

    existing = ready_recording_for_chunk(
        db, identity_id=identity.id, chunk_id=chunk.id
    )
    if existing and (getattr(existing, "fingerprint", None) or "") == fingerprint:
        path = absolute_media_path(existing.media_path)
        if path.exists() and path.stat().st_size >= 8:
            return existing

    try:
        # Chat «đọc kinh/truyện» must not abort mid-passage on the poem char cap;
        # chunk_tts_text still splits for the provider.
        audio = synthesize_poem_audio(
            db,
            voice=voice,
            text=text,
            settings=get_settings(),
            max_chars=0,
        )
    except PoemReciteError as exc:
        raise StoryTtsError(exc.status_code, exc.detail) from exc

    relative = save_bytes(identity.space_id, audio, ext=".mp3")
    now = datetime.now(timezone.utc)
    if existing:
        old = existing.media_path
        if old and old != relative:
            try:
                delete_media_artifacts(old)
            except Exception:
                pass
        existing.media_path = relative
        existing.media_mime = "audio/mpeg"
        existing.source = "tts"
        existing.fingerprint = fingerprint
        existing.status = "ready"
        existing.created_by = user_id
        existing.created_at = now
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    # Retire any other ready takes for this chunk.
    priors = (
        db.query(StoryRecording)
        .filter(
            StoryRecording.identity_id == identity.id,
            StoryRecording.chunk_id == chunk.id,
            StoryRecording.status == "ready",
        )
        .all()
    )
    for prior in priors:
        prior.status = "retired"
        db.add(prior)

    recording = StoryRecording(
        id=generate(),
        space_id=identity.space_id,
        identity_id=identity.id,
        chunk_id=chunk.id,
        media_path=relative,
        media_mime="audio/mpeg",
        duration_ms=None,
        source="tts",
        fingerprint=fingerprint,
        status="ready",
        created_by=user_id,
        created_at=now,
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)
    return recording
