"""One surface over the voice-cloning providers Forever can speak to.

Each provider keeps its own module and its own quirks; this layer is only about
picking one and translating errors so routers never branch on a vendor name.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from ..config import Settings
from . import elevenlabs as el
from . import minimax as mm

ELEVENLABS = "elevenlabs"
MINIMAX = "minimax"
PROVIDERS = (ELEVENLABS, MINIMAX)

LABELS = {ELEVENLABS: "ElevenLabs", MINIMAX: "MiniMax"}


class VoiceProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize(provider: str | None, settings: Settings | None = None) -> str:
    """Fall back to the configured default rather than failing on legacy rows."""
    value = (provider or "").strip().lower()
    if value in PROVIDERS:
        return value
    if settings is not None:
        configured = (settings.voice_default_provider or "").strip().lower()
        if configured in PROVIDERS:
            return configured
    return ELEVENLABS


def label(provider: str | None) -> str:
    return LABELS.get(normalize(provider), LABELS[ELEVENLABS])


def tts_models(provider: str) -> tuple[str, ...]:
    if normalize(provider) == MINIMAX:
        return mm.VI_TTS_MODELS
    return el.VI_TTS_MODELS


def default_model(provider: str, settings: Settings) -> str:
    if normalize(provider) == MINIMAX:
        return settings.minimax_tts_model
    return settings.elevenlabs_tts_model


def default_remove_noise(provider: str, settings: Settings) -> bool:
    if normalize(provider) == MINIMAX:
        return settings.minimax_remove_noise
    return settings.elevenlabs_remove_noise


def provider_for_model(model_id: str | None) -> str | None:
    """Infer the provider from a stored model id, for rendering old rows."""
    model = (model_id or "").strip()
    if not model:
        return None
    if model in mm.VI_TTS_MODELS or model.startswith("speech-"):
        return MINIMAX
    if model in el.VI_TTS_MODELS or model.startswith("eleven_"):
        return ELEVENLABS
    return None


def resolve_api_key(provider: str, settings: Settings, space_key: str | None) -> str:
    if normalize(provider) == MINIMAX:
        # No per-space MiniMax key yet; the server key is the only source.
        return mm.resolve_api_key(settings)
    return el.resolve_api_key(settings, space_key)


def create_clone(
    provider: str,
    *,
    settings: Settings,
    api_key: str,
    name: str,
    file_paths: list[Path],
    remove_background_noise: bool,
    voice_id_seed: str,
) -> str:
    with _translated(provider):
        if normalize(provider) == MINIMAX:
            return mm.create_instant_voice_clone(
                settings=settings,
                api_key=api_key,
                file_paths=file_paths,
                voice_id_seed=voice_id_seed,
                remove_background_noise=remove_background_noise,
            )
        return el.create_instant_voice_clone(
            settings=settings,
            api_key=api_key,
            name=name,
            file_paths=file_paths,
            remove_background_noise=remove_background_noise,
            language="vi",
            description="Forever Voice DNA — Vietnamese family vault clone",
        )


def text_to_speech(
    provider: str,
    *,
    settings: Settings,
    api_key: str,
    voice_id: str,
    text: str,
    model_id: str | None = None,
    stability: float | None = None,
    similarity_boost: float | None = None,
    style: float | None = None,
    speed: float | None = None,
    use_speaker_boost: bool | None = None,
    lengthen_pauses: bool | None = None,
) -> bytes:
    with _translated(provider):
        if normalize(provider) == MINIMAX:
            # MiniMax exposes speed and pacing only — the ElevenLabs voice
            # settings have no counterpart and are dropped, not faked.
            return mm.text_to_speech(
                settings=settings,
                api_key=api_key,
                voice_id=voice_id,
                text=text,
                model_id=model_id,
                speed=speed,
                lengthen_pauses=lengthen_pauses,
            )
        return el.text_to_speech(
            settings=settings,
            api_key=api_key,
            voice_id=voice_id,
            text=text,
            model_id=model_id,
            stability=stability,
            similarity_boost=similarity_boost,
            style=style,
            speed=speed,
            use_speaker_boost=use_speaker_boost,
            lengthen_pauses=lengthen_pauses,
        )


def list_voices(
    provider: str,
    *,
    settings: Settings,
    api_key: str,
    cloned_only: bool = True,
) -> list[dict[str, Any]]:
    with _translated(provider):
        if normalize(provider) == MINIMAX:
            return mm.list_voices(
                settings=settings, api_key=api_key, cloned_only=cloned_only
            )
        return el.list_voices(
            settings=settings, api_key=api_key, cloned_only=cloned_only
        )


def delete_voice(provider: str, *, settings: Settings, api_key: str, voice_id: str) -> None:
    with _translated(provider):
        if normalize(provider) == MINIMAX:
            mm.delete_voice(settings=settings, api_key=api_key, voice_id=voice_id)
            return
        el.delete_voice(settings=settings, api_key=api_key, voice_id=voice_id)


class _translated:
    """Turn vendor and network failures into one error type for the routers."""

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> bool:
        if isinstance(exc, (el.ElevenLabsError, mm.MinimaxError)):
            raise VoiceProviderError(exc.message, status_code=exc.status_code) from exc
        if isinstance(exc, httpx.HTTPError):
            # A blip reaching the vendor is not a Forever bug; say so plainly
            # instead of letting it surface as a 500.
            raise VoiceProviderError(
                f"Không kết nối được tới {label(self.provider)}. "
                "Kiểm tra mạng rồi thử lại.",
                status_code=503,
            ) from exc
        return False
