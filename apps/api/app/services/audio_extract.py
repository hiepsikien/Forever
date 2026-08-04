from __future__ import annotations

import subprocess
from pathlib import Path

from .audio_combine import AudioCombineError, probe_duration_ms, require_ffmpeg


def extract_audio_from_video(input_path: Path, output_path: Path) -> tuple[int, int]:
    """Extract mono AAC audio from a video file. Returns (duration_ms, file_size_bytes)."""
    if not input_path.exists():
        raise AudioCombineError(f"File video bị thiếu: {input_path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not output_path.exists():
        detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
        raise AudioCombineError(f"ffmpeg tách tiếng thất bại: {detail[:500]}")

    file_size = output_path.stat().st_size
    if file_size <= 0:
        raise AudioCombineError("Video không có track âm thanh (hoặc track trống).")

    duration_ms = probe_duration_ms(output_path) or 0
    return duration_ms, file_size
