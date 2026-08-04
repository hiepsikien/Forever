from __future__ import annotations

import binascii
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import httpx
from fastapi import HTTPException

from ..config import Settings
from .audio_combine import AudioCombineError, concat_to_mp3

# Clone source rules from the MiniMax docs: mp3/m4a/wav, 10s–5min, ≤20 MB.
CLONE_MIN_MS = 10_000
CLONE_MAX_MS = 300_000
CLONE_MAX_BYTES = 20 * 1024 * 1024
CLONE_SOURCE_BITRATE_KBPS = 256

# The best shape /v1/t2a_v2 offers; 44.1 kHz is its ceiling.
OUTPUT_SAMPLE_RATE = 44_100
OUTPUT_BITRATE = 256_000

SPEED_MIN = 0.5
SPEED_MAX = 2.0

# Vietnamese-capable synthesis models. HD first — the docs recommend it for
# cloning similarity, which is the whole point for heritage voices.
VI_TTS_MODELS = (
    "speech-2.8-hd",
    "speech-2.8-turbo",
    "speech-2.6-hd",
    "speech-2.6-turbo",
    "speech-02-hd",
)

LANGUAGE_BOOST = "Vietnamese"

# A cloned voice is deleted after 7 days unless it is synthesized with at least
# once, and it cannot even be listed before that, so every clone is locked in
# right away with one short line.
LOCK_TEXT = "Xin chào, đây là giọng của gia đình mình."

MAX_TTS_CHARS = 2500

# Fail fast when the host is unreachable instead of hanging on the full budget.
CONNECT_TIMEOUT = 10.0
CONNECT_ATTEMPTS = 3
# Only connect-phase failures are retried: the request never reached MiniMax, so
# nothing was synthesized or billed. A read timeout may already have been charged.
_RETRYABLE = (httpx.ConnectTimeout, httpx.ConnectError)

_VOICE_ID_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")

# Sentence end → next clause. Keep Vietnamese / Latin punctuation.
_SENTENCE_BOUNDARY = re.compile(
    r"(?<=[.!?。！？])"  # end of sentence (not ellipsis — that already slows delivery)
    r"(\s+)"
    r"(?=[\"'“‘(\[]?\S)"
)

# MiniMax pause markers, and the tags we insert ourselves.
_HAS_EXPLICIT_PAUSE_TAG = re.compile(r"<#\s*\d")

# Documented status codes worth translating; anything else is surfaced verbatim
# so a real cause (billing, safety) is never hidden behind a generic message.
_STATUS_HINTS = {
    1001: "MiniMax xử lý quá lâu (timeout) — thử lại.",
    1002: "MiniMax đang giới hạn tần suất — chờ một chút rồi thử lại.",
    1004: "MiniMax từ chối API key. Kiểm tra MINIMAX_API_KEY trong apps/api/.env.",
    1008: (
        "Số dư MiniMax không đủ. Nạp tiền pay-as-you-go trên platform.minimax.io — "
        "credit gói Token Plan không dùng được cho TTS và clone giọng."
    ),
    1013: "MiniMax gặp lỗi nội bộ — thử lại sau.",
    2013: "MiniMax báo dữ liệu gửi lên không hợp lệ.",
    2038: (
        "Tài khoản MiniMax chưa có quyền clone giọng. Hoàn tất xác minh tài khoản "
        "trên platform.minimax.io rồi thử lại."
    ),
}


class MinimaxError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def resolve_api_key(settings: Settings, space_key: str | None = None) -> str:
    key = (space_key or "").strip() or (settings.minimax_api_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Chưa có MiniMax API key. Đặt MINIMAX_API_KEY trong apps/api/.env "
                "(key pay-as-you-go từ platform.minimax.io)."
            ),
        )
    return key


def soften_sentence_pacing(text: str, *, pause_seconds: float = 0.4) -> str:
    """Insert mild inter-sentence pauses using MiniMax `<#x#>` markers."""
    cleaned = text.strip()
    if not cleaned or _HAS_EXPLICIT_PAUSE_TAG.search(cleaned):
        return cleaned

    marker = f" <#{pause_seconds:.2f}#> "
    inserts = 0
    max_inserts = 8

    def _replace(match: re.Match[str]) -> str:
        nonlocal inserts
        if inserts >= max_inserts:
            return match.group(0)
        inserts += 1
        return marker

    return _SENTENCE_BOUNDARY.sub(_replace, cleaned)


def build_voice_id(seed: str) -> str:
    """Make a voice_id MiniMax accepts, traceable back to the Voice DNA row.

    Rules: 8–256 chars, starts with a letter, only letters/digits/`-`/`_`, and
    must not end with `-` or `_`.
    """
    core = _VOICE_ID_UNSAFE.sub("", seed).strip("-_")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    voice_id = f"fv{core}-{stamp}" if core else f"fv-{stamp}"
    return voice_id[:256]


def build_clone_source(file_paths: list[Path], output_path: Path) -> tuple[int, int]:
    """Fold the chosen samples into the single high-bitrate MP3 MiniMax expects."""
    if not file_paths:
        raise MinimaxError("Cần ít nhất một file audio mẫu.", status_code=400)
    try:
        duration_ms, size_bytes = concat_to_mp3(
            file_paths,
            output_path,
            max_ms=CLONE_MAX_MS,
            bitrate_kbps=CLONE_SOURCE_BITRATE_KBPS,
        )
    except AudioCombineError as exc:
        raise MinimaxError(exc.message, status_code=400) from exc

    if duration_ms and duration_ms < CLONE_MIN_MS:
        raise MinimaxError(
            "MiniMax cần mẫu dài ít nhất 10 giây. Chọn thêm mẫu hoặc mẫu dài hơn.",
            status_code=400,
        )
    if size_bytes > CLONE_MAX_BYTES:
        raise MinimaxError(
            "Mẫu gộp vượt 20 MB sau khi nén. Bỏ bớt mẫu rồi thử lại.",
            status_code=400,
        )
    return duration_ms, size_bytes


def create_instant_voice_clone(
    *,
    settings: Settings,
    api_key: str,
    file_paths: list[Path],
    voice_id_seed: str,
    remove_background_noise: bool = False,
    lock_voice: bool = True,
) -> str:
    """Upload one merged sample, clone it, and lock the voice in.

    `remove_background_noise` stays off by default: Forever already cleans and
    normalizes samples, so a second pass only costs fidelity.
    """
    voice_id = build_voice_id(voice_id_seed)

    with TemporaryDirectory(prefix="minimax-clone-") as tmp:
        source = Path(tmp) / "clone-source.mp3"
        build_clone_source(file_paths, source)
        file_id = upload_file(
            settings=settings,
            api_key=api_key,
            path=source,
            purpose="voice_clone",
        )

    payload: dict[str, Any] = {
        "file_id": file_id,
        "voice_id": voice_id,
        "need_noise_reduction": bool(remove_background_noise),
        "need_volume_normalization": False,
        "language_boost": LANGUAGE_BOOST,
    }
    _post_json(
        settings=settings,
        api_key=api_key,
        path="/voice_clone",
        payload=payload,
        timeout=180.0,
        action="clone",
    )

    if lock_voice:
        # Charges the clone fee now rather than losing the voice in 7 days.
        text_to_speech(
            settings=settings,
            api_key=api_key,
            voice_id=voice_id,
            text=LOCK_TEXT,
            lengthen_pauses=False,
        )
    return voice_id


def upload_file(
    *,
    settings: Settings,
    api_key: str,
    path: Path,
    purpose: str = "voice_clone",
) -> int:
    """Upload audio and return its file_id."""
    url = f"{_base(settings)}/files/upload"

    def _send() -> httpx.Response:
        # Reopened per attempt: a retry cannot reuse a consumed file handle.
        with path.open("rb") as handle:
            with httpx.Client(timeout=_timeout(180.0)) as client:
                return client.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    data={"purpose": purpose},
                    files={"file": (path.name, handle, "audio/mpeg")},
                )

    res = _with_retry(_send, action="upload mẫu")
    payload = _payload_or_raise(res, action="upload mẫu")
    file_id = (payload.get("file") or {}).get("file_id")
    if not file_id:
        raise MinimaxError("MiniMax không trả về file_id sau khi upload mẫu.")
    return int(file_id)


def text_to_speech(
    *,
    settings: Settings,
    api_key: str,
    voice_id: str,
    text: str,
    model_id: str | None = None,
    speed: float | None = None,
    lengthen_pauses: bool | None = None,
) -> bytes:
    text = text.strip()
    if not text:
        raise MinimaxError("Text TTS trống.", status_code=400)
    if len(text) > MAX_TTS_CHARS:
        raise MinimaxError(f"Text TTS tối đa {MAX_TTS_CHARS} ký tự.", status_code=400)

    resolved_model = (model_id or "").strip() or settings.minimax_tts_model
    resolved_speed = _clamp(
        speed if speed is not None else settings.minimax_speed,
        SPEED_MIN,
        SPEED_MAX,
    )
    do_lengthen = (
        settings.minimax_lengthen_pauses if lengthen_pauses is None else lengthen_pauses
    )
    paced_text = soften_sentence_pacing(text) if do_lengthen else text
    if len(paced_text) > MAX_TTS_CHARS:
        paced_text = text

    payload: dict[str, Any] = {
        "model": resolved_model,
        "text": paced_text,
        "stream": False,
        "output_format": "hex",
        "language_boost": LANGUAGE_BOOST,
        "voice_setting": {"voice_id": voice_id, "speed": resolved_speed},
        "audio_setting": {
            "sample_rate": OUTPUT_SAMPLE_RATE,
            "bitrate": OUTPUT_BITRATE,
            "format": "mp3",
            "channel": 1,
        },
    }
    body = _post_json(
        settings=settings,
        api_key=api_key,
        path="/t2a_v2",
        payload=payload,
        timeout=180.0,
        action="TTS",
    )

    audio_hex = ((body.get("data") or {}).get("audio") or "").strip()
    if not audio_hex:
        raise MinimaxError("MiniMax không trả về audio.")
    try:
        return bytes.fromhex(audio_hex)
    except (ValueError, binascii.Error) as exc:
        raise MinimaxError("Audio MiniMax trả về không đọc được.") from exc


def list_voices(
    *,
    settings: Settings,
    api_key: str,
    cloned_only: bool = True,
) -> list[dict[str, Any]]:
    """List cloned voices on the account, newest first.

    MiniMax only lists a cloned voice after it has been synthesized with once.
    """
    body = _post_json(
        settings=settings,
        api_key=api_key,
        path="/get_voice",
        payload={"voice_type": "voice_cloning" if cloned_only else "all"},
        timeout=60.0,
        action="list voices",
    )

    out: list[dict[str, Any]] = []
    for item in body.get("voice_cloning") or []:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voice_id") or "").strip()
        if not voice_id:
            continue
        created = str(item.get("created_time") or "").strip()
        description = item.get("description")
        out.append(
            {
                "voice_id": voice_id,
                # MiniMax stores no display name for clones — Forever supplies it.
                "name": voice_id,
                "category": "cloned",
                "description": " ".join(description)[:240]
                if isinstance(description, list)
                else "",
                "labels": {},
                "created_at_unix": _date_to_unix(created),
            }
        )

    out.sort(key=lambda row: (-(row.get("created_at_unix") or 0), row["voice_id"]))
    return out


def delete_voice(*, settings: Settings, api_key: str, voice_id: str) -> None:
    voice_id = (voice_id or "").strip()
    if not voice_id:
        raise MinimaxError("Thiếu voice_id để xóa.", status_code=400)
    _post_json(
        settings=settings,
        api_key=api_key,
        path="/delete_voice",
        payload={"voice_type": "voice_cloning", "voice_id": voice_id},
        timeout=60.0,
        action="xóa clone",
    )


def _base(settings: Settings) -> str:
    return settings.minimax_api_base.rstrip("/")


def _post_json(
    *,
    settings: Settings,
    api_key: str,
    path: str,
    payload: dict[str, Any],
    timeout: float,
    action: str,
) -> dict[str, Any]:
    def _send() -> httpx.Response:
        with httpx.Client(timeout=_timeout(timeout)) as client:
            return client.post(
                f"{_base(settings)}{path}",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

    res = _with_retry(_send, action=action)
    return _payload_or_raise(res, action=action)


def _timeout(read: float) -> httpx.Timeout:
    return httpx.Timeout(read, connect=CONNECT_TIMEOUT)


def _with_retry(
    send: Callable[[], httpx.Response],
    *,
    action: str,
) -> httpx.Response:
    """Retry only when the connection never landed, so nothing is billed twice."""
    last: Exception | None = None
    for attempt in range(CONNECT_ATTEMPTS):
        try:
            return send()
        except _RETRYABLE as exc:
            last = exc
            if attempt + 1 < CONNECT_ATTEMPTS:
                time.sleep(0.8 * (attempt + 1))
        except httpx.TimeoutException as exc:
            raise MinimaxError(
                f"MiniMax {action}: quá thời gian chờ phản hồi. "
                "Kiểm tra lại trước khi thử lần nữa — lần này có thể đã bị tính phí.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise MinimaxError(
                f"MiniMax {action}: lỗi kết nối ({type(exc).__name__}).",
                status_code=502,
            ) from exc

    raise MinimaxError(
        f"Không kết nối được tới MiniMax ({action}) sau {CONNECT_ATTEMPTS} lần thử. "
        "Kiểm tra mạng rồi thử lại — chưa có gì bị tính phí.",
        status_code=503,
    ) from last


def _payload_or_raise(res: httpx.Response, *, action: str) -> dict[str, Any]:
    """MiniMax answers 200 with the real outcome inside base_resp."""
    if res.status_code >= 400:
        raise MinimaxError(f"MiniMax {action} thất bại: {_http_detail(res)}")

    try:
        body = res.json()
    except ValueError as exc:
        raise MinimaxError(f"MiniMax {action}: phản hồi không phải JSON.") from exc
    if not isinstance(body, dict):
        raise MinimaxError(f"MiniMax {action}: phản hồi không hợp lệ.")

    base = body.get("base_resp") or {}
    code = base.get("status_code")
    if code in (None, 0):
        return body

    hint = _STATUS_HINTS.get(int(code))
    detail = str(base.get("status_msg") or "").strip()
    message = hint or f"MiniMax {action} thất bại (mã {code}): {detail or 'không rõ'}"
    raise MinimaxError(message, status_code=400 if int(code) == 2038 else 502)


def _http_detail(res: httpx.Response) -> str:
    try:
        data = res.json()
        if isinstance(data, dict):
            base = data.get("base_resp")
            if isinstance(base, dict) and base.get("status_msg"):
                return str(base["status_msg"])[:300]
            return str(data)[:300]
    except ValueError:
        pass
    return (res.text or f"HTTP {res.status_code}")[:300]


def _date_to_unix(value: str) -> int | None:
    """`created_time` comes back as yyyy-mm-dd; some rows send a unix string."""
    if not value:
        return None
    if value.isdigit():
        return int(value)
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return int(parsed.timestamp())


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))
