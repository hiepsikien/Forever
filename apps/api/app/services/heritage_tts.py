"""Synthesize cloned-voice audio for heritage chat replies.

Knob resolution mirrors POST /api/voices/{id}/tts so steward lab and chat
share one place. Prefer VoiceProfile.tts_prefs_json (set from Speak «Dùng cho
Gọi») over global config defaults. Chat replies are NOT saved as VoiceRender.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import SpaceSettings, VoiceProfile
from . import voice_providers as vp
from .ai_usage import UsageContext, record_usage
from .storage import save_bytes

logger = logging.getLogger(__name__)


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
