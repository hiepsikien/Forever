"""Shared normalize → diarize → refine → cut pipeline for CLI and worker."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from extract import __version__
from extract.cut import cut_segments
from extract.diarize import DEFAULT_MODEL, diarize_file
from extract.normalize import normalize_audio, probe_duration_seconds
from extract.refine import (
    DEFAULT_EDGE_TRIM,
    DEFAULT_MAX_GAP,
    DEFAULT_MIN_DURATION,
    DEFAULT_PAD,
    DEFAULT_PURITY_MIN,
    refine_segments,
)
from extract.types import Segment


def run_extract_pipeline(
    input_path: Path,
    out_dir: Path,
    *,
    num_speakers: int,
    model_id: str = DEFAULT_MODEL,
    device: str = "auto",
    pad: float = DEFAULT_PAD,
    max_gap: float = DEFAULT_MAX_GAP,
    min_duration: float = DEFAULT_MIN_DURATION,
    edge_trim: float = DEFAULT_EDGE_TRIM,
    purity_min: float = DEFAULT_PURITY_MIN,
    exclusive_only: bool = True,
    keep_mixed: bool = False,
    sample_rate: int = 16000,
    pipeline=None,
) -> dict[str, Any]:
    """Run full extract pipeline into out_dir; return diarization payload."""
    out_dir.mkdir(parents=True, exist_ok=True)
    source_wav = out_dir / "source.wav"

    normalize_audio(input_path, source_wav, sample_rate=sample_rate)
    duration = probe_duration_seconds(source_wav)

    raw_segments, device_used = diarize_file(
        source_wav,
        num_speakers=num_speakers,
        model_id=model_id,
        device=device,
        pipeline=pipeline,
    )

    prepared = refine_segments(
        raw_segments,
        exclusive_only=exclusive_only,
        edge_trim=edge_trim,
        max_gap=max_gap,
        pad=pad,
        min_duration=min_duration,
        purity_min=purity_min,
        total_duration=duration or None,
        keep_mixed=keep_mixed,
    )

    written = cut_segments(
        source_wav,
        raw_segments,
        out_dir,
        pad=pad,
        max_gap=max_gap,
        min_duration=min_duration,
        edge_trim=edge_trim,
        purity_min=purity_min,
        exclusive_only=exclusive_only,
        keep_mixed=keep_mixed,
        total_duration=duration or None,
        prepared=prepared,
    )

    speakers = sorted({s.speaker for s in written})
    clean_count = sum(1 for s in written if s.quality == "clean")
    payload: dict[str, Any] = {
        "version": __version__,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "source_wav": "source.wav",
        "num_speakers": num_speakers,
        "detected_speakers": speakers,
        "model": model_id,
        "device": device_used,
        "duration_seconds": duration or None,
        "raw_turn_count": len(raw_segments),
        "clean_segment_count": clean_count,
        "options": {
            "pad": pad,
            "max_gap": max_gap,
            "min_duration": min_duration,
            "edge_trim": edge_trim,
            "purity_min": purity_min,
            "exclusive_only": exclusive_only,
            "keep_mixed": keep_mixed,
            "sample_rate": sample_rate,
        },
        "segments": [s.to_dict() for s in written],
    }
    meta_path = out_dir / "diarization.json"
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return payload


def segments_from_payload(payload: dict[str, Any]) -> list[Segment]:
    out: list[Segment] = []
    for row in payload.get("segments") or []:
        out.append(
            Segment(
                speaker=str(row["speaker"]),
                start=float(row["start"]),
                end=float(row["end"]),
                file=row.get("file"),
                purity=row.get("purity"),
                quality=row.get("quality"),
            )
        )
    return out
