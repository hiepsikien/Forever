"""Cached Voice DNA recitation of a library poem — not a chat turn."""

from __future__ import annotations

import hashlib

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import IdentityProfile, MemoryItem, VoiceProfile
from .heritage import HERITAGE_TAG_PREFIX, POEM_KIND, tag_tokens, voice_for_identity
from .heritage_tts import POEM_TTS_REV, PoemReciteError, parse_tts_prefs, synthesize_poem_audio
from .memory_scope import visible_to
from .storage import absolute_media_path, delete_media_artifacts, save_bytes


def recite_text(item: MemoryItem) -> str:
    return ((item.body_tts or "").strip() or (item.body or "").strip())


def recite_fingerprint(voice: VoiceProfile, text: str) -> str:
    prefs = parse_tts_prefs(getattr(voice, "tts_prefs_json", None))
    voice_id = (
        str(prefs.get("provider_voice_id") or voice.provider_voice_id or "")
    ).strip()
    model = str(prefs.get("model_id") or "").strip()
    raw = f"{voice.id}|{voice_id}|{model}|{text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def clear_poem_recite(item: MemoryItem) -> None:
    path = getattr(item, "recite_media_path", None) or ""
    if path:
        try:
            delete_media_artifacts(path)
        except Exception:
            pass
    item.recite_media_path = None
    item.recite_fingerprint = ""


def identity_ids_on_poem(item: MemoryItem) -> list[str]:
    prefix = HERITAGE_TAG_PREFIX
    out: list[str] = []
    for token in tag_tokens(item.tags):
        if token.startswith(prefix):
            ident = token[len(prefix) :].strip()
            if ident:
                out.append(ident)
    return out


def resolve_recite_identity(
    db: Session,
    item: MemoryItem,
    *,
    preferred_id: str | None = None,
) -> IdentityProfile:
    wanted = (preferred_id or "").strip()
    tagged = identity_ids_on_poem(item)
    if wanted:
        if tagged and wanted not in tagged:
            raise PoemReciteError(400, "Bài thơ không gắn với người này.")
        row = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == wanted, IdentityProfile.space_id == item.space_id)
            .one_or_none()
        )
        if not row:
            raise PoemReciteError(404, "Không tìm thấy người để đọc thơ.")
        return row
    for ident_id in tagged:
        row = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == ident_id)
            .one_or_none()
        )
        if not row:
            continue
        voice = voice_for_identity(db, row)
        if voice and (voice.status or "") == "ready" and (voice.provider_voice_id or "").strip():
            return row
    if tagged:
        row = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == tagged[0])
            .one_or_none()
        )
        if row:
            return row
    raise PoemReciteError(409, "Bài thơ chưa neo người có giọng để đọc.")


def voice_can_recite(voice: VoiceProfile | None) -> bool:
    if voice is None:
        return False
    return (voice.status or "") == "ready" and bool((voice.provider_voice_id or "").strip())


def cached_recite_bytes(item: MemoryItem, fingerprint: str) -> bytes | None:
    path = getattr(item, "recite_media_path", None) or ""
    stored = getattr(item, "recite_fingerprint", None) or ""
    if not path or stored != fingerprint:
        return None
    abs_path = absolute_media_path(path)
    if not abs_path.exists() or abs_path.stat().st_size < 8:
        return None
    return abs_path.read_bytes()


def get_or_create_recite_audio(
    db: Session,
    item: MemoryItem,
    *,
    user_id: str | None,
    preferred_identity_id: str | None = None,
) -> bytes:
    if (item.kind or "") != POEM_KIND:
        raise PoemReciteError(400, "Chỉ đọc được bài thơ.")
    if not visible_to(item, user_id):
        raise PoemReciteError(404, "Không tìm thấy bài thơ.")
    text = recite_text(item)
    if not text:
        raise PoemReciteError(400, "Bài thơ trống.")
    identity = resolve_recite_identity(db, item, preferred_id=preferred_identity_id)
    voice = voice_for_identity(db, identity)
    if not voice_can_recite(voice):
        raise PoemReciteError(409, "Chưa có giọng để đọc thơ.")
    assert voice is not None
    fingerprint = recite_fingerprint(voice, f"{POEM_TTS_REV}|{text}")
    cached = cached_recite_bytes(item, fingerprint)
    if cached:
        return cached
    audio = synthesize_poem_audio(
        db,
        voice=voice,
        text=text,
        settings=get_settings(),
        lengthen_pauses=False,
        chunk_chars=280,
    )
    relative = save_bytes(item.space_id, audio, ext=".mp3")
    old = getattr(item, "recite_media_path", None) or ""
    if old and old != relative:
        try:
            delete_media_artifacts(old)
        except Exception:
            pass
    item.recite_media_path = relative
    item.recite_fingerprint = fingerprint
    db.add(item)
    db.commit()
    return audio
