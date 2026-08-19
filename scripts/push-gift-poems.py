#!/usr/bin/env python3
"""Copy local `tho:tang` poems onto production Postgres.

Local and family production already share space `5K__lcaDoIozrdKA5r0NL` and
Bố identity `XLLFcmmNSIiWIOhc2vwYw`. This copies only gift poems, new ids,
skips body duplicates, and does not touch own/OCR poems or identity lock.

  ./scripts/push-gift-poems.py              # dry-run
  ./scripts/push-gift-poems.py --apply
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SPACE_ID = "5K__lcaDoIozrdKA5r0NL"
HOST = "angi-vm"
NANOID_ALPHABET = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

DUMP_SQL = (
    "SELECT row_to_json(x) FROM ("
    " SELECT title, body, body_tts, tags, visibility, created_by, occurred_at, created_at"
    f" FROM memory_items WHERE kind = 'poem' AND space_id = '{SPACE_ID}'"
    " AND tags LIKE '%tho:tang%' ORDER BY created_at, title"
    ") x"
)

EXISTING_SQL = (
    "SELECT json_build_object('body', body) FROM memory_items"
    f" WHERE kind = 'poem' AND space_id = '{SPACE_ID}'"
)

COPY_IN = (
    "COPY memory_items ("
    " id, space_id, created_by, kind, title, body, body_tts,"
    " recite_media_path, recite_fingerprint, media_path, media_mime,"
    " source_message_id, tags, visibility, occurred_at, created_at"
    r") FROM STDIN WITH (FORMAT csv, NULL '\N')"
)


def _nanoid(size: int = 21) -> str:
    return "".join(secrets.choice(NANOID_ALPHABET) for _ in range(size))


def _fingerprint(body: str) -> str:
    return "\n".join(
        ln.strip() for ln in (body or "").strip().splitlines() if ln.strip()
    ).lower()


def _local_psql(sql: str) -> str:
    proc = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "db",
            "psql",
            "-U",
            "forever",
            "-d",
            "forever",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-c",
            sql,
        ],
        check=False,
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout, file=sys.stderr)
        raise SystemExit(proc.returncode)
    return proc.stdout


def _prod_psql(sql: str, stdin: str | None = None) -> str:
    remote = (
        "docker exec -i deploy-postgres-1 "
        "psql -U forever -d forever -v ON_ERROR_STOP=1 "
        + ("-At " if "FROM STDIN" not in sql else "")
        + "-c " + json.dumps(sql)
    )
    proc = subprocess.run(
        ["ssh", HOST, remote],
        check=False,
        capture_output=True,
        text=True,
        input=stdin,
    )
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout, file=sys.stderr)
        raise SystemExit(proc.returncode)
    return proc.stdout


def _parse_dump(raw: str) -> list[dict]:
    rows: list[dict] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("COPY") or line == "\\.":
            continue
        rows.append(json.loads(line))
    return rows


def _parse_bodies(raw: str) -> list[str]:
    bodies: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        bodies.append(json.loads(line)["body"] or "")
    return bodies


def _ts(value: str | None) -> str:
    if not value:
        return r"\N"
    # row_to_json yields "2026-08-12T06:11:00+00:00"
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Insert into production (default is dry-run)",
    )
    args = parser.parse_args()

    local_rows = _parse_dump(_local_psql(DUMP_SQL))
    prod_bodies = _parse_bodies(_prod_psql(EXISTING_SQL))
    existing = {_fingerprint(b) for b in prod_bodies}

    to_insert: list[dict] = []
    skipped = 0
    seen_local: set[str] = set()
    for row in local_rows:
        fp = _fingerprint(row.get("body") or "")
        if not fp or fp in existing or fp in seen_local:
            skipped += 1
            continue
        seen_local.add(fp)
        existing.add(fp)
        to_insert.append(row)

    print(
        f"Local gift poems: {len(local_rows)}  "
        f"would_insert: {len(to_insert)}  skip_duplicate: {skipped}"
    )
    for row in to_insert[:20]:
        print(f"  + {row.get('title') or '(không đề)'}")
    if len(to_insert) > 20:
        print(f"  … {len(to_insert) - 20} more")

    if not args.apply:
        print("Dry-run only. Re-run with --apply to write production.")
        return 0
    if not to_insert:
        print("Nothing to insert.")
        return 0

    buf = io.StringIO()
    writer = csv.writer(buf)
    now = datetime.now(timezone.utc).isoformat()
    for row in to_insert:
        writer.writerow(
            [
                _nanoid(),
                SPACE_ID,
                row["created_by"],
                "poem",
                row.get("title") or "",
                row.get("body") or "",
                row.get("body_tts") or "",
                r"\N",
                "",
                r"\N",
                r"\N",
                r"\N",
                row.get("tags") or "",
                row.get("visibility") or "family",
                _ts(row.get("occurred_at")),
                _ts(row.get("created_at")) if row.get("created_at") else now,
            ]
        )

    _prod_psql(COPY_IN, stdin=buf.getvalue())
    print(f"Inserted {len(to_insert)} gift poems on production.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
