#!/usr/bin/env python3
"""Seed the Family Codex and life milestones for a heritage identity.

Both are steward actions, so nothing lands approved unless you say so:

  ./scripts/seed-heritage-context.py --identity <id> --dry-run
  ./scripts/seed-heritage-context.py --identity <id> --approve
  ./scripts/seed-heritage-context.py --identity <id> --milestones-only

Codex rows come from the Lock's roles_json; milestones come from
docs/heritage-bo-trieu/milestones.draft.json. Runs against the local database
directly — see docs/heritage-chat-v2.plan.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_DIR = ROOT / "apps" / "api"
sys.path.insert(0, str(API_DIR))

from nanoid import generate  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import FamilyEntity, IdentityProfile, MemoryItem  # noqa: E402
from app.services.heritage import HERITAGE_TAG_PREFIX, tag_tokens  # noqa: E402
from app.services.heritage_codex import seed_entities_from_lock  # noqa: E402

DEFAULT_MILESTONES = ROOT / "docs" / "heritage-bo-trieu" / "milestones.draft.json"
MILESTONE_KIND = "milestone"


def parse_occurred_at(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def milestone_body(entry: dict) -> str:
    parts = [(entry.get("summary") or "").strip()]
    when = entry.get("occurred_at")
    ended = entry.get("ended_at")
    precision = entry.get("precision")
    if when and ended:
        parts.append(f"Khoảng thời gian: {when} – {ended}.")
    elif when and precision in ("year_approx", "year_end"):
        parts.append(f"Thời điểm (ước lượng): {when}.")
    return "\n".join(p for p in parts if p)


def seed_milestones(
    db, *, identity: IdentityProfile, path: Path, created_by: str, dry_run: bool
) -> tuple[int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("milestones") or []
    needle = f"{HERITAGE_TAG_PREFIX}{identity.id}"

    existing_titles = {
        (row.title or "").strip().lower()
        for row in db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == identity.space_id,
            MemoryItem.kind == MILESTONE_KIND,
        )
        .all()
        if needle in tag_tokens(row.tags)
    }

    added = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    for entry in entries:
        title = (entry.get("title") or "").strip()
        if not title:
            continue
        if title.lower() in existing_titles:
            skipped += 1
            continue
        themes = [t for t in (entry.get("themes") or []) if isinstance(t, str)]
        tags = " ".join([needle, *(f"chu-de:{t}" for t in themes)])
        print(f"  + {title}")
        added += 1
        if dry_run:
            continue
        db.add(
            MemoryItem(
                id=generate(),
                space_id=identity.space_id,
                created_by=created_by,
                kind=MILESTONE_KIND,
                title=title,
                body=milestone_body(entry),
                tags=tags,
                occurred_at=parse_occurred_at(entry.get("occurred_at")),
                created_at=now,
            )
        )
    return added, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--milestones", type=Path, default=DEFAULT_MILESTONES)
    parser.add_argument(
        "--approve",
        action="store_true",
        help="Mark new codex rows approved (only these reach the chat prompt)",
    )
    parser.add_argument("--codex-only", action="store_true")
    parser.add_argument("--milestones-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        identity = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == args.identity)
            .one_or_none()
        )
        if not identity:
            print(f"Không tìm thấy identity {args.identity}", file=sys.stderr)
            return 2
        print(f"Bản sắc: {identity.display_name} · {identity.relation_label}")

        if not args.milestones_only:
            status = "approved" if args.approve else "draft"
            print(f"\nFamily Codex ({status}):")
            created = seed_entities_from_lock(
                db, identity=identity, created_by=identity.created_by, status=status
            )
            for row in created:
                aliases = ", ".join(json.loads(row.aliases_json or "[]"))
                relation = json.loads(row.relation_json or "{}").get("to_subject", "")
                print(f"  + {row.canonical_name} ({relation}) — bí danh: {aliases}")
            if not created:
                print("  (không có người mới — codex đã đầy đủ)")
            if args.dry_run:
                db.expunge_all()
            existing = (
                db.query(FamilyEntity)
                .filter(FamilyEntity.space_id == identity.space_id)
                .count()
            )
            print(f"  tổng trong codex: {existing}")

        if not args.codex_only:
            print(f"\nMốc đời từ {args.milestones.name}:")
            added, skipped = seed_milestones(
                db,
                identity=identity,
                path=args.milestones,
                created_by=identity.created_by,
                dry_run=args.dry_run,
            )
            print(f"  thêm {added} · bỏ qua {skipped} (đã có)")

        if args.dry_run:
            db.rollback()
            print("\n[dry-run] không ghi gì vào database.")
        else:
            db.commit()
            print("\nĐã lưu.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
