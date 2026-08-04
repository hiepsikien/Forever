from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


# pyannote resamples to 16 kHz internally, so diarization gains nothing above it.
DIARIZE_SAMPLE_RATE = 16000
# Clone clips keep the source bandwidth; 48 kHz is where extra rate stops helping.
MAX_CLIP_SAMPLE_RATE = 48000


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
        "-vn",
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


def probe_sample_rate(path: Path) -> int | None:
    """Return the first audio stream's sample rate via ffprobe, else None."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return None
    try:
        rate = int(proc.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return None
    return rate if rate > 0 else None


def resolve_clip_sample_rate(input_path: Path) -> int:
    """Pick the clip rate that keeps source bandwidth without upsampling."""
    native = probe_sample_rate(input_path)
    if native is None:
        # Unknown source: assume CD rate rather than silently band-limiting.
        return 44100
    return max(DIARIZE_SAMPLE_RATE, min(native, MAX_CLIP_SAMPLE_RATE))


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
