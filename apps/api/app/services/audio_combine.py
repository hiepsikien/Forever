from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


# Voice cloning wants 44.1/48 kHz; above that adds size without adding detail.
MAX_SAMPLE_RATE = 48000
FALLBACK_SAMPLE_RATE = 44100
MIN_SAMPLE_RATE = 8000


class AudioCombineError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise AudioCombineError(
            "ffmpeg chưa cài. Cài trước (vd. `brew install ffmpeg` trên macOS)."
        )
    return path


def probe_duration_ms(path: Path) -> int | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return None
    try:
        return int(round(float(proc.stdout.strip()) * 1000))
    except ValueError:
        return None


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


def target_sample_rate(input_paths: list[Path]) -> int:
    """Highest input rate, capped — never upsample just to hit a round number."""
    rates = [rate for rate in (probe_sample_rate(p) for p in input_paths) if rate]
    if not rates:
        return FALLBACK_SAMPLE_RATE
    return max(MIN_SAMPLE_RATE, min(max(rates), MAX_SAMPLE_RATE))


def combine_audio_files(input_paths: list[Path], output_path: Path) -> tuple[int, int]:
    """Concatenate audio files in order. Returns (duration_ms, file_size_bytes)."""
    if len(input_paths) < 2:
        raise AudioCombineError("Cần ít nhất 2 file audio.")
    for path in input_paths:
        if not path.exists():
            raise AudioCombineError(f"File audio bị thiếu: {path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rate = target_sample_rate(input_paths)

    # The concat filter (not the concat demuxer) so mixed codecs / rates / layouts
    # are resampled per input instead of relying on identical stream params.
    cmd = [ffmpeg, "-y"]
    for path in input_paths:
        cmd += ["-i", str(path)]

    aformat = f"aformat=sample_fmts=s16:sample_rates={rate}:channel_layouts=mono"
    chains = "".join(f"[{i}:a]{aformat}[a{i}];" for i in range(len(input_paths)))
    inputs = "".join(f"[a{i}]" for i in range(len(input_paths)))
    filter_complex = f"{chains}{inputs}concat=n={len(input_paths)}:v=0:a=1[out]"

    cmd += [
        "-filter_complex",
        filter_complex,
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
        raise AudioCombineError(f"ffmpeg ghép thất bại: {detail[:500]}")

    if not output_path.exists():
        raise AudioCombineError("Không tạo được file ghép.")

    file_size = output_path.stat().st_size
    duration_ms = probe_duration_ms(output_path)
    if duration_ms is None:
        duration_ms = 0
    return duration_ms, file_size
