from __future__ import annotations

import subprocess
from pathlib import Path

from .audio_combine import AudioCombineError, probe_duration_ms, require_ffmpeg


def split_audio_file(
    input_path: Path,
    output_a: Path,
    output_b: Path,
    *,
    at_ms: int | None = None,
) -> tuple[tuple[int, int], tuple[int, int]]:
    """Split audio into two mono WAV parts. Returns ((dur_a, size_a), (dur_b, size_b))."""
    if not input_path.exists():
        raise AudioCombineError(f"File audio bị thiếu: {input_path.name}")

    total_ms = probe_duration_ms(input_path)
    if total_ms is None or total_ms <= 0:
        raise AudioCombineError("Không đọc được thời lượng file để chia.")

    cut_ms = at_ms if at_ms is not None else total_ms // 2
    if cut_ms < 1_000 or cut_ms >= total_ms - 1_000:
        raise AudioCombineError(
            "Điểm chia không hợp lệ — mỗi nửa cần ít nhất ~1 giây."
        )

    ffmpeg = require_ffmpeg()
    output_a.parent.mkdir(parents=True, exist_ok=True)
    output_b.parent.mkdir(parents=True, exist_ok=True)

    cut_sec = cut_ms / 1000.0
    total_sec = total_ms / 1000.0

    def _encode(cmd: list[str], label: str) -> None:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
            raise AudioCombineError(f"ffmpeg chia {label} thất bại: {detail[:500]}")

    _encode(
        [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
            "-t",
            f"{cut_sec:.3f}",
            "-ac",
            "1",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            str(output_a),
        ],
        "nửa 1",
    )
    _encode(
        [
            ffmpeg,
            "-y",
            "-ss",
            f"{cut_sec:.3f}",
            "-i",
            str(input_path),
            "-t",
            f"{max(total_sec - cut_sec, 0.001):.3f}",
            "-ac",
            "1",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            str(output_b),
        ],
        "nửa 2",
    )

    if not output_a.exists() or not output_b.exists():
        raise AudioCombineError("Không tạo được file sau khi chia.")

    size_a = output_a.stat().st_size
    size_b = output_b.stat().st_size
    dur_a = probe_duration_ms(output_a) or cut_ms
    dur_b = probe_duration_ms(output_b) or max(total_ms - cut_ms, 0)
    return (dur_a, size_a), (dur_b, size_b)
