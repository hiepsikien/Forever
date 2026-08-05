#!/usr/bin/env python3
"""One-shot: apply identity lock + import approved poems on the running API DB.

Run inside the forever-api container (has app + DATABASE_URL):

  python /data/sync/cloud-sync-heritage.py \\
    --space 5K__lcaDoIozrdKA5r0NL \\
    --identity XLLFcmmNSIiWIOhc2vwYw \\
    --lock /data/sync/identity-lock.final.json \\
    --ocr-dir /data/sync/poetry-ocr
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from nanoid import generate

from app.db import SessionLocal
from app.models import IdentityProfile, MemoryItem, User
from app.routers.memories import (
    UNTITLED_POEM,
    _poem_fingerprint,
    _poem_tags,
)
from app.services.heritage import (
    POEM_KIND,
    mark_profile_reviewed,
    sync_heritage_thread_title,
    tag_tokens,
)
from app.services.poetry_clean import clean_body_lines, format_body, format_body_tts

APPROVED = "approved"


def _load_poems(ocr_dir: Path) -> list[dict]:
    poems: list[dict] = []
    for path in sorted(ocr_dir.glob("*.json")):
        if path.name == "manifest.json":
            continue
        page = json.loads(path.read_text(encoding="utf-8"))
        if (page.get("review_status") or "") != APPROVED:
            continue
        for poem in page.get("poems") or []:
            poems.append(
                {
                    "title": poem.get("title") or "",
                    "body": poem.get("body") or "",
                    "body_tts": poem.get("body_tts") or "",
                    "meter": poem.get("meter") or "unknown",
                    "themes": poem.get("themes") or [],
                    "composed_on": poem.get("composed_on"),
                }
            )
    return poems


def _dump_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def apply_lock(db, identity: IdentityProfile, patch: dict, reviewer_id: str) -> None:
    if patch.get("display_name"):
        identity.display_name = patch["display_name"]
    if patch.get("relation_label") is not None:
        identity.relation_label = patch["relation_label"]
    if patch.get("life_stage") is not None:
        identity.life_stage_json = _dump_json(patch["life_stage"])
    if patch.get("roles") is not None:
        identity.roles_json = _dump_json(patch["roles"])
    if patch.get("address_forms") is not None:
        identity.address_forms_json = _dump_json(patch["address_forms"])
    if patch.get("speech_style") is not None:
        identity.speech_style_json = _dump_json(patch["speech_style"])
    if patch.get("core_values") is not None:
        identity.core_values_json = _dump_json(patch["core_values"])
    if patch.get("philosophy") is not None:
        identity.philosophy_json = _dump_json(patch["philosophy"])
    if patch.get("taboos") is not None:
        identity.taboos_json = _dump_json(patch["taboos"])
    if patch.get("poetry_quote_mode"):
        identity.poetry_quote_mode = patch["poetry_quote_mode"]
    mark_profile_reviewed(identity, user_id=reviewer_id)
    sync_heritage_thread_title(db, identity)


def import_poems(
    db,
    *,
    space_id: str,
    identity: IdentityProfile,
    poems: list[dict],
    created_by: str,
    dry_run: bool,
) -> tuple[int, int]:
    needle = f"heritage:{identity.id}"
    existing = {
        _poem_fingerprint(item.body)
        for item in db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == POEM_KIND)
        .all()
        if needle in tag_tokens(item.tags)
    }
    now = datetime.now(timezone.utc)
    imported = 0
    skipped = 0
    for poem in poems:
        meter = (poem.get("meter") or "unknown").strip()
        lines = clean_body_lines(poem.get("body") or "", meter=meter)
        text = format_body(lines)
        if not text:
            skipped += 1
            continue
        fingerprint = _poem_fingerprint(text)
        if fingerprint in existing:
            skipped += 1
            continue
        existing.add(fingerprint)
        if dry_run:
            imported += 1
            continue
        occurred_at = None
        raw_date = poem.get("composed_on")
        if raw_date:
            try:
                occurred_at = datetime.fromisoformat(raw_date)
                if occurred_at.tzinfo is None:
                    occurred_at = occurred_at.replace(tzinfo=timezone.utc)
            except ValueError:
                occurred_at = None
        item = MemoryItem(
            id=generate(),
            space_id=space_id,
            created_by=created_by,
            kind=POEM_KIND,
            title=(poem.get("title") or "").strip()[:200] or UNTITLED_POEM,
            body=text,
            body_tts=(poem.get("body_tts") or "").strip()
            or format_body_tts(lines, meter=meter),
            media_path=None,
            media_mime=None,
            source_message_id=None,
            tags=_poem_tags(identity.id, meter, poem.get("themes") or []),
            occurred_at=occurred_at,
            created_at=now,
        )
        db.add(item)
        imported += 1
    if not dry_run:
        db.commit()
    return imported, skipped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--space", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--ocr-dir", type=Path, required=True)
    parser.add_argument("--owner-email", default="anh.nguyendinh.cs@gmail.com")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    lock_doc = json.loads(args.lock.read_text(encoding="utf-8"))
    patch = lock_doc.get("patch") or lock_doc
    poems = _load_poems(args.ocr_dir)
    if not poems:
        print("No approved poems found.", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        owner = (
            db.query(User).filter(User.email == args.owner_email).one_or_none()
        )
        if not owner:
            print(f"Owner not found: {args.owner_email}", file=sys.stderr)
            return 1
        identity = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.id == args.identity,
                IdentityProfile.space_id == args.space,
            )
            .one_or_none()
        )
        if not identity:
            print("Identity not found.", file=sys.stderr)
            return 1

        print(f"Applying identity lock to {identity.display_name} ({identity.id})…")
        if not args.dry_run:
            apply_lock(db, identity, patch, owner.id)
            db.commit()
            db.refresh(identity)
        else:
            print("[dry-run] would PATCH identity lock + mark_profile_reviewed")

        print(f"Importing {len(poems)} approved poems…")
        imported, skipped = import_poems(
            db,
            space_id=args.space,
            identity=identity,
            poems=poems,
            created_by=owner.id,
            dry_run=args.dry_run,
        )
        print(f"Done: imported={imported} skipped={skipped} dry_run={args.dry_run}")
        print(f"display_name={identity.display_name} status={identity.heritage_entity_status}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
