#!/usr/bin/env python3
"""Seat the real family in a space before they ever open the app.

Firebase creates its own account the first time someone signs in, and
`upsert_user_from_claims` matches an existing Forever user by email. Creating
the row here — with the right name and membership — means mẹ signs in once and
is already home, with no invite code to type.

  ./scripts/link-family-accounts.py --space <id>
  ./scripts/link-family-accounts.py --space <id> \
      --member me@gmail.com:"Con":owner \
      --member mom@gmail.com:"Mẹ" \
      --commit

Passwords live in Firebase, never here: these rows carry no password_hash, so
dev-login cannot be used to impersonate a family member.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from nanoid import generate  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import FamilySpace, Membership, User  # noqa: E402
from app.services.handles import allocate_handle  # noqa: E402


def parse_member(raw: str) -> tuple[str, str, str]:
    parts = raw.split(":")
    if len(parts) == 2:
        email, name = parts
        role = "member"
    elif len(parts) == 3:
        email, name, role = parts
    else:
        raise SystemExit(f"--member expects email:Name[:role], got '{raw}'")
    role = role.strip().lower() or "member"
    if role not in {"owner", "member"}:
        raise SystemExit(f"Role must be owner or member, got '{role}'.")
    return email.strip().lower(), name.strip(), role


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", required=True, help="Family space id.")
    parser.add_argument(
        "--member",
        action="append",
        required=True,
        metavar="EMAIL:NAME[:ROLE]",
        help="Repeatable. Role defaults to member.",
    )
    parser.add_argument(
        "--steward",
        help="Email that should hold stewardship of this space.",
    )
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    members = [parse_member(raw) for raw in args.member]
    now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        space = (
            db.query(FamilySpace).filter(FamilySpace.id == args.space).one_or_none()
        )
        if not space:
            raise SystemExit(f"No family space with id '{args.space}'.")
        print(f"Space: {space.name} ({space.id})")

        by_email: dict[str, User] = {}
        for email, name, role in members:
            user = db.query(User).filter(User.email == email).one_or_none()
            if user:
                if user.name == name:
                    print(f"  user   exists   {email:<34} {user.name}")
                else:
                    print(f"  user   rename   {email:<34} {user.name} -> {name}")
                    if args.commit:
                        user.name = name
            else:
                print(f"  user   create   {email:<34} {name}")
                user = User(
                    id=generate(),
                    firebase_uid=None,
                    email=email,
                    phone=None,
                    name=name,
                    handle=None,
                    password_hash=None,
                    created_at=now,
                )
                if args.commit:
                    db.add(user)
                    db.flush()
                    user.handle = allocate_handle(db, name=name, email=email)
            by_email[email] = user

            membership = (
                db.query(Membership)
                .filter(
                    Membership.space_id == space.id,
                    Membership.user_id == user.id,
                )
                .one_or_none()
            )
            if membership is None:
                print(f"  member join     {email:<34} as {role}")
                if args.commit:
                    db.add(
                        Membership(
                            id=generate(),
                            space_id=space.id,
                            user_id=user.id,
                            role=role,
                            joined_at=now,
                        )
                    )
            elif membership.role != role:
                print(f"  member role     {email:<34} {membership.role} -> {role}")
                if args.commit:
                    membership.role = role
            else:
                print(f"  member ok       {email:<34} already {role}")

        if args.steward:
            steward_email = args.steward.strip().lower()
            steward = by_email.get(steward_email) or (
                db.query(User).filter(User.email == steward_email).one_or_none()
            )
            if not steward:
                raise SystemExit(f"Steward '{steward_email}' is not a known user.")
            print(f"  steward         {steward_email}")
            if args.commit:
                space.steward_user_id = steward.id

        if args.commit:
            db.commit()
            print("\nCommitted. They can sign in with Firebase using these emails.")
        else:
            print("\nDry run — nothing written. Add --commit to apply.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
