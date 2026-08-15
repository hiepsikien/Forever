#!/usr/bin/env python3
"""Extract every photo + nearby caption from the 2016 Triệu–Định Word album.

The .doc is an OLE compound file; macOS textutil cannot pull the pictures.
This walks JPEG markers in the binary. Captions live in a separate Word
stream so they are listed in catalog.json for you to attach when editing.

  ./scripts/extract-album-2016.py
  ./scripts/extract-album-2016.py --src "/path/to/file.doc"

Writes gitignored:

  data/heritage-bo-trieu/album-2016/catalog.json
  data/heritage-bo-trieu/album-2016/images/0001.jpg
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "heritage-bo-trieu" / "album-2016"
DEFAULT_SRC = Path(
    "/Users/andynguyen/Library/Mobile Documents/com~apple~CloudDocs/"
    "App Projects/A1 Forever/Trieu/Profile/"
    "HÌNH ẢNH KỶ NIỆM TRIEU DINH 2016.doc"
)

YEAR = re.compile(r"(19\d{2}|20\d{2})")
MONTH = re.compile(r"th[aá]ng\s+(\d{1,2})", re.I)
WS = re.compile(r"\s+")
MIN_JPEG = 20_000
CAPTION_HINT = re.compile(
    r"(19\d{2}|20\d{2}|hình|ảnh|thời|cưới|leipzig|tháng|hương|đình|tiệp|gia đình)",
    re.I,
)


def _occurred_at(caption: str) -> str | None:
    years = YEAR.findall(caption)
    if not years:
        return None
    year = years[0]
    month_m = MONTH.search(caption)
    if month_m:
        month = int(month_m.group(1))
        if 1 <= month <= 12:
            return f"{year}-{month:02d}-01"
    return f"{year}-01-01"


def is_album_caption(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 6 or len(t) > 160:
        return False
    letters = sum(ch.isalpha() for ch in t)
    if letters < 6 or letters / len(t) < 0.45:
        return False
    if sum("\u4e00" <= ch <= "\u9fff" for ch in t) > 1:
        return False
    if "NMR" in t or "MERGEFORMAT" in t or "SHAPE" in t:
        return False
    return bool(CAPTION_HINT.search(t))


def iter_jpegs(buf: bytes, *, min_size: int = MIN_JPEG) -> list[tuple[int, bytes]]:
    """Return (offset, jpeg_bytes) for complete JPEGs at least min_size."""
    out: list[tuple[int, bytes]] = []
    i = 0
    n = len(buf)
    while True:
        i = buf.find(b"\xff\xd8", i)
        if i < 0:
            break
        pos = i + 2
        end: int | None = None
        while pos + 1 < n and buf[pos] == 0xFF:
            while pos < n and buf[pos] == 0xFF:
                pos += 1
            if pos >= n:
                break
            marker = buf[pos]
            pos += 1
            if marker == 0xD9:
                end = pos
                break
            if marker == 0xDA:
                eoi = buf.find(b"\xff\xd9", pos)
                end = eoi + 2 if eoi >= 0 else None
                break
            if marker in {0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8}:
                continue
            if pos + 2 > n:
                break
            seglen = int.from_bytes(buf[pos : pos + 2], "big")
            if seglen < 2:
                break
            pos += seglen
        if end and end - i >= min_size:
            out.append((i, buf[i:end]))
            i = end
        else:
            i += 2
    return out


def iter_captions(buf: bytes) -> list[tuple[int, str]]:
    """UTF-16LE runs that look like album captions, not binary noise."""
    out: list[tuple[int, str]] = []
    # Even offsets only — WordDocument text is UTF-16LE.
    i = 0
    n = len(buf)
    while i + 16 < n:
        if buf[i + 1] != 0 and not (0x1E <= buf[i + 1] <= 0x1F):
            i += 2
            continue
        chars: list[str] = []
        j = i
        while j + 1 < n:
            lo, hi = buf[j], buf[j + 1]
            code = lo | (hi << 8)
            if code == 0:
                break
            if code == 0x0D or code == 0x0A or code == 0x09:
                if chars:
                    break
                j += 2
                continue
            ch = chr(code)
            if ch.isprintable() or ch in "–—":
                chars.append(ch)
                j += 2
                continue
            break
        text = WS.sub(" ", "".join(chars)).strip(" -")
        if len(text) >= 8 and any(c.isalpha() for c in text):
            low = text.lower()
            if not any(
                junk in low
                for junk in ("root entry", "worddocument", "1table", "microsoft", "normal.dot")
            ) and is_album_caption(text):
                out.append((i, text[:240]))
        i = max(j, i + 2)
    return out


def extract(src: Path, out_dir: Path) -> dict:
    data = src.read_bytes()
    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    jpegs = iter_jpegs(data)
    caption_list = []
    seen_cap: set[str] = set()
    for _off, text in iter_captions(data):
        if text in seen_cap:
            continue
        seen_cap.add(text)
        caption_list.append(text)

    seen_hash: set[str] = set()
    photos: list[dict] = []
    index = 0
    for _offset, blob in jpegs:
        digest = hashlib.sha256(blob).hexdigest()
        if digest in seen_hash:
            continue
        seen_hash.add(digest)
        index += 1
        filename = f"{index:04d}.jpg"
        (images_dir / filename).write_bytes(blob)
        photos.append(
            {
                "index": index,
                "file": f"images/{filename}",
                "title": f"Ảnh {index}",
                "body": "",
                "occurred_at": None,
                "people": [],
                "sha256": digest,
                "bytes": len(blob),
            }
        )

    catalog = {
        "source": str(src),
        "source_name": src.name,
        "count": len(photos),
        "captions_in_album": caption_list,
        "photos": photos,
    }
    (out_dir / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    work = out_dir / "_work.docx"
    if work.exists():
        work.unlink()
    return catalog


def main() -> int:
    argv = [a for a in sys.argv[1:] if a != "--src"]
    src = Path(argv[0]).expanduser() if argv else DEFAULT_SRC
    if not src.exists():
        print(f"Không thấy file album: {src}", file=sys.stderr)
        return 2
    out = DEFAULT_OUT
    out.mkdir(parents=True, exist_ok=True)
    catalog = extract(src, out)
    print(f"Đã tách {catalog['count']} ảnh → {out}")
    caps = catalog.get("captions_in_album") or []
    print(f"Chú thích đọc được từ album ({len(caps)} câu) — gắn tay khi hiệu đính:")
    for line in caps[:20]:
        print(f"  · {line}")
    if len(caps) > 20:
        print(f"  … và {len(caps) - 20} câu nữa")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
