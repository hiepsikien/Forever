from __future__ import annotations

"""Poll Forever API for Extract jobs and run the local diarization pipeline.

Local usage:
  export FOREVER_API_URL=http://127.0.0.1:8000
  export EXTRACT_WORKER_TOKEN=forever-extract-worker
  extract-worker
"""

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

from extract.pipeline import run_extract_pipeline
from extract.refine import (
    DEFAULT_EDGE_TRIM,
    DEFAULT_MAX_GAP,
    DEFAULT_MIN_DURATION,
    DEFAULT_PAD,
    DEFAULT_PURITY_MIN,
)


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def claim_job(api_url: str, token: str, timeout: float = 60.0) -> dict[str, Any] | None:
    res = requests.post(
        f"{api_url.rstrip('/')}/api/internal/extract/claim",
        headers={"X-Extract-Worker-Token": token},
        timeout=timeout,
    )
    if res.status_code == 204:
        return None
    if res.status_code != 200:
        raise RuntimeError(f"claim failed ({res.status_code}): {res.text}")
    return res.json()


def complete_job(
    api_url: str,
    token: str,
    job_id: str,
    payload: dict[str, Any],
    timeout: float = 120.0,
) -> None:
    res = requests.post(
        f"{api_url.rstrip('/')}/api/internal/extract/{job_id}/complete",
        headers={
            "X-Extract-Worker-Token": token,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )
    if res.status_code != 200:
        raise RuntimeError(f"complete failed ({res.status_code}): {res.text}")


def fail_job(
    api_url: str,
    token: str,
    job_id: str,
    error: str,
    timeout: float = 60.0,
) -> None:
    res = requests.post(
        f"{api_url.rstrip('/')}/api/internal/extract/{job_id}/fail",
        headers={
            "X-Extract-Worker-Token": token,
            "Content-Type": "application/json",
        },
        json={"error": error[:4000]},
        timeout=timeout,
    )
    if res.status_code != 200:
        raise RuntimeError(f"fail failed ({res.status_code}): {res.text}")


def process_claim(api_url: str, token: str, claim: dict[str, Any]) -> None:
    job = claim["job"]
    job_id = job["id"]
    input_path = Path(claim["input_absolute_path"])
    artifact_dir = Path(claim["artifact_dir_absolute"])
    opts = claim.get("options") or {}

    print(
        f"[worker] job={job_id} speakers={job.get('num_speakers')} "
        f"input={input_path}"
    )
    if not input_path.is_file():
        fail_job(api_url, token, job_id, f"Input missing: {input_path}")
        return

    try:
        result = run_extract_pipeline(
            input_path,
            artifact_dir,
            num_speakers=int(job["num_speakers"]),
            model_id=str(opts.get("model") or "pyannote/speaker-diarization-community-1"),
            device=str(opts.get("device") or "auto"),
            pad=float(opts.get("pad", DEFAULT_PAD)),
            max_gap=float(opts.get("max_gap", DEFAULT_MAX_GAP)),
            min_duration=float(opts.get("min_duration", DEFAULT_MIN_DURATION)),
            edge_trim=float(opts.get("edge_trim", DEFAULT_EDGE_TRIM)),
            purity_min=float(opts.get("purity_min", DEFAULT_PURITY_MIN)),
            exclusive_only=bool(opts.get("exclusive_only", True)),
            keep_mixed=bool(opts.get("keep_mixed", False)),
            sample_rate=int(opts.get("sample_rate", 16000)),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[worker] job={job_id} FAILED: {exc}", file=sys.stderr)
        fail_job(api_url, token, job_id, str(exc))
        return

    complete_job(
        api_url,
        token,
        job_id,
        {
            "duration_seconds": result.get("duration_seconds"),
            "device": result.get("device"),
            "model": result.get("model"),
            "raw_turn_count": result.get("raw_turn_count"),
            "options": result.get("options"),
            "segments": result.get("segments") or [],
        },
    )
    clean = result.get("clean_segment_count") or 0
    print(f"[worker] job={job_id} done clean={clean}")


def run_loop(*, api_url: str, token: str, poll_seconds: float, once: bool) -> int:
    print(f"[worker] api={api_url} poll={poll_seconds}s")
    while True:
        try:
            claim = claim_job(api_url, token)
            if claim:
                process_claim(api_url, token, claim)
                if once:
                    return 0
            elif once:
                print("[worker] no job")
                return 0
            else:
                time.sleep(max(0.5, poll_seconds))
        except KeyboardInterrupt:
            print("[worker] stop")
            return 0
        except Exception as exc:  # noqa: BLE001
            print(f"[worker] loop error: {exc}", file=sys.stderr)
            if once:
                return 1
            time.sleep(max(1.0, poll_seconds))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="extract-worker")
    p.add_argument(
        "--api-url",
        default=_env("FOREVER_API_URL", "http://127.0.0.1:8000"),
        help="Forever API base URL",
    )
    p.add_argument(
        "--token",
        default=_env("EXTRACT_WORKER_TOKEN", "forever-extract-worker"),
        help="Shared worker token (X-Extract-Worker-Token)",
    )
    p.add_argument(
        "--poll-seconds",
        type=float,
        default=float(_env("EXTRACT_POLL_SECONDS", "3") or "3"),
        help="Idle poll interval",
    )
    p.add_argument(
        "--once",
        action="store_true",
        help="Claim at most one job then exit",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.token:
        print("error: EXTRACT_WORKER_TOKEN / --token required", file=sys.stderr)
        return 2
    return run_loop(
        api_url=args.api_url,
        token=args.token,
        poll_seconds=args.poll_seconds,
        once=args.once,
    )


if __name__ == "__main__":
    raise SystemExit(main())
