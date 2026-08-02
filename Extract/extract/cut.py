from __future__ import annotations

import subprocess
from pathlib import Path

from extract.normalize import require_ffmpeg
from extract.types import Segment


def merge_segments(
    segments: list[Segment],
    *,
    max_gap: float = 0.75,
    min_duration: float = 0.4,
) -> list[Segment]:
    """Merge nearby same-speaker turns and drop tiny fragments."""
    if not segments:
        return []

    ordered = sorted(segments, key=lambda s: (s.start, s.end, s.speaker))
    merged: list[Segment] = [ordered[0]]

    for seg in ordered[1:]:
        prev = merged[-1]
        same_speaker = seg.speaker == prev.speaker
        close_enough = seg.start - prev.end <= max_gap
        if same_speaker and close_enough:
            merged[-1] = Segment(
                speaker=prev.speaker,
                start=prev.start,
                end=max(prev.end, seg.end),
            )
        else:
            merged.append(seg)

    return [s for s in merged if s.duration >= min_duration]


def apply_padding(
    segments: list[Segment],
    *,
    pad: float = 0.2,
    total_duration: float | None = None,
) -> list[Segment]:
    padded: list[Segment] = []
    for seg in segments:
        start = max(0.0, seg.start - pad)
        end = seg.end + pad
        if total_duration is not None and total_duration > 0:
            end = min(end, total_duration)
        if end <= start:
            continue
        padded.append(Segment(speaker=seg.speaker, start=start, end=end))
    return padded


def cut_segments(
    source_wav: Path,
    segments: list[Segment],
    out_dir: Path,
    *,
    pad: float = 0.2,
    max_gap: float = 0.75,
    min_duration: float = 0.4,
    total_duration: float | None = None,
) -> list[Segment]:
    """Cut wav clips into speakers/SPEAKER_xx/NNNN.wav and return updated segments."""
    ffmpeg = require_ffmpeg()
    prepared = apply_padding(
        merge_segments(segments, max_gap=max_gap, min_duration=min_duration),
        pad=pad,
        total_duration=total_duration,
    )

    counters: dict[str, int] = {}
    written: list[Segment] = []

    for seg in prepared:
        counters[seg.speaker] = counters.get(seg.speaker, 0) + 1
        idx = counters[seg.speaker]
        speaker_dir = out_dir / "speakers" / seg.speaker
        speaker_dir.mkdir(parents=True, exist_ok=True)
        rel = Path("speakers") / seg.speaker / f"{idx:04d}.wav"
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
            )
        )

    return written
