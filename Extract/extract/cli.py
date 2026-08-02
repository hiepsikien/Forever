from __future__ import annotations

import argparse
import sys
from pathlib import Path

from extract import __version__
from extract.diarize import DEFAULT_MODEL
from extract.pipeline import run_extract_pipeline
from extract.refine import (
    DEFAULT_EDGE_TRIM,
    DEFAULT_MAX_GAP,
    DEFAULT_MIN_DURATION,
    DEFAULT_PAD,
    DEFAULT_PURITY_MIN,
)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="extract",
        description=(
            "Local speaker diarization: normalize audio, detect speakers, "
            "refine exclusive solo segments, cut per-speaker clips."
        ),
    )
    p.add_argument("--input", "-i", required=True, type=Path, help="Input audio file")
    p.add_argument(
        "--num-speakers",
        "-n",
        required=True,
        type=int,
        help="Exact number of speakers in this recording",
    )
    p.add_argument(
        "--out",
        "-o",
        type=Path,
        default=None,
        help="Output directory (default: ./out/<input_stem>)",
    )
    p.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Hugging Face diarization pipeline id (default: {DEFAULT_MODEL})",
    )
    p.add_argument(
        "--device",
        default="auto",
        choices=["auto", "mps", "cuda", "cpu"],
        help="Inference device (default: auto → mps/cuda/cpu)",
    )
    p.add_argument(
        "--pad",
        type=float,
        default=DEFAULT_PAD,
        help=f"Padding seconds around each cut (default: {DEFAULT_PAD})",
    )
    p.add_argument(
        "--max-gap",
        type=float,
        default=DEFAULT_MAX_GAP,
        help=f"Merge same-speaker gaps under this many seconds (default: {DEFAULT_MAX_GAP})",
    )
    p.add_argument(
        "--min-duration",
        type=float,
        default=DEFAULT_MIN_DURATION,
        help=f"Minimum duration for clean label (default: {DEFAULT_MIN_DURATION})",
    )
    p.add_argument(
        "--edge-trim",
        type=float,
        default=DEFAULT_EDGE_TRIM,
        help=f"Trim seconds from each edge before pad (default: {DEFAULT_EDGE_TRIM})",
    )
    p.add_argument(
        "--purity-min",
        type=float,
        default=DEFAULT_PURITY_MIN,
        help=f"Minimum exclusive ratio for clean (default: {DEFAULT_PURITY_MIN})",
    )
    p.add_argument(
        "--no-exclusive",
        action="store_true",
        help="Keep original turns and score purity instead of exclusive-only cuts",
    )
    p.add_argument(
        "--keep-mixed",
        action="store_true",
        help="Also emit mixed-quality clips under speakers/_review/",
    )
    p.add_argument(
        "--sample-rate",
        type=int,
        default=16000,
        help="Normalize sample rate (default: 16000)",
    )
    p.add_argument("--version", action="version", version=f"extract {__version__}")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    input_path: Path = args.input.expanduser().resolve()
    if not input_path.is_file():
        print(f"error: input not found: {input_path}", file=sys.stderr)
        return 2
    if args.num_speakers < 1:
        print("error: --num-speakers must be >= 1", file=sys.stderr)
        return 2

    out_dir = (
        args.out.expanduser().resolve()
        if args.out
        else (Path.cwd() / "out" / input_path.stem).resolve()
    )

    print(f"[extract] input={input_path}")
    print(
        f"[extract] exclusive_only={not args.no_exclusive} "
        f"min_duration={args.min_duration} pad={args.pad}"
    )
    try:
        payload = run_extract_pipeline(
            input_path,
            out_dir,
            num_speakers=args.num_speakers,
            model_id=args.model,
            device=args.device,
            pad=args.pad,
            max_gap=args.max_gap,
            min_duration=args.min_duration,
            edge_trim=args.edge_trim,
            purity_min=args.purity_min,
            exclusive_only=not args.no_exclusive,
            keep_mixed=args.keep_mixed,
            sample_rate=args.sample_rate,
        )
    except Exception as exc:  # noqa: BLE001 — CLI surface
        print(f"error: {exc}", file=sys.stderr)
        return 1

    segments = payload.get("segments") or []
    speakers = payload.get("detected_speakers") or []
    clean = payload.get("clean_segment_count") or 0
    print(
        f"done: {len(segments)} segments ({clean} clean), "
        f"{len(speakers)} speakers, device={payload.get('device')}"
    )
    print(f"meta: {out_dir / 'diarization.json'}")
    for spk in speakers:
        count = sum(1 for s in segments if s.get("speaker") == spk)
        clean_n = sum(
            1
            for s in segments
            if s.get("speaker") == spk and s.get("quality") == "clean"
        )
        print(f"  {spk}: {count} files ({clean_n} clean)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
