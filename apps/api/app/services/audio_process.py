from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .audio_combine import AudioCombineError, probe_duration_ms, require_ffmpeg

LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"


def normalize_audio_file(input_path: Path, output_path: Path) -> tuple[int, int]:
    """Normalize loudness to ~−16 LUFS mono WAV 44.1kHz. Returns (duration_ms, bytes)."""
    if not input_path.exists():
        raise AudioCombineError(f"File audio bị thiếu: {input_path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(input_path),
        "-af",
        LOUDNORM_FILTER,
        "-ar",
        "44100",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        # Short clips may fail loudnorm — fall back to format-only mono WAV.
        fallback = [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
            "-ar",
            "44100",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ]
        proc = subprocess.run(fallback, capture_output=True, text=True)
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
