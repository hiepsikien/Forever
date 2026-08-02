"""Post-diarization refinement for cleaner solo segments.

Goal: harvest exclusive (non-overlap) speech for Voice DNA sampling.
Overlapping regions are dropped; remaining pieces are trimmed, lightly merged,
and labeled clean / short / mixed by purity + duration.
"""

from __future__ import annotations

from extract.types import Segment

# Defaults tuned for heritage Voice DNA harvest (prefer clean over long).
DEFAULT_EDGE_TRIM = 0.05
DEFAULT_MAX_GAP = 0.35
DEFAULT_PAD = 0.05
DEFAULT_MIN_DURATION = 2.0
DEFAULT_PURITY_MIN = 0.9


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def overlap_intervals(segments: list[Segment]) -> list[tuple[float, float]]:
    """Return merged time ranges where ≥2 speakers overlap."""
    if len(segments) < 2:
        return []

    events: list[tuple[float, int]] = []
    for seg in segments:
        if seg.end <= seg.start:
            continue
        events.append((seg.start, 1))
        events.append((seg.end, -1))
    events.sort(key=lambda x: (x[0], -x[1]))

    active = 0
    overlap_start: float | None = None
    raw: list[tuple[float, float]] = []
    for t, delta in events:
        prev = active
        active += delta
        if prev < 2 <= active:
            overlap_start = t
        elif prev >= 2 > active and overlap_start is not None:
            if t > overlap_start:
                raw.append((overlap_start, t))
            overlap_start = None

    return _merge_ranges(raw)


def _merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not ranges:
        return []
    ordered = sorted(ranges)
    out = [ordered[0]]
    for start, end in ordered[1:]:
        prev_start, prev_end = out[-1]
        if start <= prev_end:
            out[-1] = (prev_start, max(prev_end, end))
        else:
            out.append((start, end))
    return out


def subtract_ranges(
    start: float,
    end: float,
    cuts: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Subtract cut ranges from [start, end], returning remaining intervals."""
    if end <= start:
        return []
    pieces = [(start, end)]
    for c_start, c_end in cuts:
        next_pieces: list[tuple[float, float]] = []
        for p_start, p_end in pieces:
            if c_end <= p_start or c_start >= p_end:
                next_pieces.append((p_start, p_end))
                continue
            if c_start > p_start:
                next_pieces.append((p_start, min(c_start, p_end)))
            if c_end < p_end:
                next_pieces.append((max(c_end, p_start), p_end))
        pieces = [(a, b) for a, b in next_pieces if b > a]
        if not pieces:
            break
    return pieces


def exclusive_segments(segments: list[Segment]) -> list[Segment]:
    """Keep only non-overlapping portions of each speaker turn."""
    overlaps = overlap_intervals(segments)
    out: list[Segment] = []
    for seg in segments:
        for start, end in subtract_ranges(seg.start, seg.end, overlaps):
            out.append(Segment(speaker=seg.speaker, start=start, end=end))
    out.sort(key=lambda s: (s.start, s.end, s.speaker))
    return out


def trim_edges(
    segments: list[Segment],
    *,
    trim: float = DEFAULT_EDGE_TRIM,
) -> list[Segment]:
    """Trim attack/decay at boundaries (contamination often lives at edges)."""
    if trim <= 0:
        return list(segments)
    out: list[Segment] = []
    for seg in segments:
        start = seg.start + trim
        end = seg.end - trim
        if end - start <= 0:
            continue
        out.append(
            Segment(
                speaker=seg.speaker,
                start=start,
                end=end,
                file=seg.file,
                purity=seg.purity,
                quality=seg.quality,
            )
        )
    return out


def merge_same_speaker(
    segments: list[Segment],
    *,
    max_gap: float = DEFAULT_MAX_GAP,
) -> list[Segment]:
    """Merge nearby same-speaker turns without crossing other speakers."""
    if not segments:
        return []
    ordered = sorted(segments, key=lambda s: (s.start, s.end, s.speaker))
    merged: list[Segment] = [ordered[0]]
    for seg in ordered[1:]:
        prev = merged[-1]
        same = seg.speaker == prev.speaker
        close = seg.start - prev.end <= max_gap
        if same and close:
            merged[-1] = Segment(
                speaker=prev.speaker,
                start=prev.start,
                end=max(prev.end, seg.end),
                file=prev.file,
                purity=prev.purity,
                quality=prev.quality,
            )
        else:
            merged.append(seg)
    return merged


def apply_padding(
    segments: list[Segment],
    *,
    pad: float = DEFAULT_PAD,
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
        padded.append(
            Segment(
                speaker=seg.speaker,
                start=start,
                end=end,
                file=seg.file,
                purity=seg.purity,
                quality=seg.quality,
            )
        )
    return padded


def label_quality(
    segments: list[Segment],
    *,
    min_duration: float = DEFAULT_MIN_DURATION,
    purity_min: float = DEFAULT_PURITY_MIN,
) -> list[Segment]:
    labeled: list[Segment] = []
    for seg in segments:
        purity = 1.0 if seg.purity is None else _clamp01(float(seg.purity))
        if purity < purity_min:
            quality = "mixed"
        elif seg.duration < min_duration:
            quality = "short"
        else:
            quality = "clean"
        labeled.append(
            Segment(
                speaker=seg.speaker,
                start=seg.start,
                end=seg.end,
                file=seg.file,
                purity=round(purity, 4),
                quality=quality,
            )
        )
    return labeled


def refine_segments(
    raw: list[Segment],
    *,
    exclusive_only: bool = True,
    edge_trim: float = DEFAULT_EDGE_TRIM,
    max_gap: float = DEFAULT_MAX_GAP,
    pad: float = DEFAULT_PAD,
    min_duration: float = DEFAULT_MIN_DURATION,
    purity_min: float = DEFAULT_PURITY_MIN,
    total_duration: float | None = None,
    keep_mixed: bool = False,
) -> list[Segment]:
    """Full refine pass used by CLI and worker.

    When exclusive_only=True (default), overlapping audio is removed before cut.
    When keep_mixed=False, mixed/short can still be emitted for review but
    exclusive pieces are preferred; short stays for optional review.
    """
    if not raw:
        return []

    if exclusive_only:
        working = exclusive_segments(raw)
        # Exclusive pieces are pure by construction.
        working = [
            Segment(speaker=s.speaker, start=s.start, end=s.end, purity=1.0)
            for s in working
        ]
    else:
        overlaps = overlap_intervals(raw)
        working = []
        for seg in raw:
            exclusive = subtract_ranges(seg.start, seg.end, overlaps)
            exclusive_dur = sum(b - a for a, b in exclusive)
            purity = exclusive_dur / seg.duration if seg.duration > 0 else 0.0
            working.append(
                Segment(
                    speaker=seg.speaker,
                    start=seg.start,
                    end=seg.end,
                    purity=_clamp01(purity),
                )
            )

    working = trim_edges(working, trim=edge_trim)
    working = merge_same_speaker(working, max_gap=max_gap)
    working = apply_padding(working, pad=pad, total_duration=total_duration)
    working = label_quality(
        working, min_duration=min_duration, purity_min=purity_min
    )

    if not keep_mixed:
        # Drop contaminated; keep clean + short (short may still help review).
        working = [s for s in working if s.quality != "mixed"]

    return working
