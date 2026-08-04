from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

# Below this, the clip has lost the upper formants that carry voice identity.
NARROW_BAND_SAMPLE_RATE = 32000

_SAMPLE_FMT_BITS = {
    "u8": 8,
    "u8p": 8,
    "s16": 16,
    "s16p": 16,
    "s32": 32,
    "s32p": 32,
    "flt": 32,
    "fltp": 32,
    "dbl": 64,
    "dblp": 64,
}


def _int_or_none(value: Any) -> int | None:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def probe_audio_info(path: Path, *, media_mime: str | None = None) -> dict[str, Any]:
    """Read the technical shape of an audio file. Missing fields come back None.

    Never raises for unreadable media — the caller shows what it can, since this
    only powers an informational panel.
    """
    info: dict[str, Any] = {
        "file_name": path.name,
        "media_mime": media_mime,
        "size_bytes": path.stat().st_size if path.exists() else None,
        "container": None,
        "codec": None,
        "sample_rate": None,
        "channels": None,
        "channel_layout": None,
        "bit_depth": None,
        "bitrate_bps": None,
        "duration_ms": None,
        "narrow_band": None,
    }

    ffprobe = shutil.which("ffprobe")
    if not ffprobe or not path.exists():
        return info

    proc = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,channel_layout,sample_fmt,"
            "bits_per_raw_sample,bit_rate:format=format_name,duration,bit_rate",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return info

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return info

    fmt = payload.get("format") or {}
    streams = payload.get("streams") or []
    stream = streams[0] if streams else {}

    info["container"] = (fmt.get("format_name") or "").split(",")[0] or None
    info["codec"] = stream.get("codec_name") or None
    info["sample_rate"] = _int_or_none(stream.get("sample_rate"))
    info["channels"] = _int_or_none(stream.get("channels"))
    info["channel_layout"] = stream.get("channel_layout") or None

    bit_depth = _int_or_none(stream.get("bits_per_raw_sample"))
    if bit_depth is None:
        bit_depth = _SAMPLE_FMT_BITS.get(stream.get("sample_fmt") or "")
    info["bit_depth"] = bit_depth

    info["bitrate_bps"] = _int_or_none(stream.get("bit_rate")) or _int_or_none(
        fmt.get("bit_rate")
    )

    duration = fmt.get("duration") or stream.get("duration")
    try:
        info["duration_ms"] = int(round(float(duration) * 1000))
    except (TypeError, ValueError):
        info["duration_ms"] = None

    if info["sample_rate"]:
        info["narrow_band"] = info["sample_rate"] < NARROW_BAND_SAMPLE_RATE

    return info
