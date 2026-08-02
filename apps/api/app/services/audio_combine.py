from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


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


def combine_audio_files(input_paths: list[Path], output_path: Path) -> tuple[int, int]:
    """Concatenate audio files in order. Returns (duration_ms, file_size_bytes)."""
    if len(input_paths) < 2:
        raise AudioCombineError("Cần ít nhất 2 file audio.")
    for path in input_paths:
        if not path.exists():
            raise AudioCombineError(f"File audio bị thiếu: {path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    list_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as handle:
            list_path = Path(handle.name)
            for path in input_paths:
                escaped = str(path.resolve()).replace("'", "'\\''")
                handle.write(f"file '{escaped}'\n")

        cmd = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-ac",
            "1",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
            raise AudioCombineError(f"ffmpeg ghép thất bại: {detail[:500]}")
    finally:
        if list_path is not None:
            list_path.unlink(missing_ok=True)

    if not output_path.exists():
        raise AudioCombineError("Không tạo được file ghép.")

    file_size = output_path.stat().st_size
    duration_ms = probe_duration_ms(output_path)
    if duration_ms is None:
        duration_ms = 0
    return duration_ms, file_size
