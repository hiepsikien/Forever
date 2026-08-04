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


def _concat_filter(count: int, rate: int, *, max_ms: int | None) -> str:
    """Per-input resample then concat, so mixed codecs / rates / layouts join cleanly."""
    aformat = f"aformat=sample_fmts=s16:sample_rates={rate}:channel_layouts=mono"
    chains = "".join(f"[{i}:a]{aformat}[a{i}];" for i in range(count))
    inputs = "".join(f"[a{i}]" for i in range(count))
    joined = f"{chains}{inputs}concat=n={count}:v=0:a=1"
    if max_ms is None:
        return f"{joined}[out]"
    return f"{joined}[c];[c]atrim=end={max_ms / 1000:.3f}[out]"


def concat_to_mp3(
    input_paths: list[Path],
    output_path: Path,
    *,
    max_ms: int | None = None,
    bitrate_kbps: int = 256,
) -> tuple[int, int]:
    """Join samples into one MP3 for providers that clone from a single file.

    High bitrate on purpose: the upper formants that carry age and identity are
    the first thing a low bitrate throws away. Returns (duration_ms, size_bytes).
    """
    if not input_paths:
        raise AudioCombineError("Cần ít nhất 1 file audio.")
    for path in input_paths:
        if not path.exists():
            raise AudioCombineError(f"File audio bị thiếu: {path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rate = target_sample_rate(input_paths)

    cmd = [ffmpeg, "-y"]
    for path in input_paths:
        cmd += ["-i", str(path)]
    cmd += [
        "-filter_complex",
        _concat_filter(len(input_paths), rate, max_ms=max_ms),
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        f"{bitrate_kbps}k",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
        raise AudioCombineError(f"ffmpeg encode thất bại: {detail[:500]}")
    if not output_path.exists():
        raise AudioCombineError("Không tạo được file mẫu clone.")

    return probe_duration_ms(output_path) or 0, output_path.stat().st_size


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
    cmd += [
        "-filter_complex",
        _concat_filter(len(input_paths), rate, max_ms=None),
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
