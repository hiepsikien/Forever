from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from .audio_combine import (
    AudioCombineError,
    probe_duration_ms,
    require_ffmpeg,
    target_sample_rate,
)

LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"

_MEASURED_KEYS = (
    "input_i",
    "input_tp",
    "input_lra",
    "input_thresh",
    "target_offset",
)


def _measure_loudness(ffmpeg: str, input_path: Path) -> dict[str, str] | None:
    """Run loudnorm analysis only, so pass 2 can apply a single linear gain."""
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-i",
        str(input_path),
        "-af",
        f"{LOUDNORM_FILTER}:print_format=json",
        "-f",
        "null",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return None
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr, re.DOTALL)
    if not match:
        return None
    try:
        stats = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    measured = {key: str(stats[key]) for key in _MEASURED_KEYS if key in stats}
    return measured if len(measured) == len(_MEASURED_KEYS) else None


def normalize_audio_file(input_path: Path, output_path: Path) -> tuple[int, int]:
    """Normalize loudness to ~-16 LUFS mono WAV, keeping the source sample rate.

    Two-pass loudnorm applies one linear gain instead of riding the level, so the
    dynamics that carry voice identity survive. Returns (duration_ms, bytes).
    """
    if not input_path.exists():
        raise AudioCombineError(f"File audio bị thiếu: {input_path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rate = target_sample_rate([input_path])

    def _encode(audio_filter: str) -> subprocess.CompletedProcess[str]:
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
        ]
        if audio_filter:
            cmd += ["-af", audio_filter]
        cmd += [
            "-ar",
            str(rate),
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ]
        return subprocess.run(cmd, capture_output=True, text=True)

    measured = _measure_loudness(ffmpeg, input_path)
    if measured:
        proc = _encode(
            f"{LOUDNORM_FILTER}"
            f":measured_I={measured['input_i']}"
            f":measured_TP={measured['input_tp']}"
            f":measured_LRA={measured['input_lra']}"
            f":measured_thresh={measured['input_thresh']}"
            f":offset={measured['target_offset']}"
            ":linear=true"
        )
    else:
        proc = _encode(LOUDNORM_FILTER)

    if proc.returncode != 0:
        # Short or near-silent clips can defeat loudnorm — keep the audio,
        # only convert the container/layout.
        proc = _encode("")
        if proc.returncode != 0:
            detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
            raise AudioCombineError(f"ffmpeg normalize thất bại: {detail[:500]}")

    if not output_path.exists():
        raise AudioCombineError("Không tạo được file đã normalize.")

    file_size = output_path.stat().st_size
    duration_ms = probe_duration_ms(output_path) or 0
    return duration_ms, file_size


def normalize_audio_file_inplace(path: Path) -> tuple[int, int]:
    """Rewrite file with normalized audio."""
    tmp = path.with_name(f"{path.stem}.norm{path.suffix}")
    try:
        duration_ms, file_size = normalize_audio_file(path, tmp)
        tmp.replace(path)
        return duration_ms, file_size
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
