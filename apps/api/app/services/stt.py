"""Speech-to-text for chat voice notes.

Uses Gemini inline audio through the shared heritage transport so timeout,
retry, and "never raise into the chat path" stay consistent.
"""

from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from ..config import Settings, get_settings
from .ai_usage import UsageContext
from .heritage_gemini import GeminiCall, call_gemini, parse_json_object

logger = logging.getLogger(__name__)

_STT_SYSTEM = (
    "Bạn là bộ lọc nghe tiếng Việt cho tin nhắn giọng. "
    "heard=true chỉ khi nghe rõ người đang nói thành lời (từ, câu). "
    "Im lặng, thở, tiếng nền, gõ máy, hoặc phải đoán mò → heard=false và text rỗng. "
    "Không dịch, không diễn giải, không thêm chữ không có trong audio. "
    "heard=true thì text là nguyên văn đã nghe."
)

_STT_SCHEMA = {
    "type": "object",
    "properties": {
        "heard": {"type": "boolean"},
        "text": {"type": "string"},
    },
    "required": ["heard", "text"],
}

# Whole-string placeholders Gemini uses instead of empty.
_EMPTY_MARKERS = {
    "(rỗng)",
    "(empty)",
    "[empty]",
    "…",
    "...",
    "silence",
    "no speech",
    "im lặng",
    "không có lời nói",
    "không có giọng nói",
    "không nghe rõ",
}

_SILENCE_EXPLAIN = re.compile(
    r"(?i)(không\s+có\s+(lời|giọng|tiếng)\s+nói|"
    r"không\s+nghe\s+thấy\s+lời|"
    r"no\s+(intelligible\s+)?speech|"
    r"no\s+speech\s+detected)",
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
    heard: bool = False

    @property
    def ok(self) -> bool:
        return self.heard and bool(self.text.strip()) and not self.error

    def as_meta(self) -> dict:
        out: dict = {
            "provider": self.provider,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "chars": len(self.text or ""),
            "heard": self.heard,
        }
        if self.error:
            out["error"] = self.error
        return out


def _letter_count(text: str) -> int:
    return sum(1 for ch in text if ch.isalnum())


def usable_speech(text: str) -> bool:
    """True when `text` looks like a real utterance, not a silence placeholder."""
    t = (text or "").strip()
    if _letter_count(t) < 2:
        return False
    if t.casefold() in _EMPTY_MARKERS:
        return False
    if _SILENCE_EXPLAIN.search(t) and _letter_count(t) < 48:
        return False
    return True


def parse_stt_payload(raw: str | None) -> tuple[bool, str]:
    """Return (heard, text). Never invents words when the model is unsure."""
    parsed = parse_json_object(raw)
    if parsed is not None and "heard" in parsed:
        heard = bool(parsed.get("heard"))
        text = str(parsed.get("text") or "").strip()
        if not heard:
            return False, ""
        if not usable_speech(text):
            return True, ""
        return True, text
    text = (raw or "").strip()
    if not text or text.casefold() in _EMPTY_MARKERS:
        return False, ""
    if not usable_speech(text):
        return False, ""
    return True, text


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
    usage: UsageContext | None = None,
    model: str | None = None,
) -> Transcript:
    """Transcribe an audio file. Never raises — errors live on Transcript.error."""
    settings = settings or get_settings()
    provider = (settings.stt_provider or "gemini").strip().lower()
    model = (model or "").strip() or _stt_model(settings)

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
    stt_usage = usage or UsageContext(operation="stt")
    if stt_usage.operation == "unknown":
        stt_usage.operation = "stt"
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
                                "Nghe đoạn ghi âm. Có người nói thành lời thì "
                                '{"heard": true, "text": "<nguyên văn tiếng Việt>"}. '
                                "Im lặng hoặc không rõ thì "
                                '{"heard": false, "text": ""}.'
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
            json_mode=True,
            response_schema=_STT_SCHEMA,
            usage=stt_usage,
            audio_bytes=len(data),
        ),
    )

    if result.error and not result.text:
        return Transcript(
            provider=provider,
            model=model,
            latency_ms=result.latency_ms,
            error=result.error,
            heard=False,
        )

    heard, text = parse_stt_payload(result.text)
    if not heard:
        return Transcript(
            text="",
            provider=provider,
            model=model,
            latency_ms=result.latency_ms,
            error=result.error or "no_speech",
            heard=False,
        )
    if not text:
        return Transcript(
            text="",
            provider=provider,
            model=model,
            latency_ms=result.latency_ms,
            error=result.error or "empty_transcript",
            heard=True,
        )

    return Transcript(
        text=text,
        provider=provider,
        model=model,
        latency_ms=result.latency_ms,
        error=None,
        heard=True,
    )
