#!/usr/bin/env python3
"""Upload the 2016 Triệu–Định album photos into the library and register keepsakes.

Source is the Word album extract (not a blind rsync of apps/api/uploads):

  data/heritage-bo-trieu/album-2016/catalog.json
  data/heritage-bo-trieu/album-2016/images/*.jpg

Local:

  ./scripts/extract-album-2016.py
  ./scripts/import-keepsakes.py --dry-run
  ./scripts/import-keepsakes.py --ready

Production (Firebase email/password; skips titles already tagged nguon:album-2016):

  FOREVER_API=https://forever-api.antunai.com \\
  FOREVER_EMAIL=anh.nguyendinh.cs@gmail.com \\
    ./scripts/import-keepsakes.py --ready
"""

from __future__ import annotations

import argparse
import getpass
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import httpx
except ImportError:
    print("Need httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / "data" / "heritage-bo-trieu" / "album-2016"
DEFAULT_API = "http://127.0.0.1:8001"
PROD_API = "https://forever-api.antunai.com"
ALBUM_TAG = "nguon:album-2016"
OPENER = (
    "Nhà mình nhớ tấm này không? Anh giữ vì nó quý — ai nhớ hôm ấy thì kể lại giúp anh."
)
# Public web API key (same as the mobile app). Used only to mint an ID token.
FIREBASE_API_KEY = os.environ.get(
    "EXPO_PUBLIC_FIREBASE_API_KEY",
    "AIzaSyDS9CTQu0rUrhXkqqH1BoLEBm7sl7jBAl8",
)


def _is_local_api(api: str) -> bool:
    host = (urlparse(api).hostname or "").lower()
    return host in {"127.0.0.1", "localhost"}


def _firebase_id_token(email: str, password: str) -> str:
    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={FIREBASE_API_KEY}"
    )
    res = httpx.post(
        url,
        json={
            "email": email,
            "password": password,
            "returnSecureToken": True,
        },
        timeout=30.0,
    )
    if res.status_code != 200:
        print(f"Firebase đăng nhập thất bại cho {email}: {res.text}", file=sys.stderr)
        sys.exit(1)
    return res.json()["idToken"]


def _login(client: httpx.Client, api: str, email: str, password: str) -> str:
    if not _is_local_api(api):
        return _firebase_id_token(email, password)
    res = client.post(
        f"{api}/api/auth/dev-login", json={"email": email, "password": password}
    )
    if res.status_code == 404:
        print(
            "Dev-login tắt trên API này. Dùng FOREVER_API=https://forever-api.antunai.com "
            "và email Firebase.",
            file=sys.stderr,
        )
        sys.exit(1)
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


def _pick_space(rows: list[dict], wanted: str | None) -> dict:
    if wanted:
        for row in rows:
            if row["id"] == wanted:
                return row
        raise SystemExit(f"Không thấy space {wanted}")
    if not rows:
        raise SystemExit("Không có family space.")
    return rows[0]


def _pick_identity(rows: list[dict], wanted: str | None) -> dict:
    living = [r for r in rows if not r.get("archived_at")]
    if wanted:
        for row in living:
            if row["id"] == wanted:
                return row
        raise SystemExit(f"Không thấy hồ sơ {wanted}")
    remembered = [r for r in living if r.get("status") == "remembered"]
    for row in remembered:
        name = (row.get("display_name") or "").lower()
        rel = (row.get("relation_label") or "").strip()
        if "triệu" in name or rel == "Bố":
            return row
    if len(remembered) == 1:
        return remembered[0]
    raise SystemExit("Chỉ định --identity (hồ sơ người đã mất).")


def _album_titles(memories: list[dict]) -> set[str]:
    out: set[str] = set()
    for item in memories:
        tags = item.get("tags") or ""
        if ALBUM_TAG not in tags:
            continue
        title = (item.get("title") or "").strip()
        if title:
            out.add(title)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--api", default=os.environ.get("FOREVER_API", DEFAULT_API))
    parser.add_argument("--space")
    parser.add_argument("--identity")
    parser.add_argument("--email", default=os.environ.get("FOREVER_EMAIL"))
    parser.add_argument("--password", default=os.environ.get("FOREVER_PASSWORD"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--ready",
        action="store_true",
        help="Mark new keepsakes ready so they appear on the home card.",
    )
    args = parser.parse_args()

    src = args.src.expanduser().resolve()
    catalog_path = src / "catalog.json"
    if not catalog_path.exists():
        print(
            f"Chưa có {catalog_path}. Chạy ./scripts/extract-album-2016.py trước.",
            file=sys.stderr,
        )
        return 2
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    photos = catalog.get("photos") or []
    print(f"{len(photos)} ảnh trong catalog ({catalog.get('source_name') or src.name})")
    if args.dry_run:
        for photo in photos[:8]:
            print(
                f"  {photo['file']}  {photo.get('occurred_at') or '—'}  "
                f"{photo['title'][:60]}"
            )
        if len(photos) > 8:
            print(f"  … và {len(photos) - 8} tấm nữa")
        return 0

    default_email = (
        "me@forever.family"
        if _is_local_api(args.api)
        else "anh.nguyendinh.cs@gmail.com"
    )
    email = args.email or default_email
    password = args.password or getpass.getpass(f"Mật khẩu Forever của {email}: ")
    if not password:
        print("Chưa nhập mật khẩu.", file=sys.stderr)
        return 2

    status = "ready" if args.ready else "draft"
    with httpx.Client(timeout=120.0) as client:
        token = _login(client, args.api, email, password)
        headers = {"Authorization": f"Bearer {token}"}
        spaces = client.get(f"{args.api}/api/spaces", headers=headers)
        spaces.raise_for_status()
        space = _pick_space(spaces.json().get("spaces") or [], args.space)
        space_id = space["id"]
        print(f"Space: {space.get('name')} ({space_id})")

        idents = client.get(
            f"{args.api}/api/spaces/{space_id}/identities", headers=headers
        )
        idents.raise_for_status()
        identity = _pick_identity(idents.json().get("identities") or [], args.identity)
        identity_id = identity["id"]
        print(
            f"Hồ sơ: {identity.get('display_name')} · "
            f"{identity.get('relation_label')} ({identity_id})"
        )

        listed = client.get(
            f"{args.api}/api/spaces/{space_id}/memories", headers=headers
        )
        listed.raise_for_status()
        already = _album_titles(listed.json().get("memories") or [])
        print(f"Đã có {len(already)} tấm album-2016 trên API này")

        imported = 0
        skipped = 0
        for photo in photos:
            title = (photo.get("title") or "").strip()
            if title and title in already:
                skipped += 1
                continue
            path = src / photo["file"]
            if not path.exists():
                print(f"Thiếu file {path}", file=sys.stderr)
                skipped += 1
                continue
            mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
            tags = f"heritage:{identity_id} {ALBUM_TAG}"
            data = {
                "kind": "photo",
                "title": title,
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
                    "identity_id": identity_id,
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
            already.add(title)
            if imported % 10 == 0:
                print(f"  … {imported}/{len(photos)}")
        print(f"Xong: {imported} ảnh mới ({status}), bỏ {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
