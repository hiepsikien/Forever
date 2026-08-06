#!/usr/bin/env python3
"""Inventory and shelve identity profiles left over from testing.

Archiving is deliberately not deletion: the family may want a shelved person
back, and the Extract clips behind them cost real work to produce.

  ./scripts/archive-profiles.py                     # inventory, changes nothing
  ./scripts/archive-profiles.py --keep <id> --keep <id> --dry-run
  ./scripts/archive-profiles.py --keep <id> --commit
  ./scripts/archive-profiles.py --restore <id> --commit

Profiles linked to a login account are never archived — that is the member's own
mirror, not a test artefact.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    FamilySpace,
    IdentityProfile,
    Membership,
    User,
    VoiceProfile,
    VoiceSample,
)


def inventory(db) -> None:
    print("=== Users ===")
    for user in db.query(User).order_by(User.created_at.asc()).all():
        spaces = (
            db.query(Membership).filter(Membership.user_id == user.id).count()
        )
        print(
            f"  {user.id}  {user.email:<38} {user.name:<24} "
            f"@{user.handle or '-':<12} spaces={spaces} "
            f"firebase={'yes' if user.firebase_uid else 'no'}"
        )

    for space in db.query(FamilySpace).order_by(FamilySpace.created_at.asc()).all():
        steward = db.query(User).filter(User.id == space.steward_user_id).one_or_none()
        print(f"\n=== Space {space.id} · {space.name} ===")
        print(f"  steward: {steward.email if steward else space.steward_user_id}")

        identities = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.space_id == space.id)
            .order_by(IdentityProfile.created_at.asc())
            .all()
        )
        print(f"  --- Identity profiles ({len(identities)}) ---")
        for row in identities:
            voices = (
                db.query(VoiceProfile)
                .filter(VoiceProfile.identity_profile_id == row.id)
                .all()
            )
            sample_count = sum(
                db.query(VoiceSample)
                .filter(VoiceSample.voice_profile_id == v.id)
                .count()
                for v in voices
            )
            flags = []
            if row.linked_user_id:
                flags.append("linked-account")
            if row.archived_at:
                flags.append("ARCHIVED")
            print(
                f"    {row.id}  {row.display_name:<24} "
                f"{row.relation_label or '-':<16} {row.status:<11} "
                f"heritage={row.heritage_entity_status:<10} "
                f"voices={len(voices)} samples={sample_count} "
                f"{' '.join(flags)}"
            )


def resolve(db, *, space_id: str | None, ident: str) -> IdentityProfile | None:
    """Accept an id or an exact display name, so the caller can paste either."""
    query = db.query(IdentityProfile)
    if space_id:
        query = query.filter(IdentityProfile.space_id == space_id)
    row = query.filter(IdentityProfile.id == ident).one_or_none()
    if row:
        return row
    matches = query.filter(IdentityProfile.display_name == ident).all()
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise SystemExit(f"'{ident}' matches {len(matches)} profiles — use the id.")
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", help="Limit to one family space id.")
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Identity id or display name to keep visible. Repeatable.",
    )
    parser.add_argument(
        "--restore",
        action="append",
        default=[],
        help="Identity id or display name to bring back. Repeatable.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if not args.keep and not args.restore:
            inventory(db)
            print(
                "\nNothing changed. Re-run with --keep <id> --dry-run to preview "
                "an archive."
            )
            return

        for ident in args.restore:
            row = resolve(db, space_id=args.space, ident=ident)
            if not row:
                raise SystemExit(f"No identity matches '{ident}'.")
            print(f"restore  {row.id}  {row.display_name}")
            if args.commit:
                for voice in (
                    db.query(VoiceProfile)
                    .filter(VoiceProfile.identity_profile_id == row.id)
                    .all()
                ):
                    voice.archived_at = None
                row.archived_at = None

        if args.keep:
            keep_ids = set()
            for ident in args.keep:
                row = resolve(db, space_id=args.space, ident=ident)
                if not row:
                    raise SystemExit(f"No identity matches '{ident}'.")
                keep_ids.add(row.id)

            query = db.query(IdentityProfile).filter(
                IdentityProfile.archived_at.is_(None)
            )
            if args.space:
                query = query.filter(IdentityProfile.space_id == args.space)
            now = datetime.now(timezone.utc)
            for row in query.order_by(IdentityProfile.created_at.asc()).all():
                if row.id in keep_ids:
                    print(f"keep     {row.id}  {row.display_name}")
                    continue
                if row.linked_user_id:
                    print(f"skip     {row.id}  {row.display_name} (linked account)")
                    continue
                print(f"archive  {row.id}  {row.display_name}")
                if args.commit:
                    for voice in (
                        db.query(VoiceProfile)
                        .filter(VoiceProfile.identity_profile_id == row.id)
                        .all()
                    ):
                        voice.archived_at = now
                    row.archived_at = now

        if args.commit:
            db.commit()
            print("\nCommitted.")
        else:
            print("\nDry run — nothing written. Add --commit to apply.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
