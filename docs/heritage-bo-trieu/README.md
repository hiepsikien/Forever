# Ông Nguyễn Đình Triệu — Identity Lock & Memories pack

> **Trạng thái:** nhánh `cursor/heritage-soul-plan-1ef6` (PR #6).  
> **Việc bạn làm tiếp:** [`STEWARD-NEXT.md`](./STEWARD-NEXT.md)

| File | Vai trò |
|------|---------|
| [`STEWARD-NEXT.md`](./STEWARD-NEXT.md) | Checklist OCR + review + Bản sắc |
| [`identity-lock.draft.json`](./identity-lock.draft.json) | Profile neo 75 tuổi / 2015 |
| [`milestones.draft.json`](./milestones.draft.json) | Mốc từ Profile |
| [`poetry-themes.md`](./poetry-themes.md) | Theme tags |
| [`samples/`](./samples/) | Bài seed mẫu |
| [`../heritage-soul-plan.md`](../heritage-soul-plan.md) | Kế hoạch kỹ thuật |

## OCR nhanh

```bash
export GEMINI_API_KEY=…
export FOREVER_POETRY_PHOTOS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ"
./scripts/ocr-poetry-ingest.sh --dry-run
./scripts/ocr-poetry-ingest.sh
```

Pipeline: ảnh → Gemini OCR → `poetry_clean` (bỏ rác, chuẩn lục bát) → `body` + `body_tts`.
