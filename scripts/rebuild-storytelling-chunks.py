#!/usr/bin/env python3
"""Rebuild storytelling chunk JSON from *.lines.txt (after editing line files)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "apps" / "api" / "data" / "storytelling"
COUPLETS_PER_CHUNK = 10


def chunk_lines(
    lines: list[str],
    work_slug: str,
    title: str,
    author: str,
    source: str,
    *,
    category: str = "classic",
    sort_order: int = 100,
) -> dict:
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
        "category": category,
        "sort_order": sort_order,
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
            sort_order=10,
        ),
        chunk_lines(
            (DATA / "luc_van_tien.lines.txt").read_text(encoding="utf-8").splitlines(),
            "luc_van_tien",
            "Lục Vân Tiên",
            "Nguyễn Đình Chiểu",
            "Wikisource tiếng Việt — Lục Vân Tiên bản Quốc ngữ 2082 câu "
            "(công cộng; Nguyễn Đình Chiểu mất 1888).",
            sort_order=20,
        ),
        chunk_lines(
            (DATA / "pham_cong_cuc_hoa.lines.txt").read_text(encoding="utf-8").splitlines(),
            "pham_cong_cuc_hoa",
            "Phạm Công – Cúc Hoa",
            "Dương Minh Đức Thị (truyện thơ Nôm)",
            "Bản quốc ngữ gia đình — làm sạch để đọc (bỏ số dòng, tiêu đề chương, "
            "quảng cáo). Dương Minh Đức Thị (truyện thơ Nôm).",
            sort_order=25,
        ),
    ]
    for work in works:
        path = DATA / f"{work['slug']}.chunks.json"
        path.write_text(json.dumps(work, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{work['slug']}: {work['line_count']} lines → {work['chunk_count']} chunks")

    index_path = DATA / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {"works": []}
    by_slug = {w["slug"]: w for w in index.get("works") or []}
    for work in works:
        meta = {
            k: work[k]
            for k in (
                "slug",
                "title",
                "author",
                "category",
                "sort_order",
                "source_note",
                "line_count",
                "chunk_count",
            )
        }
        by_slug[work["slug"]] = {**(by_slug.get(work["slug"]) or {}), **meta}
    index["works"] = sorted(
        by_slug.values(),
        key=lambda w: (0 if w.get("category") == "classic" else 1, int(w.get("sort_order") or 100)),
    )
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
