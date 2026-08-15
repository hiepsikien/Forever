#!/usr/bin/env python3
"""Upload extracted album photos into the library and register keepsakes.

Requires a running API and extract output:

  ./scripts/extract-album-2016.py
  ./scripts/import-keepsakes.py --identity <id> --dry-run
  ./scripts/import-keepsakes.py --identity <id> --ready
"""

from __future__ import annotations

import argparse
import getpass
import json
import mimetypes
import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Need httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / "data" / "heritage-bo-trieu" / "album-2016"
DEFAULT_API = "http://127.0.0.1:8001"
ALBUM_TAG = "nguon:album-2016"
OPENER = (
    "Nhà mình nhớ tấm này không? Anh giữ vì nó quý — ai nhớ hôm ấy thì kể lại giúp anh."
)


def _login(client: httpx.Client, api: str, email: str, password: str) -> str:
    res = client.post(
        f"{api}/api/auth/dev-login", json={"email": email, "password": password}
    )
    if res.status_code == 401:
        print(f"Đăng nhập thất bại cho {email}", file=sys.stderr)
        sys.exit(1)
    res.raise_for_status()
    return res.json()["token"]


def _opener(caption: str) -> str:
    cap = (caption or "").strip()
    if not cap:
        return OPENER
    return f"{OPENER} Anh ghi: {cap[:120]}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--api", default=os.environ.get("FOREVER_API", DEFAULT_API))
    parser.add_argument("--space")
    parser.add_argument("--identity", required=True)
    parser.add_argument("--email", default=os.environ.get("FOREVER_EMAIL", "me@forever.family"))
    parser.add_argument("--password", default=os.environ.get("FOREVER_PASSWORD"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--ready",
        action="store_true",
        help="Mark new keepsakes ready so they appear on the home card (for testing).",
    )
    args = parser.parse_args()

    src = args.src.expanduser().resolve()
    catalog_path = src / "catalog.json"
    if not catalog_path.exists():
        print(f"Chưa có {catalog_path}. Chạy ./scripts/extract-album-2016.py trước.", file=sys.stderr)
        return 2
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    photos = catalog.get("photos") or []
    print(f"{len(photos)} ảnh trong catalog")
    if args.dry_run:
        for photo in photos[:8]:
            print(f"  {photo['file']}  {photo.get('occurred_at') or '—'}  {photo['title'][:60]}")
        if len(photos) > 8:
            print(f"  … và {len(photos) - 8} tấm nữa")
        return 0

    password = args.password or getpass.getpass(f"Mật khẩu Forever của {args.email}: ")
    if not password:
        print("Chưa nhập mật khẩu.", file=sys.stderr)
        return 2

    status = "ready" if args.ready else "draft"
    with httpx.Client(timeout=120.0) as client:
        token = _login(client, args.api, args.email, password)
        headers = {"Authorization": f"Bearer {token}"}
        space_id = args.space
        if not space_id:
            spaces = client.get(f"{args.api}/api/spaces", headers=headers)
            spaces.raise_for_status()
            rows = spaces.json().get("spaces") or []
            if not rows:
                print("Không có family space.", file=sys.stderr)
                return 2
            space_id = rows[0]["id"]
            print(f"Space: {rows[0].get('name')} ({space_id})")

        imported = 0
        skipped = 0
        for photo in photos:
            path = src / photo["file"]
            if not path.exists():
                print(f"Thiếu file {path}", file=sys.stderr)
                skipped += 1
                continue
            mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
            tags = f"heritage:{args.identity} {ALBUM_TAG}"
            data = {
                "kind": "photo",
                "title": photo.get("title") or "",
                "body": photo.get("body") or "",
                "tags": tags,
            }
            if photo.get("occurred_at"):
                data["occurred_at"] = photo["occurred_at"]
            upload = client.post(
                f"{args.api}/api/spaces/{space_id}/memories/upload",
                headers=headers,
                data=data,
                files={"file": (path.name, path.read_bytes(), mime)},
            )
            if upload.status_code != 200:
                print(f"Upload lỗi {path.name}: {upload.text}", file=sys.stderr)
                skipped += 1
                continue
            memory_id = upload.json()["id"]
            keep = client.post(
                f"{args.api}/api/spaces/{space_id}/keepsakes/from-memory",
                headers=headers,
                json={
                    "identity_id": args.identity,
                    "memory_id": memory_id,
                    "opener": _opener(photo.get("body") or ""),
                    "status": status,
                },
            )
            if keep.status_code != 200:
                print(f"Keepsake lỗi {path.name}: {keep.text}", file=sys.stderr)
                skipped += 1
                continue
            imported += 1
            if imported % 10 == 0:
                print(f"  … {imported}/{len(photos)}")
        print(f"Xong: {imported} ảnh vào thư viện ({status}), bỏ {skipped}")
    return 0 if skipped == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
