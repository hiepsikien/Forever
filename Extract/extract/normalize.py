from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError(
            "ffmpeg not found. Install it first (e.g. `brew install ffmpeg` on macOS)."
        )
    return path


def normalize_audio(input_path: Path, output_wav: Path, sample_rate: int = 16000) -> Path:
    """Convert any ffmpeg-readable audio to 16-bit PCM mono WAV."""
    ffmpeg = require_ffmpeg()
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(output_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed normalizing {input_path}:\n{proc.stderr.strip()}"
        )
    return output_wav


def probe_duration_seconds(wav_path: Path) -> float:
    """Return media duration via ffprobe when available, else 0."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(wav_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 0.0
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0
