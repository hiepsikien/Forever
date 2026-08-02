from __future__ import annotations

import subprocess
from pathlib import Path

from extract.normalize import require_ffmpeg
from extract.refine import (
    DEFAULT_EDGE_TRIM,
    DEFAULT_MAX_GAP,
    DEFAULT_MIN_DURATION,
    DEFAULT_PAD,
    DEFAULT_PURITY_MIN,
    refine_segments,
)
from extract.types import Segment


def merge_segments(
    segments: list[Segment],
    *,
    max_gap: float = 0.75,
    min_duration: float = 0.4,
) -> list[Segment]:
    """Legacy helper: merge nearby same-speaker turns and drop tiny fragments."""
    from extract.refine import merge_same_speaker

    if not segments:
        return []
    merged = merge_same_speaker(segments, max_gap=max_gap)
    return [s for s in merged if s.duration >= min_duration]


def apply_padding(
    segments: list[Segment],
    *,
    pad: float = 0.2,
    total_duration: float | None = None,
) -> list[Segment]:
    from extract.refine import apply_padding as _pad

    return _pad(segments, pad=pad, total_duration=total_duration)


def cut_segments(
    source_wav: Path,
    segments: list[Segment],
    out_dir: Path,
    *,
    pad: float = DEFAULT_PAD,
    max_gap: float = DEFAULT_MAX_GAP,
    min_duration: float = DEFAULT_MIN_DURATION,
    edge_trim: float = DEFAULT_EDGE_TRIM,
    purity_min: float = DEFAULT_PURITY_MIN,
    exclusive_only: bool = True,
    keep_mixed: bool = False,
    total_duration: float | None = None,
    prepared: list[Segment] | None = None,
) -> list[Segment]:
    """Cut wav clips into speakers/SPEAKER_xx/NNNN.wav and return updated segments."""
    ffmpeg = require_ffmpeg()
    ready = prepared or refine_segments(
        segments,
        exclusive_only=exclusive_only,
        edge_trim=edge_trim,
        max_gap=max_gap,
        pad=pad,
        min_duration=min_duration,
        purity_min=purity_min,
        total_duration=total_duration,
        keep_mixed=keep_mixed,
    )

    counters: dict[str, int] = {}
    written: list[Segment] = []

    for seg in ready:
        counters[seg.speaker] = counters.get(seg.speaker, 0) + 1
        idx = counters[seg.speaker]
        quality = seg.quality or "clean"
        # Keep clean clips in the main speaker folder; others under _review/.
        if quality == "clean":
            speaker_dir = out_dir / "speakers" / seg.speaker
            rel = Path("speakers") / seg.speaker / f"{idx:04d}.wav"
        else:
            speaker_dir = out_dir / "speakers" / "_review" / seg.speaker
            rel = Path("speakers") / "_review" / seg.speaker / f"{quality}_{idx:04d}.wav"
        speaker_dir.mkdir(parents=True, exist_ok=True)
        abs_path = out_dir / rel

        duration = seg.end - seg.start
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            f"{seg.start:.3f}",
            "-i",
            str(source_wav),
            "-t",
            f"{duration:.3f}",
            "-acodec",
            "pcm_s16le",
            str(abs_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed cutting {seg.speaker} "
                f"{seg.start:.2f}-{seg.end:.2f}:\n{proc.stderr.strip()}"
            )

        written.append(
            Segment(
                speaker=seg.speaker,
                start=seg.start,
                end=seg.end,
                file=str(rel).replace("\\", "/"),
                purity=seg.purity,
                quality=quality,
            )
        )

    return written
