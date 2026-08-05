#!/usr/bin/env python3
"""Push reviewed OCR poems into the Forever library as kind=poem.

Only files with "review_status": "approved" are sent — the steward review in
docs/heritage-bo-trieu/STEWARD-NEXT.md step 3 is the gate.

  ./scripts/import-poems.sh --list                    # what is approved so far
  ./scripts/import-poems.sh --identity <id> --dry-run
  ./scripts/import-poems.sh --identity <id>
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Need httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / "data" / "heritage-bo-trieu" / "poetry-ocr"
DEFAULT_API = "http://127.0.0.1:8001"
APPROVED = "approved"


def _load_pages(src: Path) -> list[dict]:
    files = sorted(p for p in src.glob("*.json") if p.name != "manifest.json")
    if not files:
        print(f"No JSON in {src}", file=sys.stderr)
        sys.exit(2)
    return [json.loads(p.read_text(encoding="utf-8")) | {"_file": p.name} for p in files]


def _poems_from(pages: list[dict], *, require_approved: bool) -> tuple[list[dict], list[str]]:
    poems: list[dict] = []
    held: list[str] = []
    for page in pages:
        if not page.get("poems"):
            continue
        status = page.get("review_status") or "needs_review"
        if require_approved and status != APPROVED:
            held.append(f"{page['_file']} (trang {page.get('page_label')}) — {status}")
            continue
        for poem in page["poems"]:
            poems.append(
                {
                    "title": poem.get("title") or "",
                    "body": poem.get("body") or "",
                    "body_tts": poem.get("body_tts") or "",
                    "meter": poem.get("meter") or "unknown",
                    "themes": poem.get("themes") or [],
                    "composed_on": poem.get("composed_on"),
                    "source_name": page.get("source_name") or page["_file"],
                    "page_label": str(page.get("page_label") or "") or None,
                }
            )
    return poems, held


def _login(client: httpx.Client, api: str, email: str, password: str) -> str:
    res = client.post(
        f"{api}/api/auth/dev-login", json={"email": email, "password": password}
    )
    if res.status_code == 401:
        detail = ""
        try:
            detail = res.json().get("error") or res.json().get("detail") or ""
        except ValueError:
            detail = res.text
        print(f"Đăng nhập thất bại cho {email}: {detail}", file=sys.stderr)
        print(
            "Đây là mật khẩu bạn dùng trên app Forever, không phải mật khẩu Gmail.",
            file=sys.stderr,
        )
        sys.exit(1)
    res.raise_for_status()
    return res.json()["token"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--api", default=os.environ.get("FOREVER_API", DEFAULT_API))
    parser.add_argument("--space")
    parser.add_argument("--identity")
    parser.add_argument("--email", default=os.environ.get("FOREVER_EMAIL", "me@forever.family"))
    parser.add_argument(
        "--password",
        default=os.environ.get("FOREVER_PASSWORD"),
        help="Bỏ trống để script hỏi kín (an toàn hơn biến môi trường)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--list", action="store_true", help="Show review status per page, send nothing"
    )
    parser.add_argument(
        "--include-unreviewed",
        action="store_true",
        help="Send pages still marked needs_review (not recommended)",
    )
    args = parser.parse_args()

    pages = _load_pages(args.src.expanduser().resolve())
    poems, held = _poems_from(pages, require_approved=not args.include_unreviewed)

    if args.list:
        for page in pages:
            count = len(page.get("poems") or [])
            if not count:
                continue
            status = page.get("review_status") or "needs_review"
            titles = ", ".join(p.get("title") or "(không đề)" for p in page["poems"])
            print(f"{status:<13} trang {str(page.get('page_label')):<5} {titles}")
        print(f"\nSẵn sàng gửi: {len(poems)} bài · đang chờ duyệt: {len(held)} trang")
        return 0

    if held:
        print(f"Bỏ qua {len(held)} trang chưa duyệt:", file=sys.stderr)
        for line in held:
            print(f"  - {line}", file=sys.stderr)
    if not poems:
        print(
            'Chưa có bài nào approved. Sửa "review_status": "approved" trong JSON '
            "rồi chạy lại (hoặc --include-unreviewed).",
            file=sys.stderr,
        )
        return 2
    if not args.identity:
        print("--identity <identity_id> là bắt buộc.", file=sys.stderr)
        return 2

    password = args.password
    if not password:
        password = getpass.getpass(f"Mật khẩu Forever của {args.email}: ")
    if not password:
        print("Chưa nhập mật khẩu.", file=sys.stderr)
        return 2

    with httpx.Client(timeout=60.0) as client:
        token = _login(client, args.api, args.email, password)
        headers = {"Authorization": f"Bearer {token}"}
        space_id = args.space
        if not space_id:
            spaces = client.get(f"{args.api}/api/spaces", headers=headers)
            spaces.raise_for_status()
            rows = spaces.json().get("spaces") or []
            if len(rows) != 1:
                print(
                    f"Có {len(rows)} không gian — chỉ rõ --space <id>.", file=sys.stderr
                )
                return 2
            space_id = rows[0]["id"]

        res = client.post(
            f"{args.api}/api/spaces/{space_id}/memories/poems/import",
            headers=headers,
            json={
                "identity_id": args.identity,
                "poems": poems,
                "dry_run": args.dry_run,
            },
        )
        if res.status_code == 403:
            print(
                f"{args.email} không phải Owner/Steward của không gian này — "
                "đăng nhập bằng tài khoản chủ nhà (--email).",
                file=sys.stderr,
            )
            return 1
        if res.status_code != 200:
            print(f"HTTP {res.status_code}: {res.text}", file=sys.stderr)
            return 1
        data = res.json()

    if data.get("dry_run"):
        print(f"[dry-run] sẽ import {data['would_import']} bài")
        for title in data.get("titles", []):
            print(f"  + {title}")
    else:
        print(f"Đã import {data['imported']} bài vào Thư viện")
        for memory in data.get("memories", []):
            print(f"  + {memory['title']}")
    for skip in data.get("skipped", []):
        print(f"  - bỏ qua {skip['title'] or '(không đề)'}: {skip['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
