#!/usr/bin/env python3
"""OCR scanned poetry pages (Ông Triệu) via Gemini → cleaned JSON for Forever.

Local Mac:
  export GEMINI_API_KEY=…
  export FOREVER_POETRY_PHOTOS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ"
  ./scripts/ocr-poetry-ingest.sh

Re-clean existing OCR JSON (no API):
  ./scripts/ocr-poetry-ingest.sh --reformat-only

Each poem gets:
  body       — literary, one verse line per line
  body_tts   — same words + soft pauses for Voice DNA TTS
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

# Allow running from repo root without installing the package.
API_ROOT = Path(__file__).resolve().parents[1] / "apps" / "api"
sys.path.insert(0, str(API_ROOT))
from app.services.poetry_clean import enrich_poem  # noqa: E402

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
Nhiệm vụ: OCR chính xác trang thơ tiếng Việt từ ảnh chụp sổ/in, rồi trả văn bản SẠCH.

Hard rules:
- Chỉ đọc chữ có trên ảnh. KHÔNG bịa thêm câu thơ, khổ, hoặc tên bài.
- BỎ các thứ không thuộc bài thơ: tiêu đề mục (vd "Thơ Tâm Tình"), số trang,
  chân trang, đầu trang, gạch trang trí, watermark, ký tự lạ OCR.
- Mỗi câu thơ một dòng. Lục bát: dòng 6 tiếng rồi dòng 8 tiếng, xen kẽ.
- Không gộp hai câu vào một dòng. Không thêm dấu câu thừa vào body
  (script sẽ tạo bản TTS riêng).
- Giữ nguyên chính tả trên trang — ghi uncertain_spans nếu nghi OCR sai.
- Nhiều bài trên một trang → poems[]. Trang mục lục/trắng → poems=[].
- Theme whitelist: vo_chong, con_cai, gia_dinh, nghe_giao, tho, biet_on, truyen_thong.
- Trả ĐÚNG một JSON object, không markdown fence.
"""

OCR_USER = """\
Đọc trang thơ trong ảnh. Trả JSON:

{
  "page_label": "số trang in nếu thấy, else null",
  "collection_header": "tiêu đề mục nếu thấy (không nhét vào body), else null",
  "poems": [
    {
      "title": "TÊN BÀI",
      "body": "mỗi câu một dòng\\n…",
      "meter": "luc_bat|song_that_luc_bat|that_ngon|other|unknown",
      "themes": ["gia_dinh"],
      "year_guess": null,
      "ocr_confidence": 0.0,
      "uncertain_spans": []
    }
  ],
  "notes": ""
}
"""


def _mime(path: Path) -> str:
    guess, _ = mimetypes.guess_type(str(path))
    return guess or "image/jpeg"


def _list_images(folder: Path) -> list[Path]:
    return [
        p
        for p in sorted(folder.rglob("*"))
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    ]


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
        lines = [ln for ln in cleaned.splitlines() if not ln.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end < 0:
        raise RuntimeError(f"No JSON object in model output: {cleaned[:300]}")
    return json.loads(cleaned[start : end + 1])


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
        return _parse_json_object(_extract_text(res.json()))


def _normalize(result: dict, source: Path | None) -> dict:
    poems = []
    for poem in result.get("poems") or []:
        themes = [t for t in (poem.get("themes") or []) if t in ALLOWED_THEMES]
        enriched = enrich_poem(
            {
                "title": poem.get("title") or "",
                "body": poem.get("body") or "",
                "meter": poem.get("meter") or "unknown",
                "themes": themes,
                "year_guess": poem.get("year_guess"),
                "ocr_confidence": poem.get("ocr_confidence"),
                "uncertain_spans": poem.get("uncertain_spans") or [],
            }
        )
        poems.append(enriched)
    return {
        "source_file": str(source) if source else result.get("source_file"),
        "source_name": source.name if source else result.get("source_name"),
        "page_label": result.get("page_label"),
        "collection_header": result.get("collection_header"),
        "poems": poems,
        "notes": result.get("notes") or "",
        "review_status": result.get("review_status") or "needs_review",
    }


def _reformat_dir(out_dir: Path) -> int:
    files = sorted(out_dir.glob("*.json"))
    files = [f for f in files if f.name != "manifest.json"]
    if not files:
        print(f"No JSON in {out_dir}", file=sys.stderr)
        return 2
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        cleaned = _normalize(data, None)
        # Preserve provenance fields
        for key in ("source_file", "source_name", "page_label", "collection_header", "notes", "review_status"):
            if key in data and cleaned.get(key) in (None, ""):
                cleaned[key] = data[key]
        path.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"reformatted {path.name} ({len(cleaned['poems'])} poem(s))")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", "-i", type=Path, default=None)
    parser.add_argument("--out", "-o", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.4)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--reformat-only",
        action="store_true",
        help="Re-run clean/TTS format on existing --out JSON (no Gemini)",
    )
    args = parser.parse_args()

    out_dir = args.out.expanduser().resolve()

    if args.reformat_only:
        out_dir.mkdir(parents=True, exist_ok=True)
        return _reformat_dir(out_dir)

    if args.input is None:
        print("--input is required unless --reformat-only", file=sys.stderr)
        return 2

    folder = args.input.expanduser().resolve()
    if not folder.is_dir():
        print(f"Input folder not found: {folder}", file=sys.stderr)
        print(
            "Tip: export FOREVER_POETRY_PHOTOS=…/Trieu/Thơ then ./scripts/ocr-poetry-ingest.sh",
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

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.jsonl"
    ok = fail = 0
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
            except Exception as exc:  # noqa: BLE001
                fail += 1
                print(f"  FAIL: {exc}", file=sys.stderr)
                manifest.write(
                    json.dumps({"source": str(image), "error": str(exc)}, ensure_ascii=False)
                    + "\n"
                )
            if args.sleep > 0 and idx < len(images):
                time.sleep(args.sleep)

    print(f"Done. ok={ok} fail={fail} out={out_dir}")
    print("Next: mở JSON, sửa uncertain_spans, rồi báo agent để import kind=poem.")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
