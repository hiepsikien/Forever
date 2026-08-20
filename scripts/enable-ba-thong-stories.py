#!/usr/bin/env python3
"""Enable classics / sutras on Bà Nội's storytelling shelf.

Includes Phạm Công – Cúc Hoa (catalog slot; Nhập chữ when family has the book).

Run inside forever-api after corpus seed (API boot with data/storytelling in image):

  docker exec -e PYTHONPATH=/app forever-api \\
    python /tmp/enable-ba-thong-stories.py

Or from Mac after deploy:

  ./scripts/enable-ba-thong-stories-prod.sh
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from nanoid import generate

SLUGS = ("kieu", "luc_van_tien", "pham_cong_cuc_hoa", "kinh_duoc_su")
OWNER_EMAIL = "anh.nguyendinh.cs@gmail.com"


def _api_dir() -> Path:
    here = Path(__file__).resolve()
    for candidate in (Path("/app"), here.parent, here.parents[1] / "apps" / "api"):
        if (candidate / "app" / "db.py").exists():
            return candidate
    raise SystemExit("Cannot find API package (app/db.py).")


API_DIR = _api_dir()
sys.path.insert(0, str(API_DIR))
os.chdir(API_DIR)

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    IdentityProfile,
    IdentityStoryWork,
    StoryWork,
    User,
)


def main() -> int:
    db = SessionLocal()
    try:
        ba = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.display_name == "Đoàn Thị Thông",
                IdentityProfile.relation_label == "Bà Nội",
                IdentityProfile.status == "remembered",
            )
            .one_or_none()
        )
        if not ba:
            print("Bà Nội (Đoàn Thị Thông) not found on this database.", file=sys.stderr)
            return 1
        owner = db.query(User).filter(User.email == OWNER_EMAIL).one_or_none()
        if not owner:
            print(f"Owner {OWNER_EMAIL} not found.", file=sys.stderr)
            return 1
        now = datetime.now(timezone.utc)
        for slug in SLUGS:
            work = db.query(StoryWork).filter(StoryWork.slug == slug).one_or_none()
            if not work:
                print(f"missing story_works.{slug} — redeploy so seed runs", file=sys.stderr)
                return 1
            existing = (
                db.query(IdentityStoryWork)
                .filter(
                    IdentityStoryWork.identity_id == ba.id,
                    IdentityStoryWork.work_id == work.id,
                )
                .one_or_none()
            )
            if existing:
                print(f"already enabled: {slug}")
                continue
            db.add(
                IdentityStoryWork(
                    id=generate(),
                    space_id=ba.space_id,
                    identity_id=ba.id,
                    work_id=work.id,
                    enabled_by=owner.id,
                    enabled_at=now,
                )
            )
            print(f"enabled: {slug} → {ba.id}")
        db.commit()
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
