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


LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"
# Pause length stays conversational; softness comes from curved fades + room-tone bed.
DEFAULT_SMART_GAP_MS = 220
DEFAULT_SMART_FADE_MS = 90
# Soft pink bed during the gap (~−45 dBFS) — avoids digital-zero “hard cut to void”.
DEFAULT_SMART_GAP_NOISE_DB = -45.0


def _concat_demuxer(ffmpeg: str, list_path: Path, output_path: Path) -> None:
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


def _write_concat_list(paths: list[Path], list_path: Path) -> None:
    with list_path.open("w", encoding="utf-8") as handle:
        for path in paths:
            escaped = str(path.resolve()).replace("'", "'\\''")
            handle.write(f"file '{escaped}'\n")


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
        _write_concat_list(input_paths, list_path)
        _concat_demuxer(ffmpeg, list_path, output_path)
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


def _prepare_smart_clip(
    ffmpeg: str,
    input_path: Path,
    output_path: Path,
    *,
    fade_ms: int,
) -> int:
    """Mono WAV + loudness + curved edge fades. Returns duration_ms."""
    fade_s = max(fade_ms, 0) / 1000.0
    duration_ms = probe_duration_ms(input_path) or 0
    duration_s = duration_ms / 1000.0

    # Gentle high-pass reduces rumble jumps between phone / room sources.
    base_filters = ["highpass=f=70"]
    fade_filters: list[str] = []
    if fade_s > 0 and duration_s > fade_s * 2.5:
        fade_out_start = max(duration_s - fade_s, 0.0)
        # hsin ≈ natural breath-edge; linear afade feels clicky / abrupt.
        fade_filters = [
            f"afade=t=in:st=0:d={fade_s:.3f}:curve=hsin",
            f"afade=t=out:st={fade_out_start:.3f}:d={fade_s:.3f}:curve=hsin",
        ]

    attempts: list[list[str]] = [
        [LOUDNORM_FILTER, *base_filters, *fade_filters],
        [*base_filters, *fade_filters],
        list(fade_filters),
        [],
    ]
    last_detail = "unknown error"
    for filters in attempts:
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
        ]
        if filters:
            cmd.extend(["-af", ",".join(filters)])
        cmd.extend(
            [
                "-ar",
                "44100",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(output_path),
            ]
        )
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0 and output_path.exists():
            return probe_duration_ms(output_path) or duration_ms
        last_detail = proc.stderr.strip() or proc.stdout.strip() or last_detail
        output_path.unlink(missing_ok=True)

    raise AudioCombineError(f"ffmpeg chuẩn bị clip thất bại: {last_detail[:500]}")


def _make_soft_gap_wav(
    ffmpeg: str,
    output_path: Path,
    duration_ms: int,
    *,
    noise_db: float = DEFAULT_SMART_GAP_NOISE_DB,
    fade_ms: int = 50,
) -> None:
    """Quiet pink-noise bed with soft edges — not digital silence."""
    seconds = max(duration_ms, 1) / 1000.0
    fade_s = min(max(fade_ms, 0) / 1000.0, seconds / 2.5)
    fade_out_start = max(seconds - fade_s, 0.0)
    # Generate pink noise then duck to target dB so joins keep a faint floor.
    af = (
        f"volume={noise_db:.1f}dB,"
        f"afade=t=in:st=0:d={fade_s:.3f}:curve=hsin,"
        f"afade=t=out:st={fade_out_start:.3f}:d={fade_s:.3f}:curve=hsin"
    )
    cmd = [
        ffmpeg,
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=color=pink:amplitude=1:sample_rate=44100",
        "-t",
        f"{seconds:.3f}",
        "-af",
        af,
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not output_path.exists():
        detail = proc.stderr.strip() or proc.stdout.strip() or "unknown error"
        raise AudioCombineError(f"ffmpeg tạo khoảng nghỉ thất bại: {detail[:500]}")


def smart_combine_audio_files(
    input_paths: list[Path],
    output_path: Path,
    *,
    gap_ms: int = DEFAULT_SMART_GAP_MS,
    fade_ms: int = DEFAULT_SMART_FADE_MS,
    gap_noise_db: float = DEFAULT_SMART_GAP_NOISE_DB,
) -> tuple[int, int]:
    """Combine clips with loudness match, curved fades, and soft room-tone gaps.

    Softens hard joins that make extract harvests sound choppy for IVC.
    Returns (duration_ms, file_size_bytes).
    """
    if len(input_paths) < 2:
        raise AudioCombineError("Cần ít nhất 2 file audio.")
    for path in input_paths:
        if not path.exists():
            raise AudioCombineError(f"File audio bị thiếu: {path.name}")

    ffmpeg = require_ffmpeg()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="forever-smart-combine-") as tmp:
        tmp_dir = Path(tmp)
        prepared: list[Path] = []
        for idx, path in enumerate(input_paths):
            out = tmp_dir / f"clip_{idx:03d}.wav"
            _prepare_smart_clip(ffmpeg, path, out, fade_ms=fade_ms)
            prepared.append(out)

        gap_path: Path | None = None
        if gap_ms > 0:
            gap_path = tmp_dir / "gap.wav"
            _make_soft_gap_wav(
                ffmpeg,
                gap_path,
                gap_ms,
                noise_db=gap_noise_db,
                fade_ms=min(50, max(fade_ms // 2, 30)),
            )

        sequence: list[Path] = []
        for idx, clip in enumerate(prepared):
            sequence.append(clip)
            if gap_path is not None and idx < len(prepared) - 1:
                sequence.append(gap_path)

        list_path = tmp_dir / "concat.txt"
        _write_concat_list(sequence, list_path)
        _concat_demuxer(ffmpeg, list_path, output_path)

    if not output_path.exists():
        raise AudioCombineError("Không tạo được file ghép êm.")

    file_size = output_path.stat().st_size
    duration_ms = probe_duration_ms(output_path) or 0
    return duration_ms, file_size
