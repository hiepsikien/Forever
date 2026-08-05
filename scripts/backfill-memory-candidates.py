#!/usr/bin/env python3
"""Queue facts from turns that happened before the review queue existed.

Every heritage reply already carries what the analyzer heard in its
`meta_json.new_facts`. Turns from before Stage 5b shipped never got queued, so
those facts sit in message meta where no one can act on them:

  ./scripts/backfill-memory-candidates.py --dry-run
  ./scripts/backfill-memory-candidates.py --thread <id>
  ./scripts/backfill-memory-candidates.py --commit

Only `stated` facts are queued, same as a live turn — an implied fact is a guess
and must not become someone's biography. Deduplication and the per-identity cap
come from the service, so running this twice is safe.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.db import SessionLocal  # noqa: E402
from app.models import FamilySpace, Message, Thread  # noqa: E402
from app.services.heritage import identity_for_thread  # noqa: E402
from app.services.heritage_candidates import (  # noqa: E402
    _already_queued,
    _in_library,
    enqueue_facts,
    reviewer_for,
)


def stated_facts(message: Message) -> list[dict]:
    try:
        meta = json.loads(message.meta_json or "{}")
    except (TypeError, ValueError):
        return []
    facts = meta.get("new_facts")
    if not isinstance(facts, list):
        return []
    return [
        fact
        for fact in facts
        if isinstance(fact, dict)
        and (fact.get("statement") or "").strip()
        and fact.get("confidence", "stated") == "stated"
    ]


def asking_message(db, reply: Message) -> Message | None:
    """The member's message this reply answered — that is what a fact came from."""
    return (
        db.query(Message)
        .filter(
            Message.thread_id == reply.thread_id,
            Message.sender_kind == "user",
            Message.created_at <= reply.created_at,
        )
        .order_by(Message.created_at.desc())
        .first()
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--thread", help="only this thread")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    threads = db.query(Thread).filter(Thread.kind == "heritage")
    if args.thread:
        threads = threads.filter(Thread.id == args.thread)

    total = 0
    for thread in threads.all():
        identity = identity_for_thread(db, thread)
        if not identity:
            continue
        replies = (
            db.query(Message)
            .filter(
                Message.thread_id == thread.id, Message.sender_kind == "heritage"
            )
            .order_by(Message.created_at)
            .all()
        )
        found: list[tuple[Message, list[dict]]] = []
        for reply in replies:
            facts = stated_facts(reply)
            if not facts:
                continue
            source = asking_message(db, reply)
            if source:
                found.append((source, facts))
        if not found:
            continue

        space = (
            db.query(FamilySpace)
            .filter(FamilySpace.id == thread.space_id)
            .one_or_none()
        )
        reviewer = reviewer_for(thread, space) if space else None
        heard = sum(len(f) for _, f in found)
        print(f"\n{thread.title} ({thread.id})")
        print(f"  {identity.display_name} · scope={thread.audience_scope}")
        print(f"  {heard} điều đã nói, người duyệt: {reviewer or 'KHÔNG CÓ'}")

        if args.dry_run:
            for _, facts in found:
                for fact in facts:
                    seen = _already_queued(
                        db, identity_id=identity.id, statement=fact["statement"]
                    ) or _in_library(
                        db,
                        space_id=thread.space_id,
                        identity_id=identity.id,
                        statement=fact["statement"],
                    )
                    if not seen:
                        total += 1
                    mark = "đã có" if seen else "mới"
                    when = fact.get("occurred_at") or "—"
                    print(
                        f"    [{mark}] [{fact.get('kind', 'event')} {when}] "
                        f"{fact['statement'][:80]}"
                    )
            continue

        added = 0
        for source, facts in found:
            queued = enqueue_facts(
                db,
                thread=thread,
                identity=identity,
                user_message=source,
                facts=facts,
            )
            added += len(queued)
        total += added
        print(f"  → đã xếp {added} vào hàng đợi")

    print(f"\n{'Sẽ xếp' if args.dry_run else 'Đã xếp'}: {total}")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
