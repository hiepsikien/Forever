"""Mẹ signs in once and is already home.

We seat a family member in a space before she ever opens the app (see
`scripts/link-family-accounts.py`): a User row with her email, her name, and a
membership — but no Firebase uid yet, because Firebase only mints one when she
first signs in. This is the seam where that pre-seeded row meets the real
account, and getting it wrong is visible and personal: she would either land in
an empty app with no family, or find herself renamed to `lethidinh315`.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from nanoid import generate

from app.auth import TokenClaims, upsert_user_from_claims
from app.db import SessionLocal
from app.models import FamilySpace, Membership, User


@pytest.fixture()
def seated_member():
    """A member seated in a space, exactly as the linking script leaves her."""
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    slug = f"me-onboarding-{generate(size=8)}"
    email = f"{slug}@example.com"
    user = User(
        id=generate(),
        firebase_uid=None,
        email=email,
        phone=None,
        name="Mẹ",
        handle=slug,
        password_hash=None,
        created_at=now,
    )
    db.add(user)
    db.flush()
    space = FamilySpace(
        id=generate(),
        name="Nhà mình",
        created_by=user.id,
        steward_user_id=user.id,
        created_at=now,
    )
    db.add(space)
    db.flush()
    db.add(
        Membership(
            id=generate(),
            space_id=space.id,
            user_id=user.id,
            role="member",
            joined_at=now,
        )
    )
    db.commit()
    yield db, space, user.id, email
    db.close()


def test_first_firebase_sign_in_lands_in_the_family_she_was_seated_in(seated_member):
    db, space, user_id, email = seated_member
    uid = f"firebase-{generate(size=8)}"

    linked = upsert_user_from_claims(
        db,
        TokenClaims(
            uid=uid,
            email=email,
            name=email.split("@")[0],
            phone=None,
            has_display_name=False,
        ),
    )

    assert linked.id == user_id, "matched by email instead of creating a second account"
    assert linked.firebase_uid == uid
    memberships = db.query(Membership).filter(Membership.user_id == linked.id).all()
    assert [(m.space_id, m.role) for m in memberships] == [(space.id, "member")]


def test_an_email_derived_name_does_not_overwrite_the_one_we_chose(seated_member):
    """Firebase email/password carries no display name, so it must not rename her."""
    db, _space, _user_id, email = seated_member

    linked = upsert_user_from_claims(
        db,
        TokenClaims(
            uid=f"firebase-{generate(size=8)}",
            # what Firebase falls back to: the local part of the address
            email=email,
            name=email.split("@")[0],
            phone=None,
            has_display_name=False,
        ),
    )

    assert linked.name == "Mẹ"


def test_a_real_display_name_is_allowed_through(seated_member):
    db, _space, _user_id, email = seated_member

    linked = upsert_user_from_claims(
        db,
        TokenClaims(
            uid=f"firebase-{generate(size=8)}",
            email=email,
            name="Lê Thị Định",
            phone=None,
            has_display_name=True,
        ),
    )

    assert linked.name == "Lê Thị Định"
