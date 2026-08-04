from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from ..config import Settings

# Practical range for voice_settings.speed (ElevenLabs REST).
SPEED_MIN = 0.7
SPEED_MAX = 1.2

# Sentence end → next clause. Keep Vietnamese / Latin punctuation.
_SENTENCE_BOUNDARY = re.compile(
    r"(?<=[.!?。！？])"  # end of sentence (not ellipsis — that already slows delivery)
    r"(\s+)"
    r"(?=[\"'“‘(\[]?\S)"
)

_HAS_EXPLICIT_PAUSE_TAG = re.compile(
    r"(?i)<\s*break\b|\[(?:short |long )?pause\]"
)


class ElevenLabsError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def soften_sentence_pacing(text: str, *, model_id: str | None = None) -> str:
    """Insert mild inter-sentence pauses so delivery feels less rushed.

    eleven_v3 uses expressive tags; other models use SSML break tags.
    Skips text that already has explicit pause tags. Caps insertions to avoid
    the instability ElevenLabs warns about with excessive breaks.
    """
    cleaned = text.strip()
    if not cleaned or _HAS_EXPLICIT_PAUSE_TAG.search(cleaned):
        return cleaned

    model = (model_id or "").strip().lower()
    if model == "eleven_v3":
        marker = " [short pause] "
    else:
        marker = ' <break time="0.45s" /> '

    inserts = 0
    max_inserts = 8

    def _replace(match: re.Match[str]) -> str:
        nonlocal inserts
        if inserts >= max_inserts:
            return match.group(0)
        inserts += 1
        return marker

    return _SENTENCE_BOUNDARY.sub(_replace, cleaned)


def resolve_api_key(settings: Settings, space_key: str | None) -> str:
    # Space override if set; otherwise shared server env key.
    key = (space_key or "").strip() or (settings.elevenlabs_api_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Chưa có ElevenLabs API key. Đặt ELEVENLABS_API_KEY trong apps/api/.env "
                "(hoặc nhập key trong Cài đặt không gian)."
            ),
        )
    return key


def create_instant_voice_clone(
    *,
    settings: Settings,
    api_key: str,
    name: str,
    file_paths: list[Path],
    remove_background_noise: bool = True,
    language: str = "vi",
    description: str | None = None,
) -> str:
    if not file_paths:
        raise ElevenLabsError("Cần ít nhất một file audio mẫu.", status_code=400)

    files = []
    handles = []
    try:
        for path in file_paths:
            handle = path.open("rb")
            handles.append(handle)
            files.append(("files", (path.name, handle, "application/octet-stream")))

        data: dict[str, Any] = {
            "name": name,
            "remove_background_noise": "true" if remove_background_noise else "false",
            # Helps multilingual models bias toward Vietnamese phonetics.
            "labels": f'{{"language":"{language}"}}',
        }
        if description:
            data["description"] = description

        with httpx.Client(timeout=120.0) as client:
            res = client.post(
                f"{settings.elevenlabs_api_base.rstrip('/')}/voices/add",
                headers={"xi-api-key": api_key},
                data=data,
                files=files,
            )
    finally:
        for handle in handles:
            handle.close()

    if res.status_code >= 400:
        detail = _error_detail(res)
        raise ElevenLabsError(
            f"ElevenLabs clone thất bại: {detail}",
            status_code=502,
        )

    payload = res.json()
    voice_id = payload.get("voice_id")
    if not voice_id:
        raise ElevenLabsError("ElevenLabs không trả về voice_id.")
    return str(voice_id)


# Models that officially include Vietnamese (plus default override).
VI_TTS_MODELS = (
    "eleven_v3",
    "eleven_turbo_v2_5",
    "eleven_flash_v2_5",
)


def list_voices(
    *,
    settings: Settings,
    api_key: str,
    cloned_only: bool = True,
) -> list[dict[str, Any]]:
    """Fetch voices from the ElevenLabs account (includes past Instant Clones)."""
    url = f"{settings.elevenlabs_api_base.rstrip('/')}/voices"
    with httpx.Client(timeout=45.0) as client:
        res = client.get(
            url,
            headers={"xi-api-key": api_key},
            params={"show_legacy": "true"},
        )
    if res.status_code >= 400:
        detail = _error_detail(res)
        raise ElevenLabsError(
            f"ElevenLabs list voices thất bại: {detail}",
            status_code=502,
        )

    payload = res.json() if res.content else {}
    raw = payload.get("voices") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voice_id") or "").strip()
        if not voice_id:
            continue
        category = str(item.get("category") or "").strip().lower()
        name = str(item.get("name") or voice_id)
        if cloned_only:
            # Drop library premades; keep Instant / PVC / Forever-named customs.
            if category in {"premade", "default"}:
                continue
            if category not in {"cloned", "generated", "professional"}:
                if "forever" not in name.lower():
                    continue

        labels = item.get("labels") if isinstance(item.get("labels"), dict) else {}
        created = item.get("created_at_unix")
        out.append(
            {
                "voice_id": voice_id,
                "name": name,
                "category": category or "cloned",
                "description": str(item.get("description") or "")[:240],
                "labels": labels,
                "created_at_unix": int(created) if isinstance(created, (int, float)) else None,
            }
        )

    def _sort_key(row: dict[str, Any]) -> tuple:
        created = row.get("created_at_unix")
        # Newest first when timestamp exists; Forever names next.
        return (
            -(created or 0),
            0 if str(row.get("name", "")).startswith("Forever") else 1,
            str(row.get("name") or "").lower(),
        )

    out.sort(key=_sort_key)
    return out


def delete_voice(*, settings: Settings, api_key: str, voice_id: str) -> None:
    """Delete a custom / Instant Clone voice from the ElevenLabs account."""
    voice_id = (voice_id or "").strip()
    if not voice_id:
        raise ElevenLabsError("Thiếu voice_id để xóa.", status_code=400)

    url = f"{settings.elevenlabs_api_base.rstrip('/')}/voices/{voice_id}"
    with httpx.Client(timeout=45.0) as client:
        res = client.delete(url, headers={"xi-api-key": api_key})

    if res.status_code == 404:
        raise ElevenLabsError("Không tìm thấy bản clone trên tài khoản.", status_code=404)
    if res.status_code >= 400:
        detail = _error_detail(res)
        raise ElevenLabsError(
            f"Xóa clone thất bại: {detail}",
            status_code=502,
        )


def text_to_speech(
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
    text = text.strip()
    if not text:
        raise ElevenLabsError("Text TTS trống.", status_code=400)
    if len(text) > 2500:
        raise ElevenLabsError("Text TTS tối đa 2500 ký tự.", status_code=400)

    stability = _clamp(
        stability if stability is not None else settings.elevenlabs_stability,
        0.0,
        1.0,
    )
    similarity_boost = _clamp(
        similarity_boost
        if similarity_boost is not None
        else settings.elevenlabs_similarity_boost,
        0.0,
        1.0,
    )
    style = _clamp(
        style if style is not None else settings.elevenlabs_style,
        0.0,
        1.0,
    )
    speed = _clamp(
        speed if speed is not None else settings.elevenlabs_speed,
        SPEED_MIN,
        SPEED_MAX,
    )
    speaker_boost = (
        settings.elevenlabs_speaker_boost
        if use_speaker_boost is None
        else use_speaker_boost
    )
    do_lengthen = (
        settings.elevenlabs_lengthen_pauses
        if lengthen_pauses is None
        else lengthen_pauses
    )

    resolved_model = (model_id or "").strip() or settings.elevenlabs_tts_model
    paced_text = (
        soften_sentence_pacing(text, model_id=resolved_model)
        if do_lengthen
        else text
    )
    # Pause markers can push past the original char budget slightly.
    if len(paced_text) > 2500:
        paced_text = text

    body: dict[str, Any] = {
        "text": paced_text,
        "model_id": resolved_model,
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
            "style": style,
            "speed": speed,
            "use_speaker_boost": speaker_boost,
        },
    }
    lang = (settings.elevenlabs_language_code or "").strip()
    if lang:
        # ISO 639-1; guides pronunciation for models that support language_code (v3, Flash/Turbo v2.5).
        body["language_code"] = lang

    url = f"{settings.elevenlabs_api_base.rstrip('/')}/text-to-speech/{voice_id}"
    with httpx.Client(timeout=60.0) as client:
        res = client.post(
            url,
            headers={
                "xi-api-key": api_key,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
            json=body,
        )

    if res.status_code >= 400:
        detail = _error_detail(res)
        raise ElevenLabsError(f"ElevenLabs TTS thất bại: {detail}", status_code=502)

    return res.content


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _error_detail(res: httpx.Response) -> str:
    try:
        data = res.json()
        if isinstance(data, dict):
            detail = data.get("detail")
            if isinstance(detail, dict) and "message" in detail:
                return str(detail["message"])
            if "message" in data:
                return str(data["message"])
            return str(data)[:300]
    except Exception:
        pass
    return (res.text or f"HTTP {res.status_code}")[:300]
