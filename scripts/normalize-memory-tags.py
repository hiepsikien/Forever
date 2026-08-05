#!/usr/bin/env python3
"""Rewrite memory tags to one separator, with nothing repeated.

`tags` is a flat string, and two writers disagreed about how to join it: poem
and milestone imports used spaces, the mobile editor used commas. The API reads
both, so nothing looked broken server-side — but any reader that split on one
separator saw a whole run of tags as a single token, and an item anchored to a
remembered person read as anchored to nobody.

  ./scripts/normalize-memory-tags.py --dry-run
  ./scripts/normalize-memory-tags.py --commit

Order is preserved and no tag is invented, so this only ever removes a duplicate
or swaps a comma for a space.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.db import SessionLocal  # noqa: E402
from app.models import MemoryItem  # noqa: E402
from app.services.heritage import tag_tokens  # noqa: E402


def normalized(tags: str | None) -> str:
    return " ".join(dict.fromkeys(tag_tokens(tags)))[:500]


def main() -> int:
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    changed = 0
    for item in db.query(MemoryItem).order_by(MemoryItem.created_at).all():
        clean = normalized(item.tags)
        if clean == (item.tags or ""):
            continue
        changed += 1
        print(f"{item.kind:9} {item.title[:38]!r}")
        print(f"    cũ : {item.tags}")
        print(f"    mới: {clean}")
        if args.commit:
            item.tags = clean
    if args.commit and changed:
        db.commit()
    print(f"\n{'Sẽ sửa' if args.dry_run else 'Đã sửa'}: {changed}")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
