#!/usr/bin/env python3
"""Build speaker prints from past Gọi clips.

Each account's own calls are clustered. The largest group of clips within
`speaker_seed_link` of their medoid opens a print when it has at least
`speaker_seed_min_count` clips, covers at least `speaker_seed_majority` of
that account's usable calls, and is strictly larger than the next group.
Voice DNA is not read. Someone with no Voice DNA still gets a print from a
trustworthy run of their own calls. Someone whose calls split between two
voices does not.

Short clips, mixed clips, and a clip whose transcript names someone else stay
out of the account's group. After every majority is frozen, a leftover joins
an existing print only on a confident match (0.60 and a gap of 0.10). The
live self-enroll bar is not used. Words do not open a print. Two `--commit`
runs accept the same set. A dry-run prints one decision per account.

Needs the speaker-id process (./scripts/run-speaker-id.sh) and DATABASE_URL.

  ./scripts/rebuild-speaker-prints.py
  ./scripts/rebuild-speaker-prints.py --space <id> --commit
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Message, SpeakerPrint, Thread  # noqa: E402
from app.services.speaker_id import (  # noqa: E402
    EmbedObservation,
    SeedClip,
    SpeakerIdUnavailable,
    centroid,
    decide_speaker,
    plan_seed_clips,
    request_embedding,
    spoken_speaker_id,
    upsert_print,
)
from app.services.storage import absolute_media_path  # noqa: E402


def _observe(settings, relative: str, mime: str | None) -> EmbedObservation | None:
    try:
        path = absolute_media_path(relative)
    except Exception:
        return None
    if not path.exists():
        return None
    try:
        return request_embedding(settings, path=path, mime=mime)
    except SpeakerIdUnavailable:
        raise


def _gate(settings, obs: EmbedObservation) -> str:
    """`no_gallery` means the clip is long enough and one voice."""
    decision = decide_speaker(
        obs.embedding,
        halves=obs.halves,
        duration_s=obs.duration_s,
        prints=[],
        threshold=settings.speaker_match_threshold,
        margin=settings.speaker_match_margin,
        min_duration_s=settings.speaker_min_duration_s,
        half_min_cosine=settings.speaker_half_min_cosine,
    )
    return decision.reason


def collect(db, settings, *, space_id: str | None) -> dict[str, list[SeedClip]]:
    buckets: dict[str, list[SeedClip]] = {}

    turn_query = (
        db.query(Message, Thread)
        .join(Thread, Message.thread_id == Thread.id)
        .filter(Message.kind == "voice", Message.media_path.isnot(None))
        .order_by(Message.id)
    )
    if space_id:
        turn_query = turn_query.filter(Thread.space_id == space_id)
    for message, thread in turn_query.all():
        if not message.sender_user_id or not message.media_path:
            continue
        obs = _observe(settings, message.media_path, message.media_mime)
        if obs is None:
            print(
                f"  call clip account={message.sender_user_id} "
                f"message={message.id} unreadable"
            )
            continue
        reason = _gate(settings, obs)
        buckets.setdefault(thread.space_id, []).append(
            SeedClip(
                user_id=message.sender_user_id,
                embedding=obs.embedding,
                trusted=False,
                skip_reason="" if reason == "no_gallery" else reason,
                label=message.id,
                spoken_user_id=spoken_speaker_id(db, thread, message.body or ""),
            )
        )
    return buckets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", default="", help="Limit to one family space")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Write speaker_prints. Without this, only print the plan.",
    )
    args = parser.parse_args()
    settings = get_settings()
    space_id = args.space.strip() or None
    db = SessionLocal()
    try:
        try:
            grouped = collect(db, settings, space_id=space_id)
        except SpeakerIdUnavailable as exc:
            print(f"speaker-id không trả lời: {exc}", file=sys.stderr)
            print("Chạy ./scripts/run-speaker-id.sh rồi thử lại.", file=sys.stderr)
            return 1
        cap = max(1, settings.speaker_print_cap)
        planned: dict[str, dict[str, list]] = {}
        for sid, clips in grouped.items():
            plan = plan_seed_clips(
                clips,
                threshold=settings.speaker_match_threshold,
                margin=settings.speaker_match_margin,
                link=settings.speaker_seed_link,
                min_count=settings.speaker_seed_min_count,
                majority=settings.speaker_seed_majority,
            )
            planned[sid] = plan.prints
            print(f"\n=== Space {sid} ===")
            print(f"  call clips: {len(clips)}")
            if plan.lines:
                for line in plan.lines:
                    print(line)
            else:
                print("  (no call clips)")
            for user_id, vectors in sorted(plan.prints.items()):
                print(f"  print user={user_id} clips={len(vectors)}")

        if not args.commit:
            print("\nDry run. Pass --commit to write speaker_prints.")
            return 0

        for sid, buckets in planned.items():
            existing = (
                db.query(SpeakerPrint).filter(SpeakerPrint.space_id == sid).all()
            )
            keep = set(buckets)
            for row in existing:
                if row.user_id not in keep:
                    db.delete(row)
            for user_id, vectors in buckets.items():
                upsert_print(
                    db,
                    space_id=sid,
                    user_id=user_id,
                    embedding=centroid(vectors),
                    sample_count=min(len(vectors), cap),
                )
        db.commit()
        print("\nWrote speaker_prints.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
