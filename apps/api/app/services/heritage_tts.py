"""Synthesize cloned-voice audio for heritage chat replies.

Knob resolution mirrors POST /api/voices/{id}/tts so steward lab and chat
share one place. Prefer VoiceProfile.tts_prefs_json (set from Speak «Dùng cho
Gọi») over global config defaults. Chat replies are NOT saved as VoiceRender.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import SpaceSettings, VoiceProfile
from . import voice_providers as vp
from .ai_usage import UsageContext, record_usage
from .audio_combine import AudioCombineError, concat_to_mp3
from .storage import save_bytes

logger = logging.getLogger(__name__)

# Bump when synthesis options change so cached StoryRecording / poem audio that
# was cut short (raw MP3 concatenation, pause tags on long verse) is rebuilt.
POEM_TTS_REV = "v2-ffmpeg-concat"


@dataclass
class ChatTtsResult:
    media_path: str
    media_mime: str
    meta: dict


def _space_api_key(db: Session, space_id: str) -> str | None:
    row = db.query(SpaceSettings).filter(SpaceSettings.space_id == space_id).one_or_none()
    return row.elevenlabs_api_key if row else None


def parse_tts_prefs(raw: str | None) -> dict[str, Any]:
    if not raw or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def prefs_payload(voice: VoiceProfile) -> dict[str, Any] | None:
    prefs = parse_tts_prefs(getattr(voice, "tts_prefs_json", None))
    if not prefs and not (voice.provider_voice_id or "").strip():
        return None
    out = {
        "provider": (prefs.get("provider") or voice.provider or "elevenlabs"),
        "provider_voice_id": (
            prefs.get("provider_voice_id") or voice.provider_voice_id or None
        ),
        "provider_voice_name": prefs.get("provider_voice_name") or None,
        "model_id": prefs.get("model_id") or None,
        "speed": prefs.get("speed"),
        "lengthen_pauses": prefs.get("lengthen_pauses"),
        "stability": prefs.get("stability"),
        "similarity_boost": prefs.get("similarity_boost"),
        "style": prefs.get("style"),
        "use_speaker_boost": prefs.get("use_speaker_boost"),
        "emotion": prefs.get("emotion"),
        "pitch": prefs.get("pitch"),
        "intensity": prefs.get("intensity"),
        "timbre": prefs.get("timbre"),
    }
    return out


def build_tts_prefs_dict(
    *,
    provider: str,
    provider_voice_id: str,
    provider_voice_name: str = "",
    model_id: str = "",
    speed: float | None = None,
    lengthen_pauses: bool | None = None,
    stability: float | None = None,
    similarity_boost: float | None = None,
    style: float | None = None,
    use_speaker_boost: bool | None = None,
    emotion: str | None = None,
    pitch: int | None = None,
    intensity: int | None = None,
    timbre: int | None = None,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "provider_voice_id": provider_voice_id,
        "provider_voice_name": provider_voice_name or None,
        "model_id": model_id or None,
        "speed": speed,
        "lengthen_pauses": lengthen_pauses,
        "stability": stability,
        "similarity_boost": similarity_boost,
        "style": style,
        "use_speaker_boost": use_speaker_boost,
        "emotion": emotion,
        "pitch": pitch,
        "intensity": intensity,
        "timbre": timbre,
    }


def apply_tts_prefs(voice: VoiceProfile, prefs: dict[str, Any]) -> None:
    """Write prefs onto the profile and attach the clone as the chat default."""
    provider_voice_id = str(prefs.get("provider_voice_id") or "").strip()
    if not provider_voice_id:
        raise ValueError("provider_voice_id required")
    provider = str(prefs.get("provider") or voice.provider or "elevenlabs").strip()
    cleaned = build_tts_prefs_dict(
        provider=provider,
        provider_voice_id=provider_voice_id,
        provider_voice_name=str(prefs.get("provider_voice_name") or ""),
        model_id=str(prefs.get("model_id") or ""),
        speed=prefs.get("speed"),
        lengthen_pauses=prefs.get("lengthen_pauses"),
        stability=prefs.get("stability"),
        similarity_boost=prefs.get("similarity_boost"),
        style=prefs.get("style"),
        use_speaker_boost=prefs.get("use_speaker_boost"),
        emotion=prefs.get("emotion"),
        pitch=prefs.get("pitch"),
        intensity=prefs.get("intensity"),
        timbre=prefs.get("timbre"),
    )
    voice.tts_prefs_json = json.dumps(cleaned, ensure_ascii=False)
    voice.provider = provider
    voice.provider_voice_id = provider_voice_id
    if (voice.status or "") in ("draft", "failed", "ready"):
        voice.status = "ready"
    voice.error_message = ""


def synthesize_chat_reply(
    db: Session,
    *,
    voice: VoiceProfile,
    text: str,
    settings: Settings | None = None,
) -> ChatTtsResult | None:
    """Return saved MP3 path + meta, or None when TTS cannot run.

    Never raises into the chat path — provider failures become None.
    """
    settings = settings or get_settings()
    body = (text or "").strip()
    if not body:
        return None

    # Soft cost guard aligned with story depth (~512 tokens). Longer replies
    # stay text-only; length is still steered upstream by analyzer depth.
    max_chars = max(1, int(settings.heritage_tts_max_chars or 512))
    if len(body) > max_chars:
        logger.info(
            "heritage TTS skipped: %s chars > max %s",
            len(body),
            max_chars,
        )
        return None

    prefs = parse_tts_prefs(getattr(voice, "tts_prefs_json", None))
    provider_voice_id = (
        str(prefs.get("provider_voice_id") or voice.provider_voice_id or "")
    ).strip()
    if (voice.status or "") != "ready" or not provider_voice_id:
        return None

    provider = vp.normalize(
        str(prefs.get("provider") or voice.provider or ""), settings
    )
    model_id = str(prefs.get("model_id") or "").strip() or vp.default_model(
        provider, settings
    )
    api_key = vp.resolve_api_key(provider, settings, _space_api_key(db, voice.space_id))
    if not (api_key or "").strip():
        return None

    is_minimax = provider == vp.MINIMAX

    def _pref(key: str, fallback):
        if key in prefs and prefs[key] is not None:
            return prefs[key]
        return fallback

    speed = _pref(
        "speed",
        settings.minimax_speed if is_minimax else settings.elevenlabs_speed,
    )
    lengthen_pauses = _pref(
        "lengthen_pauses",
        settings.minimax_lengthen_pauses
        if is_minimax
        else settings.elevenlabs_lengthen_pauses,
    )
    stability = None if is_minimax else _pref("stability", settings.elevenlabs_stability)
    similarity_boost = (
        None
        if is_minimax
        else _pref("similarity_boost", settings.elevenlabs_similarity_boost)
    )
    style = None if is_minimax else _pref("style", settings.elevenlabs_style)
    use_speaker_boost = (
        None
        if is_minimax
        else _pref("use_speaker_boost", settings.elevenlabs_speaker_boost)
    )
    emotion = None
    if is_minimax:
        raw_emotion = str(_pref("emotion", "") or "").strip().lower()
        emotion = raw_emotion if raw_emotion and raw_emotion != "auto" else None
    pitch = _pref("pitch", None) if is_minimax else None
    intensity = _pref("intensity", None) if is_minimax else None
    timbre = _pref("timbre", None) if is_minimax else None

    started = time.monotonic()
    try:
        audio = vp.text_to_speech(
            provider,
            settings=settings,
            api_key=api_key,
            voice_id=provider_voice_id,
            text=body,
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
        logger.warning("heritage TTS provider error: %s", exc.message)
        return None
    except Exception:  # noqa: BLE001 — chat must never raise here
        logger.exception("heritage TTS failed")
        return None

    if not audio:
        return None

    try:
        relative = save_bytes(voice.space_id, audio, ext=".mp3")
    except Exception:  # noqa: BLE001
        logger.exception("heritage TTS save failed")
        return None

    latency_ms = int((time.monotonic() - started) * 1000)
    record_usage(
        service=provider,
        provider=provider,
        operation="tts_chat",
        model=model_id,
        output_chars=len(body),
        latency_ms=latency_ms,
        context=UsageContext(space_id=voice.space_id, operation="tts_chat"),
        meta={"voice_id": provider_voice_id},
    )
    return ChatTtsResult(
        media_path=relative,
        media_mime="audio/mpeg",
        meta={
            "provider": provider,
            "model": model_id,
            "voice_id": provider_voice_id,
            "voice_name": prefs.get("provider_voice_name"),
            "chars": len(body),
            "latency_ms": latency_ms,
            "from_prefs": bool(prefs),
        },
    )


class PoemReciteError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def chunk_tts_text(text: str, limit: int) -> list[str]:
    """Split poem TTS text on stanza breaks, then lines, then hard length."""
    limit = max(120, int(limit or 900))
    raw = (text or "").strip()
    if not raw:
        return []
    if len(raw) <= limit:
        return [raw]

    chunks: list[str] = []
    buf = ""

    def flush() -> None:
        nonlocal buf
        if buf.strip():
            chunks.append(buf.strip())
        buf = ""

    def append_piece(piece: str, *, joiner: str = "\n\n") -> None:
        nonlocal buf
        piece = piece.strip()
        if not piece:
            return
        if len(piece) > limit:
            flush()
            start = 0
            while start < len(piece):
                end = min(start + limit, len(piece))
                if end < len(piece):
                    cut = piece.rfind(" ", start, end)
                    if cut > start + 40:
                        end = cut
                chunks.append(piece[start:end].strip())
                start = end
            return
        candidate = f"{buf}{joiner}{piece}".strip() if buf else piece
        if len(candidate) <= limit:
            buf = candidate
        else:
            flush()
            buf = piece

    for stanza in re.split(r"\n\s*\n", raw):
        stanza = stanza.strip()
        if not stanza:
            continue
        if len(stanza) <= limit:
            append_piece(stanza)
            continue
        # Verse lines stay single-spaced — blank lines between every lục/bát
        # made some voices stop after the first few couplets.
        for line in stanza.split("\n"):
            append_piece(line, joiner="\n")
    flush()
    return [c for c in chunks if c]


def _merge_mp3_parts(parts: list[bytes]) -> bytes:
    """Join provider MP3 takes into one playable file.

    Raw byte concatenation leaves a second MPEG header mid-stream; many Android
    players stop at that boundary — which is how a Kiều passage ended after the
    first TTS piece («Phong tình cổ lục…») while the rest of the text stayed on
    screen.
    """
    usable = [p for p in parts if p]
    if not usable:
        return b""
    if len(usable) == 1:
        return usable[0]
    try:
        with TemporaryDirectory(prefix="forever-poem-tts-") as tmp:
            root = Path(tmp)
            paths: list[Path] = []
            for index, blob in enumerate(usable):
                path = root / f"part-{index:02d}.mp3"
                path.write_bytes(blob)
                paths.append(path)
            out = root / "joined.mp3"
            concat_to_mp3(paths, out)
            return out.read_bytes()
    except AudioCombineError:
        logger.exception("poem TTS ffmpeg concat failed; falling back to first part")
        return usable[0]


def _voice_tts_knobs(
    db: Session,
    voice: VoiceProfile,
    settings: Settings,
) -> dict[str, Any]:
    prefs = parse_tts_prefs(getattr(voice, "tts_prefs_json", None))
    provider_voice_id = (
        str(prefs.get("provider_voice_id") or voice.provider_voice_id or "")
    ).strip()
    if (voice.status or "") != "ready" or not provider_voice_id:
        raise PoemReciteError(409, "Chưa có giọng để đọc thơ.")
    provider = vp.normalize(
        str(prefs.get("provider") or voice.provider or ""), settings
    )
    model_id = str(prefs.get("model_id") or "").strip() or vp.default_model(
        provider, settings
    )
    api_key = vp.resolve_api_key(provider, settings, _space_api_key(db, voice.space_id))
    if not (api_key or "").strip():
        raise PoemReciteError(503, "Chưa cấu hình khóa TTS để đọc thơ.")
    is_minimax = provider == vp.MINIMAX

    def _pref(key: str, fallback):
        if key in prefs and prefs[key] is not None:
            return prefs[key]
        return fallback

    return {
        "prefs": prefs,
        "provider": provider,
        "provider_voice_id": provider_voice_id,
        "model_id": model_id,
        "api_key": api_key,
        "speed": _pref(
            "speed",
            settings.minimax_speed if is_minimax else settings.elevenlabs_speed,
        ),
        "lengthen_pauses": _pref(
            "lengthen_pauses",
            settings.minimax_lengthen_pauses
            if is_minimax
            else settings.elevenlabs_lengthen_pauses,
        ),
        "stability": None
        if is_minimax
        else _pref("stability", settings.elevenlabs_stability),
        "similarity_boost": None
        if is_minimax
        else _pref("similarity_boost", settings.elevenlabs_similarity_boost),
        "style": None if is_minimax else _pref("style", settings.elevenlabs_style),
        "use_speaker_boost": None
        if is_minimax
        else _pref("use_speaker_boost", settings.elevenlabs_speaker_boost),
        "emotion": (
            (str(_pref("emotion", "") or "").strip().lower() or None)
            if is_minimax
            else None
        ),
        "pitch": _pref("pitch", None) if is_minimax else None,
        "intensity": _pref("intensity", None) if is_minimax else None,
        "timbre": _pref("timbre", None) if is_minimax else None,
    }


def synthesize_poem_audio(
    db: Session,
    *,
    voice: VoiceProfile,
    text: str,
    settings: Settings | None = None,
    max_chars: int | None = None,
    lengthen_pauses: bool | None = None,
    chunk_chars: int | None = None,
) -> bytes:
    """Render a poem (possibly in chunks). Raises PoemReciteError on failure.

    Pass ``max_chars=0`` to skip the hard cap (story/sutra chat recite — still
    split into pieces so playback is complete). Story recite should pass a
    modest ``chunk_chars`` (~280 ≈ 4 lục bát couplets) and ``lengthen_pauses=
    False``: one long take was stopping after the first few couplets, and pause
    tags made some voices cut the rest.
    """
    settings = settings or get_settings()
    body = (text or "").strip()
    if not body:
        raise PoemReciteError(400, "Bài thơ trống.")
    if max_chars is None:
        max_chars = max(1, int(settings.heritage_poem_tts_max_chars or 8000))
    if max_chars > 0 and len(body) > max_chars:
        raise PoemReciteError(
            400,
            f"Bài thơ dài hơn {max_chars} ký tự — tách khổ hoặc rút gọn trước khi đọc.",
        )
    knobs = _voice_tts_knobs(db, voice, settings)
    chunk_limit = max(
        120,
        int(
            chunk_chars
            if chunk_chars is not None
            else (settings.heritage_poem_tts_chunk_chars or 900)
        ),
    )
    pause_flag = (
        knobs["lengthen_pauses"] if lengthen_pauses is None else lengthen_pauses
    )
    pieces = chunk_tts_text(body, chunk_limit)
    audio_parts: list[bytes] = []
    started = time.monotonic()
    try:
        for piece in pieces:
            part = vp.text_to_speech(
                knobs["provider"],
                settings=settings,
                api_key=knobs["api_key"],
                voice_id=knobs["provider_voice_id"],
                text=piece,
                model_id=knobs["model_id"],
                stability=knobs["stability"],
                similarity_boost=knobs["similarity_boost"],
                style=knobs["style"],
                speed=knobs["speed"],
                use_speaker_boost=knobs["use_speaker_boost"],
                lengthen_pauses=pause_flag,
                emotion=knobs["emotion"]
                if knobs["emotion"] and knobs["emotion"] != "auto"
                else None,
                pitch=knobs["pitch"],
                intensity=knobs["intensity"],
                timbre=knobs["timbre"],
            )
            if not part:
                raise PoemReciteError(502, "TTS không trả về âm thanh.")
            audio_parts.append(part)
    except PoemReciteError:
        raise
    except vp.VoiceProviderError as exc:
        raise PoemReciteError(exc.status_code or 502, exc.message) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("poem TTS failed")
        raise PoemReciteError(502, "Không đọc được bài thơ lúc này.") from exc

    audio = _merge_mp3_parts(audio_parts)
    if not audio:
        raise PoemReciteError(502, "TTS không trả về âm thanh.")
    latency_ms = int((time.monotonic() - started) * 1000)
    record_usage(
        service=knobs["provider"],
        provider=knobs["provider"],
        operation="tts_poem",
        model=knobs["model_id"],
        output_chars=len(body),
        latency_ms=latency_ms,
        context=UsageContext(space_id=voice.space_id, operation="tts_poem"),
        meta={
            "voice_id": knobs["provider_voice_id"],
            "chunks": len(pieces),
            "tts_rev": POEM_TTS_REV,
        },
    )
    return audio
