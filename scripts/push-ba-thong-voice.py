#!/usr/bin/env python3
"""Copy local Voice DNA for bà Đoàn Thị Thông onto a running API database.

Export (Mac, local Postgres):

  python scripts/push-ba-thong-voice.py export --out /tmp/ba-thong-voice

Apply (inside forever-api):

  python /tmp/push-ba-thong-voice.py apply --bundle /tmp/ba-thong-voice/bundle.json

Does not clone again — reuses the MiniMax provider_voice_id already on the
account. Extract job FKs are cleared so samples still land without the jobs.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

IDENTITY_ID = "8lG3gBexT6a2CBN6f-y7B"
VOICE_ID = "Y1UgFkyFH7tOdv31DbwCM"
OWNER_EMAIL = "anh.nguyendinh.cs@gmail.com"


def _api_dir() -> Path:
    here = Path(__file__).resolve()
    candidates = [
        Path("/app"),
        here.parent,
        here.parents[1] / "apps" / "api",
    ]
    for candidate in candidates:
        if (candidate / "app" / "db.py").exists():
            return candidate
    raise SystemExit("Cannot find API package (app/db.py).")


API_DIR = _api_dir()
sys.path.insert(0, str(API_DIR))
# Settings reads `.env` from cwd (apps/api/.env locally, container env on prod).
os.chdir(API_DIR)

from sqlalchemy import inspect as sa_inspect  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    FamilySpace,
    IdentityProfile,
    Thread,
    User,
    VoiceProfile,
    VoiceSample,
)


def _jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _row_dict(row) -> dict:
    mapper = sa_inspect(row.__class__)
    return {col.key: _jsonable(getattr(row, col.key)) for col in mapper.column_attrs}


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def cmd_export(out_dir: Path) -> None:
    uploads = API_DIR / "uploads"
    out_dir.mkdir(parents=True, exist_ok=True)
    files_dir = out_dir / "uploads"
    files_dir.mkdir(exist_ok=True)

    db = SessionLocal()
    try:
        identity = db.query(IdentityProfile).filter(IdentityProfile.id == IDENTITY_ID).one()
        voice = db.query(VoiceProfile).filter(VoiceProfile.id == VOICE_ID).one()
        thread = None
        if identity.heritage_thread_id:
            thread = (
                db.query(Thread).filter(Thread.id == identity.heritage_thread_id).one_or_none()
            )
        samples = (
            db.query(VoiceSample)
            .filter(VoiceSample.voice_profile_id == voice.id)
            .order_by(VoiceSample.created_at.asc())
            .all()
        )
        copied = []
        missing = []
        for sample in samples:
            rel = sample.media_path
            src = uploads / rel
            dest = files_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not src.is_file():
                missing.append(rel)
                continue
            shutil.copy2(src, dest)
            copied.append(rel)
        if missing:
            raise SystemExit(f"Missing {len(missing)} sample files, e.g. {missing[0]}")

        bundle = {
            "owner_email": OWNER_EMAIL,
            "space_id": identity.space_id,
            "thread": _row_dict(thread) if thread else None,
            "identity": _row_dict(identity),
            "voice": _row_dict(voice),
            "samples": [_row_dict(s) for s in samples],
        }
        (out_dir / "bundle.json").write_text(
            json.dumps(bundle, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(
            f"Exported {identity.display_name}: "
            f"{len(samples)} samples, {len(copied)} files, "
            f"clone={voice.provider_voice_id}"
        )
        print(f"Bundle: {out_dir / 'bundle.json'}")
    finally:
        db.close()


def _upsert(db: Session, model, data: dict, *, skip: set[str] | None = None):
    skip = skip or set()
    mapper = sa_inspect(model)
    allowed = {col.key for col in mapper.column_attrs}
    payload = {k: v for k, v in data.items() if k in allowed and k not in skip}
    for key, value in list(payload.items()):
        col = mapper.columns[key]
        if hasattr(col.type, "python_type") and col.type.python_type is datetime:
            payload[key] = _parse_dt(value)
    row = db.get(model, payload["id"])
    if row is None:
        row = model(**payload)
        db.add(row)
        return "insert"
    for key, value in payload.items():
        if key == "id":
            continue
        setattr(row, key, value)
    return "update"


def cmd_apply(bundle_path: Path, *, dry_run: bool) -> None:
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        owner = db.query(User).filter(User.email == bundle["owner_email"]).one_or_none()
        if not owner:
            raise SystemExit(f"Owner not found: {bundle['owner_email']}")
        space = db.get(FamilySpace, bundle["space_id"])
        if not space:
            raise SystemExit(f"Space not found: {bundle['space_id']}")

        def remap_user(data: dict, *keys: str) -> dict:
            out = dict(data)
            for key in keys:
                if out.get(key):
                    out[key] = owner.id
            return out

        local_identity = bundle["identity"]
        existing = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.space_id == bundle["space_id"],
                IdentityProfile.display_name == local_identity["display_name"],
            )
            .one_or_none()
        )

        actions = []
        target_identity_id = local_identity["id"]

        if existing and existing.id != local_identity["id"]:
            # Production already has this person under another id. Fold the
            # local Voice DNA into that row instead of creating a duplicate.
            target_identity_id = existing.id
            merged = remap_user(
                local_identity,
                "created_by",
                "linked_user_id",
                "profile_reviewed_by",
            )
            merged["id"] = existing.id
            merged["heritage_thread_id"] = existing.heritage_thread_id
            merged["created_by"] = existing.created_by
            merged["created_at"] = existing.created_at.isoformat()
            actions.append(("identity", _upsert(db, IdentityProfile, merged)))
            print(
                f"Merging into existing identity {existing.id} "
                f"(local id {local_identity['id']} not inserted)"
            )
        else:
            thread_data = bundle.get("thread")
            if thread_data:
                thread_data = remap_user(thread_data, "member_user_id")
                actions.append(("thread", _upsert(db, Thread, thread_data)))
            identity = remap_user(
                local_identity,
                "created_by",
                "linked_user_id",
                "profile_reviewed_by",
            )
            actions.append(("identity", _upsert(db, IdentityProfile, identity)))

        local_voice = remap_user(
            bundle["voice"], "created_by", "subject_user_id", "consented_by_user_id"
        )
        existing_voice = (
            db.query(VoiceProfile)
            .filter(VoiceProfile.identity_profile_id == target_identity_id)
            .order_by(VoiceProfile.created_at.asc())
            .first()
        )
        target_voice_id = local_voice["id"]
        if existing_voice and existing_voice.id != local_voice["id"]:
            target_voice_id = existing_voice.id
            local_voice["id"] = existing_voice.id
            local_voice["created_by"] = existing_voice.created_by
            local_voice["created_at"] = existing_voice.created_at.isoformat()
            print(
                f"Reusing voice {existing_voice.id} "
                f"(local voice {bundle['voice']['id']} not inserted)"
            )
        local_voice["identity_profile_id"] = target_identity_id
        actions.append(("voice", _upsert(db, VoiceProfile, local_voice)))

        sample_stats = {"insert": 0, "update": 0}
        for sample in bundle["samples"]:
            sample = remap_user(sample, "created_by")
            sample["voice_profile_id"] = target_voice_id
            action = _upsert(
                db,
                VoiceSample,
                sample,
                skip={"extract_job_id", "extract_segment_id"},
            )
            sample_stats[action] += 1

        print(f"Owner {owner.email} ({owner.id})")
        print(f"Space {space.name} ({space.id})")
        print("Actions:", ", ".join(f"{k}={v}" for k, v in actions))
        print(
            f"Samples insert={sample_stats['insert']} update={sample_stats['update']} "
            f"total={len(bundle['samples'])}"
        )
        print(
            f"Clone {bundle['voice']['provider']} "
            f"{bundle['voice']['provider_voice_id']} "
            f"status={bundle['voice']['status']}"
        )
        if dry_run:
            db.rollback()
            print("dry-run: rolled back")
        else:
            db.commit()
            print("committed")
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    export_p = sub.add_parser("export")
    export_p.add_argument("--out", type=Path, required=True)

    apply_p = sub.add_parser("apply")
    apply_p.add_argument("--bundle", type=Path, required=True)
    apply_p.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    if args.cmd == "export":
        cmd_export(args.out)
    else:
        cmd_apply(args.bundle, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
