#!/usr/bin/env python3
"""OCR scanned poetry pages (Ông Triệu) via Gemini → JSON for Forever Memories.

Designed for local Mac / cloud agent alike. Point --input at the photo folder:

  # Local (iCloud example — fix path on your machine):
  export GEMINI_API_KEY=…
  ./scripts/ocr-poetry-ingest.sh \\
    --input \"$HOME/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ\"

  # Cloud / workspace:
  ./scripts/ocr-poetry-ingest.sh --input data/heritage-bo-trieu/poetry-photos

Writes one JSON per image under --out (default data/heritage-bo-trieu/poetry-ocr/)
plus manifest.jsonl. Does NOT commit poem text to git (data/ is gitignored).
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
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
DEFAULT_OUT = ROOT / "data" / "heritage-bo-trieu" / "poetry-ocr"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}

ALLOWED_THEMES = [
    "vo_chong",
    "con_cai",
    "gia_dinh",
    "nghe_giao",
    "tho",
    "biet_on",
    "truyen_thong",
]

OCR_SYSTEM = """\
Bạn là trợ lý số hóa tập thơ gia đình (Forever).
Nhiệm vụ: OCR chính xác trang thơ tiếng Việt từ ảnh chụp sổ/in.

Hard rules:
- Chỉ đọc chữ có trên ảnh. KHÔNG bịa thêm câu thơ, khổ, hoặc tên bài.
- Giữ nguyên chính tả trên trang (kể cả nếu nghi ngờ lỗi in) — ghi note riêng nếu nghi OCR sai.
- Nếu nhiều bài trên một trang: tách thành mảng poems[].
- Nếu trang chỉ là mục lục / trang trắng / không phải thơ: poems=[] và note rõ.
- Meter thường gặp: lục bát, song thất lục bát, thất ngôn — ghi nếu nhận ra.
- Theme chỉ chọn trong whitelist: vo_chong, con_cai, gia_dinh, nghe_giao, tho, biet_on, truyen_thong.
- Trả về ĐÚNG một JSON object, không markdown fence, không giải thích ngoài JSON.
"""

OCR_USER = """\
Đọc trang thơ trong ảnh. Trả JSON theo schema:

{
  "page_label": "số trang in nếu thấy, else null",
  "collection_header": "tiêu đề mục (vd Thơ Tâm Tình) nếu thấy, else null",
  "poems": [
    {
      "title": "tên bài IN HOA hoặc như trên trang",
      "body": "toàn văn, xuống dòng đúng khổ/câu",
      "meter": "luc_bat|song_that_luc_bat|that_ngon|other|unknown",
      "themes": ["gia_dinh"],
      "year_guess": null,
      "ocr_confidence": 0.0,
      "uncertain_spans": ["chữ/cụm nghi OCR sai"]
    }
  ],
  "notes": "ghi chú ngắn"
}

Whitelist themes: vo_chong, con_cai, gia_dinh, nghe_giao, tho, biet_on, truyen_thong.
"""


def _mime(path: Path) -> str:
    guess, _ = mimetypes.guess_type(str(path))
    if guess:
        return guess
    return "image/jpeg"


def _list_images(folder: Path) -> list[Path]:
    files = [
        p
        for p in sorted(folder.rglob("*"))
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    ]
    return files


def _gemini_ocr(
    *,
    api_key: str,
    model: str,
    api_base: str,
    image_path: Path,
) -> dict:
    raw = image_path.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    url = f"{api_base.rstrip('/')}/models/{model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": OCR_SYSTEM}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": OCR_USER},
                    {"inline_data": {"mime_type": _mime(image_path), "data": b64}},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    with httpx.Client(timeout=120.0) as client:
        res = client.post(
            url,
            params={"key": api_key},
            headers={"Content-Type": "application/json"},
            json=payload,
        )
        res.raise_for_status()
        data = res.json()

    text = _extract_text(data)
    return _parse_json_object(text)


def _extract_text(data: dict) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"No candidates: {json.dumps(data)[:400]}")
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    text = "\n".join(texts).strip()
    if not text:
        raise RuntimeError("Empty Gemini text")
    return text


def _parse_json_object(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end < 0:
        raise RuntimeError(f"No JSON object in model output: {cleaned[:300]}")
    return json.loads(cleaned[start : end + 1])


def _normalize(result: dict, source: Path) -> dict:
    poems = []
    for poem in result.get("poems") or []:
        themes = [
            t for t in (poem.get("themes") or []) if t in ALLOWED_THEMES
        ]
        poems.append(
            {
                "title": (poem.get("title") or "").strip(),
                "body": (poem.get("body") or "").strip(),
                "meter": poem.get("meter") or "unknown",
                "themes": themes,
                "year_guess": poem.get("year_guess"),
                "ocr_confidence": poem.get("ocr_confidence"),
                "uncertain_spans": poem.get("uncertain_spans") or [],
            }
        )
    return {
        "source_file": str(source),
        "source_name": source.name,
        "page_label": result.get("page_label"),
        "collection_header": result.get("collection_header"),
        "poems": poems,
        "notes": result.get("notes") or "",
        "review_status": "needs_review",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        required=True,
        help="Folder of poem page photos (local path; override when pulling to Mac)",
    )
    parser.add_argument(
        "--out",
        "-o",
        type=Path,
        default=DEFAULT_OUT,
        help="Output directory for OCR JSON (default under data/, gitignored)",
    )
    parser.add_argument("--limit", type=int, default=0, help="Max images (0=all)")
    parser.add_argument("--sleep", type=float, default=0.4, help="Pause between API calls")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List images only; no API calls",
    )
    args = parser.parse_args()

    folder = args.input.expanduser().resolve()
    if not folder.is_dir():
        print(f"Input folder not found: {folder}", file=sys.stderr)
        print(
            "Tip: on Mac set --input to your iCloud Thơ folder; "
            "on cloud agent upload/copy photos into data/heritage-bo-trieu/poetry-photos/",
            file=sys.stderr,
        )
        return 2

    images = _list_images(folder)
    if args.limit > 0:
        images = images[: args.limit]
    print(f"Found {len(images)} image(s) under {folder}")
    if args.dry_run:
        for p in images:
            print(f"  {p.relative_to(folder)}")
        return 0

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("GEMINI_API_KEY is required", file=sys.stderr)
        return 2
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash").strip()
    api_base = os.environ.get(
        "GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta"
    ).strip()

    out_dir = args.out.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.jsonl"

    ok = 0
    fail = 0
    with manifest_path.open("w", encoding="utf-8") as manifest:
        for idx, image in enumerate(images, 1):
            rel = image.relative_to(folder)
            stem = "__".join(rel.parts).replace(" ", "_")
            out_file = out_dir / f"{stem}.json"
            print(f"[{idx}/{len(images)}] OCR {rel} …")
            try:
                raw = _gemini_ocr(
                    api_key=api_key, model=model, api_base=api_base, image_path=image
                )
                normalized = _normalize(raw, image)
                out_file.write_text(
                    json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                manifest.write(
                    json.dumps(
                        {
                            "source": str(image),
                            "out": str(out_file),
                            "poem_count": len(normalized["poems"]),
                            "titles": [p["title"] for p in normalized["poems"]],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                ok += 1
            except Exception as exc:  # noqa: BLE001 — batch job: log and continue
                fail += 1
                print(f"  FAIL: {exc}", file=sys.stderr)
                manifest.write(
                    json.dumps(
                        {"source": str(image), "error": str(exc)},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
            if args.sleep > 0 and idx < len(images):
                time.sleep(args.sleep)

    print(f"Done. ok={ok} fail={fail} out={out_dir}")
    print("Next: steward review JSON → import MemoryItem kind=poem (API/UI Phase B).")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
