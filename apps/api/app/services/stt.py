"""Speech-to-text for chat voice notes.

Uses Gemini inline audio through the shared heritage transport so timeout,
retry, and "never raise into the chat path" stay consistent.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from pathlib import Path

from ..config import Settings, get_settings
from .heritage_gemini import GeminiCall, call_gemini

logger = logging.getLogger(__name__)

_STT_SYSTEM = (
    "Bạn là bộ máy ghi âm thành chữ tiếng Việt. "
    "Ghi lại nguyên văn người nói — không dịch, không diễn giải, không thêm dấu câu thừa. "
    "Chỉ trả về đúng nội dung đã nghe. "
    "Nếu nghe không rõ hoặc không có lời nói, trả về chuỗi rỗng."
)

# Gemini generateContent accepts these audio MIME types for inline_data.
_GEMINI_AUDIO_MIME = {
    "audio/mpeg": "audio/mpeg",
    "audio/mp3": "audio/mpeg",
    "audio/mp4": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "audio/aac": "audio/aac",
    "audio/wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/webm": "audio/webm",
    "audio/ogg": "audio/ogg",
    "audio/flac": "audio/flac",
    "audio/aiff": "audio/aiff",
    "audio/3gpp": "audio/3gpp",
}


@dataclass
class Transcript:
    text: str = ""
    provider: str = ""
    model: str = ""
    latency_ms: int = 0
    error: str | None = None

    @property
    def ok(self) -> bool:
        return bool(self.text.strip()) and not self.error

    def as_meta(self) -> dict:
        out: dict = {
            "provider": self.provider,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "chars": len(self.text or ""),
        }
        if self.error:
            out["error"] = self.error
        return out


def _resolve_mime(mime: str | None) -> str | None:
    raw = (mime or "").strip().lower().split(";")[0].strip()
    if not raw:
        return None
    return _GEMINI_AUDIO_MIME.get(raw)


def _stt_model(settings: Settings) -> str:
    return (settings.stt_model or "").strip() or settings.gemini_model


def transcribe(
    settings: Settings | None = None,
    *,
    path: Path | str,
    mime: str | None = None,
) -> Transcript:
    """Transcribe an audio file. Never raises — errors live on Transcript.error."""
    settings = settings or get_settings()
    provider = (settings.stt_provider or "gemini").strip().lower()
    model = _stt_model(settings)

    if not settings.stt_enabled:
        return Transcript(provider=provider, model=model, error="disabled")

    if provider != "gemini":
        return Transcript(provider=provider, model=model, error="unsupported_provider")

    gemini_mime = _resolve_mime(mime)
    if not gemini_mime:
        return Transcript(provider=provider, model=model, error="unsupported_mime")

    file_path = Path(path)
    try:
        data = file_path.read_bytes()
    except OSError as exc:
        logger.warning("stt read failed: %s", exc)
        return Transcript(provider=provider, model=model, error="read_failed")

    if not data:
        return Transcript(provider=provider, model=model, error="empty_file")

    max_bytes = max(1, int(settings.stt_max_bytes or 0))
    if len(data) > max_bytes:
        return Transcript(provider=provider, model=model, error="too_large")

    b64 = base64.b64encode(data).decode("ascii")
    result = call_gemini(
        settings,
        GeminiCall(
            system_prompt=_STT_SYSTEM,
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": gemini_mime, "data": b64}},
                        {
                            "text": (
                                "Ghi lại nguyên văn tiếng Việt trong đoạn ghi âm này. "
                                "Không rõ thì trả về rỗng."
                            )
                        },
                    ],
                }
            ],
            model=model,
            temperature=0.0,
            max_output_tokens=1024,
            timeout_s=45.0,
            attempts=2,
        ),
    )

    if result.error and not result.text:
        return Transcript(
            provider=provider,
            model=model,
            latency_ms=result.latency_ms,
            error=result.error,
        )

    text = (result.text or "").strip()
    # Model sometimes returns a placeholder instead of empty.
    if text in {"(rỗng)", "(empty)", "[empty]", "…", "..."}:
        text = ""

    return Transcript(
        text=text,
        provider=provider,
        model=model,
        latency_ms=result.latency_ms,
        error=None if text else (result.error or "empty_transcript"),
    )
