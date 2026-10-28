#!/usr/bin/env python3
"""Build speaker prints from self Voice DNA samples and past voice turns.

Self samples (the person recorded their own voice) open a print. A past Gọi
clip is added only when it confidently matches one of those prints — including
when mẹ spoke on con's account, or con and anh each spoke on mẹ's account.
A clip that matches nobody is left out. Nothing is written into Voice DNA.

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
from app.models import IdentityProfile, Message, SpeakerPrint, Thread, VoiceProfile, VoiceSample  # noqa: E402
from app.services.speaker_id import (  # noqa: E402
    EmbedObservation,
    SeedClip,
    SpeakerIdUnavailable,
    anchor_user_id,
    assign_seed_clips,
    centroid,
    decide_speaker,
    request_embedding,
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


def _usable(settings, obs: EmbedObservation | None) -> bool:
    if obs is None:
        return False
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
    return decision.reason == "no_gallery"


def collect(db, settings, *, space_id: str | None) -> dict[str, list[SeedClip]]:
    buckets: dict[str, list[SeedClip]] = {}

    sample_query = (
        db.query(VoiceSample, VoiceProfile)
        .join(VoiceProfile, VoiceSample.voice_profile_id == VoiceProfile.id)
        .filter(VoiceProfile.archived_at.is_(None))
    )
    if space_id:
        sample_query = sample_query.filter(VoiceProfile.space_id == space_id)
    identities = {
        row.id: row
        for row in db.query(IdentityProfile).all()
    }
    for sample, profile in sample_query.all():
        identity = identities.get(profile.identity_profile_id or "")
        user_id = anchor_user_id(profile, identity)
        if not user_id or not sample.media_path:
            continue
        obs = _observe(settings, sample.media_path, sample.media_mime)
        if not _usable(settings, obs):
            print(f"  skip anchor {sample.id} (short, mixed, or unreadable)")
            continue
        assert obs is not None
        buckets.setdefault(profile.space_id, []).append(
            SeedClip(user_id=user_id, embedding=obs.embedding, trusted=True)
        )
        print(f"  anchor {profile.space_id} user={user_id} sample={sample.id}")

    turn_query = (
        db.query(Message, Thread)
        .join(Thread, Message.thread_id == Thread.id)
        .filter(Message.kind == "voice", Message.media_path.isnot(None))
    )
    if space_id:
        turn_query = turn_query.filter(Thread.space_id == space_id)
    for message, thread in turn_query.all():
        if not message.sender_user_id or not message.media_path:
            continue
        obs = _observe(settings, message.media_path, message.media_mime)
        if not _usable(settings, obs):
            continue
        assert obs is not None
        buckets.setdefault(thread.space_id, []).append(
            SeedClip(
                user_id=message.sender_user_id,
                embedding=obs.embedding,
                trusted=False,
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
            planned[sid] = assign_seed_clips(
                clips,
                threshold=settings.speaker_match_threshold,
                margin=settings.speaker_match_margin,
            )
            trusted = {c.user_id for c in clips if c.trusted}
            print(f"\n=== Space {sid} ===")
            print(f"  anchors: {len(trusted)} people, clips: {len(clips)}")
            for user_id, vectors in sorted(planned[sid].items()):
                print(f"  print user={user_id} clips={len(vectors)}")
            dropped = trusted - set(planned[sid])
            if dropped:
                print(f"  no print (empty anchor): {', '.join(sorted(dropped))}")

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
