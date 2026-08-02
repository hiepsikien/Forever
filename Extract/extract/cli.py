from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from extract import __version__
from extract.cut import cut_segments
from extract.diarize import DEFAULT_MODEL, diarize_file
from extract.normalize import normalize_audio, probe_duration_seconds


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="extract",
        description=(
            "Local speaker diarization: normalize audio, detect speakers, "
            "cut per-speaker segments."
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
        default=0.2,
        help="Padding seconds around each cut (default: 0.2)",
    )
    p.add_argument(
        "--max-gap",
        type=float,
        default=0.75,
        help="Merge same-speaker segments closer than this many seconds",
    )
    p.add_argument(
        "--min-duration",
        type=float,
        default=0.4,
        help="Drop segments shorter than this many seconds after merge",
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
    out_dir.mkdir(parents=True, exist_ok=True)

    source_wav = out_dir / "source.wav"
    print(f"[1/3] normalize → {source_wav}")
    normalize_audio(input_path, source_wav, sample_rate=args.sample_rate)
    duration = probe_duration_seconds(source_wav)

    print(
        f"[2/3] diarize model={args.model} num_speakers={args.num_speakers} "
        f"device={args.device}"
    )
    raw_segments, device_used = diarize_file(
        source_wav,
        num_speakers=args.num_speakers,
        model_id=args.model,
        device=args.device,
    )
    print(f"      device_used={device_used} raw_turns={len(raw_segments)}")

    print(f"[3/3] cut segments → {out_dir / 'speakers'}")
    written = cut_segments(
        source_wav,
        raw_segments,
        out_dir,
        pad=args.pad,
        max_gap=args.max_gap,
        min_duration=args.min_duration,
        total_duration=duration or None,
    )

    speakers = sorted({s.speaker for s in written})
    payload = {
        "version": __version__,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "source_wav": "source.wav",
        "num_speakers": args.num_speakers,
        "detected_speakers": speakers,
        "model": args.model,
        "device": device_used,
        "duration_seconds": duration or None,
        "options": {
            "pad": args.pad,
            "max_gap": args.max_gap,
            "min_duration": args.min_duration,
            "sample_rate": args.sample_rate,
        },
        "segments": [s.to_dict() for s in written],
    }
    meta_path = out_dir / "diarization.json"
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    print(f"done: {len(written)} segments, {len(speakers)} speakers")
    print(f"meta: {meta_path}")
    for spk in speakers:
        count = sum(1 for s in written if s.speaker == spk)
        print(f"  {spk}: {count} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
