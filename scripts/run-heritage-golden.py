#!/usr/bin/env python3
"""Run the Bố Triệu heritage golden set against a local Forever API.

Needs the API on :8001 (or --api), AUTH_DEV_MODE, GEMINI_API_KEY, and an
activated heritage identity with milestones/codex already seeded.

  ./scripts/run-heritage-golden.py --identity <id>
  ./scripts/run-heritage-golden.py --identity <id> --email you@example.com
  ./scripts/run-heritage-golden.py --identity <id> --only grounded,taboo
  ./scripts/run-heritage-golden.py --identity <id> --case know_marriage_year

Space is taken from the identity row in the local DB (not from the first space
the login user happens to see). Pass --space only to override.

Each case posts one message, polls until a heritage reply appears, then scores
with hard checks from app.services.heritage_golden. Soft voice quality is not
scored here.

Context from earlier cases stays on the same family thread — that is intentional
for anti-repeat realism. Direct-thread cases open (or reuse) the caller's 1-1
room so spouse/child address is taken from the thread, not guessed from wording.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Need httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
API_DIR = ROOT / "apps" / "api"
sys.path.insert(0, str(API_DIR))

from app.services.heritage_golden import (  # noqa: E402
    filter_cases,
    load_golden_set,
    score_reply,
)

DEFAULT_API = "http://127.0.0.1:8001"
DEFAULT_GOLDEN = ROOT / "docs" / "heritage-bo-trieu" / "golden-set.json"
# Demo users — only used when they are members of the identity's space.
DEMO_SPEAKER_EMAIL = {
    "child": "con@forever.family",
    "spouse": "me@forever.family",
    "steward": "me@forever.family",
}


def _load_api_env() -> None:
    """Pull DATABASE_URL (and friends) from apps/api/.env if not already set."""
    path = API_DIR / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _identity_home(identity_id: str) -> tuple[str, str, list[str]]:
    """Return (space_id, space_name, member_emails) for this identity from DB."""
    _load_api_env()
    from app.db import SessionLocal
    from app.models import FamilySpace, IdentityProfile, Membership, User

    db = SessionLocal()
    try:
        identity = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == identity_id)
            .one_or_none()
        )
        if not identity:
            print(f"Không tìm thấy identity {identity_id} trong DB local.", file=sys.stderr)
            sys.exit(2)
        space = (
            db.query(FamilySpace)
            .filter(FamilySpace.id == identity.space_id)
            .one_or_none()
        )
        emails = [
            row.email
            for row in (
                db.query(User.email)
                .join(Membership, Membership.user_id == User.id)
                .filter(Membership.space_id == identity.space_id)
                .all()
            )
        ]
        return identity.space_id, (space.name if space else identity.space_id), emails
    finally:
        db.close()


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
        sys.exit(1)
    res.raise_for_status()
    return res.json()["token"]


def _family_heritage_thread(
    client: httpx.Client,
    api: str,
    headers: dict,
    *,
    space_id: str,
    identity_id: str,
) -> str:
    res = client.get(f"{api}/api/spaces/{space_id}/threads", headers=headers)
    res.raise_for_status()
    for thread in res.json().get("threads") or []:
        if thread.get("kind") != "heritage":
            continue
        if (thread.get("audience_scope") or "family") != "family":
            continue
        heritage = thread.get("heritage") or {}
        if heritage.get("identity_id") == identity_id:
            return thread["id"]
    print(
        f"Không thấy heritage thread family cho identity {identity_id}.",
        file=sys.stderr,
    )
    sys.exit(2)


def _direct_thread(
    client: httpx.Client,
    api: str,
    headers: dict,
    *,
    space_id: str,
    identity_id: str,
) -> str:
    res = client.post(
        f"{api}/api/spaces/{space_id}/identities/{identity_id}/direct-thread",
        headers=headers,
    )
    if res.status_code == 404:
        print(
            "Identity chưa ready / không tìm thấy — kích hoạt heritage trước.",
            file=sys.stderr,
        )
        sys.exit(2)
    res.raise_for_status()
    return res.json()["id"]


def _poll_heritage_reply(
    client: httpx.Client,
    api: str,
    headers: dict,
    *,
    thread_id: str,
    after_message_id: str,
    timeout_s: float,
    interval_s: float,
) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        res = client.get(f"{api}/api/threads/{thread_id}/messages", headers=headers)
        res.raise_for_status()
        messages = res.json().get("messages") or []
        seen_user = False
        for msg in messages:
            if msg.get("id") == after_message_id:
                seen_user = True
                continue
            if not seen_user:
                continue
            if msg.get("sender_kind") == "heritage":
                return msg
        time.sleep(interval_s)
    raise TimeoutError(
        f"No heritage reply within {timeout_s:.0f}s for message {after_message_id}"
    )


def _email_for_case(
    case: dict,
    *,
    default_email: str,
    member_emails: set[str],
) -> str:
    speaker = case.get("speaker") or "child"
    preferred = case.get("email") or DEMO_SPEAKER_EMAIL.get(speaker)
    if preferred and preferred in member_emails:
        return preferred
    return default_email


def _run_case(
    client: httpx.Client,
    api: str,
    *,
    case: dict,
    space_id: str,
    identity_id: str,
    passwords: dict[str, str],
    default_email: str,
    default_password: str,
    member_emails: set[str],
    allowed_years: list[str],
    timeout_s: float,
    interval_s: float,
) -> tuple[object, str]:
    email = _email_for_case(
        case, default_email=default_email, member_emails=member_emails
    )
    password = passwords.get(email) or default_password
    token = _login(client, api, email, password)
    headers = {"Authorization": f"Bearer {token}"}

    if (case.get("thread") or "family") == "direct":
        thread_id = _direct_thread(
            client, api, headers, space_id=space_id, identity_id=identity_id
        )
    else:
        thread_id = _family_heritage_thread(
            client, api, headers, space_id=space_id, identity_id=identity_id
        )

    send = client.post(
        f"{api}/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": case["prompt"]},
    )
    send.raise_for_status()
    user_msg = send.json()
    reply = _poll_heritage_reply(
        client,
        api,
        headers,
        thread_id=thread_id,
        after_message_id=user_msg["id"],
        timeout_s=timeout_s,
        interval_s=interval_s,
    )
    meta = reply.get("meta") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = {}
    grounding = meta.get("grounding") if isinstance(meta, dict) else None
    result = score_reply(
        case,
        reply.get("body") or "",
        allowed_years=allowed_years,
        grounding_meta=grounding if isinstance(grounding, dict) else None,
    )
    return result, reply.get("body") or ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", required=True)
    parser.add_argument(
        "--space",
        help="Override space id (mặc định: space của identity trong DB)",
    )
    parser.add_argument(
        "--email",
        default=os.environ.get("FOREVER_EMAIL"),
        help="Tài khoản member/owner của đúng không gian chứa identity",
    )
    parser.add_argument("--api", default=os.environ.get("FOREVER_API", DEFAULT_API))
    parser.add_argument(
        "--golden",
        type=Path,
        default=Path(os.environ.get("FOREVER_GOLDEN", str(DEFAULT_GOLDEN))),
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("FOREVER_PASSWORD"),
        help="Mật khẩu Forever. Bỏ trống để hỏi kín. Demo: forever123.",
    )
    parser.add_argument(
        "--only",
        help="Comma-separated categories, e.g. grounded,taboo",
    )
    parser.add_argument(
        "--case",
        action="append",
        dest="cases",
        help="Run only this case id (repeatable)",
    )
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--poll-interval", type=float, default=1.5)
    parser.add_argument(
        "--show-replies",
        action="store_true",
        help="Print each heritage reply body",
    )
    args = parser.parse_args()

    data = load_golden_set(args.golden.expanduser().resolve())
    categories = {c.strip() for c in (args.only or "").split(",") if c.strip()} or None
    only_ids = set(args.cases) if args.cases else None
    cases = filter_cases(
        data["cases"], only_categories=categories, only_ids=only_ids
    )
    if not cases:
        print("Không còn case nào sau bộ lọc.", file=sys.stderr)
        return 2

    allowed_years = [str(y) for y in (data.get("allowed_years") or [])]
    space_id, space_name, member_list = _identity_home(args.identity)
    if args.space:
        space_id = args.space
    member_emails = set(member_list)

    boot_email = args.email
    if not boot_email:
        # Prefer a real member of this space over the demo mother account.
        if len(member_list) == 1:
            boot_email = member_list[0]
        elif "me@forever.family" in member_emails:
            boot_email = "me@forever.family"
        else:
            print(
                f"Identity nằm trong «{space_name}» ({space_id}). "
                f"Thành viên: {', '.join(member_list) or '(không có)'}. "
                "Chỉ rõ --email <tài khoản trong không gian đó>.",
                file=sys.stderr,
            )
            sys.exit(2)
    if boot_email not in member_emails:
        print(
            f"{boot_email} không phải thành viên của «{space_name}» ({space_id}). "
            f"Dùng một trong: {', '.join(member_list)}",
            file=sys.stderr,
        )
        sys.exit(2)

    password = args.password
    if not password:
        password = getpass.getpass(f"Mật khẩu Forever của {boot_email}: ")
    if not password:
        print("Chưa nhập mật khẩu.", file=sys.stderr)
        return 2

    passwords: dict[str, str] = {boot_email: password}

    passed = 0
    failed = 0
    with httpx.Client(timeout=60.0) as client:
        # Warm login + membership check.
        _login(client, args.api, boot_email, password)

        print(
            f"Golden set: {len(cases)} case · identity={args.identity} · "
            f"space={space_id} ({space_name}) · as {boot_email}"
        )
        print("-" * 72)
        for case in cases:
            try:
                result, body = _run_case(
                    client,
                    args.api,
                    case=case,
                    space_id=space_id,
                    identity_id=args.identity,
                    passwords=passwords,
                    default_email=boot_email,
                    default_password=password,
                    member_emails=member_emails,
                    allowed_years=allowed_years,
                    timeout_s=args.timeout,
                    interval_s=args.poll_interval,
                )
            except TimeoutError as exc:
                print(f"FAIL  {case['id']:<28} timeout: {exc}")
                failed += 1
                continue
            except httpx.HTTPError as exc:
                print(f"FAIL  {case['id']:<28} http: {exc}")
                failed += 1
                continue

            mark = "PASS" if result.passed else "FAIL"
            if result.passed:
                passed += 1
                print(f"{mark}  {case['id']:<28} [{case.get('category')}]")
            else:
                failed += 1
                detail = "; ".join(result.failures)
                print(f"{mark}  {case['id']:<28} [{case.get('category')}] {detail}")
            if args.show_replies:
                preview = body.replace("\n", " ").strip()
                if len(preview) > 160:
                    preview = preview[:157] + "…"
                print(f"      → {preview}")

    print("-" * 72)
    print(f"{passed} passed · {failed} failed · {passed + failed} total")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
