#!/usr/bin/env python3
"""Rebuild storytelling chunk JSON from *.lines.txt (after editing line files)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "apps" / "api" / "data" / "storytelling"
COUPLETS_PER_CHUNK = 10


def chunk_lines(lines: list[str], work_slug: str, title: str, author: str, source: str) -> dict:
    chunks = []
    i = 0
    idx = 1
    step = COUPLETS_PER_CHUNK * 2
    while i < len(lines):
        piece = lines[i : i + step]
        line_start = i + 1
        line_end = i + len(piece)
        couplets = (len(piece) + 1) // 2
        chunks.append(
            {
                "id": f"{work_slug}-{idx:04d}",
                "sort_order": idx,
                "label": f"Đoạn {idx} (câu {line_start}–{line_end})",
                "body": "\n".join(piece),
                "line_start": line_start,
                "line_end": line_end,
                "approx_seconds": max(30, int(couplets * 7.5)),
            }
        )
        idx += 1
        i += step
    return {
        "slug": work_slug,
        "title": title,
        "author": author,
        "source_note": source,
        "line_count": len(lines),
        "chunk_count": len(chunks),
        "chunks": chunks,
    }


def main() -> None:
    works = [
        chunk_lines(
            (DATA / "kieu.lines.txt").read_text(encoding="utf-8").splitlines(),
            "kieu",
            "Truyện Kiều",
            "Nguyễn Du",
            "Wikisource tiếng Việt — Truyện Kiều (công cộng; Nguyễn Du mất 1820).",
        ),
        chunk_lines(
            (DATA / "luc_van_tien.lines.txt").read_text(encoding="utf-8").splitlines(),
            "luc_van_tien",
            "Lục Vân Tiên",
            "Nguyễn Đình Chiểu",
            "Wikisource tiếng Việt — Lục Vân Tiên bản Quốc ngữ 2082 câu "
            "(công cộng; Nguyễn Đình Chiểu mất 1888).",
        ),
    ]
    for work in works:
        path = DATA / f"{work['slug']}.chunks.json"
        path.write_text(json.dumps(work, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{work['slug']}: {work['line_count']} lines → {work['chunk_count']} chunks")
    (DATA / "index.json").write_text(
        json.dumps(
            {
                "works": [
                    {
                        k: w[k]
                        for k in (
                            "slug",
                            "title",
                            "author",
                            "source_note",
                            "line_count",
                            "chunk_count",
                        )
                    }
                    for w in works
                ]
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
