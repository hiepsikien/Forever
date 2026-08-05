# Ông Nguyễn Đình Triệu — Identity Lock & Memories pack

> **Trạng thái:** nằm trên nhánh `cursor/heritage-soul-plan-1ef6` (PR #6) — **chưa merge `main`**.  
> Kế hoạch v2: [`../heritage-soul-plan.md`](../heritage-soul-plan.md) — siết cổng activate **trước** khi ingest thơ.

Tài liệu steward cho thực thể ký ức **Bố / Ông Triệu**.

| File | Vai trò |
|------|---------|
| [`identity-lock.draft.json`](./identity-lock.draft.json) | Profile bất biến — neo **75 tuổi / 2015** |
| [`milestones.draft.json`](./milestones.draft.json) | Mốc từ Profile KB |
| [`poetry-themes.md`](./poetry-themes.md) | Theme tags + quote mode |
| [`samples/ong-ba-va-cac-chau.seed.json`](./samples/ong-ba-va-cac-chau.seed.json) | 1 bài mẫu đã chép từ ảnh chat |
| [`../heritage-soul-plan.md`](../heritage-soul-plan.md) | Kế hoạch kỹ thuật |

Bản Profile đầy đủ (PII) copy local tại `data/heritage-bo-trieu/kb/` (gitignore).

## OCR tập thơ (ưu tiên tiếp theo)

Ảnh nằm **local** (iCloud), ví dụ:

`~/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ`

Cloud agent không đọc được path Mac. Khi kéo branch về máy:

```bash
export GEMINI_API_KEY=…          # hoặc apps/api/.env
export FOREVER_POETRY_PHOTOS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ"
./scripts/ocr-poetry-ingest.sh
# dry-run:
./scripts/ocr-poetry-ingest.sh --dry-run --input "$FOREVER_POETRY_PHOTOS"
```

Output: `data/heritage-bo-trieu/poetry-ocr/*.json` → review → import Memories.

Layout đã calibrate: trang in *Thơ Tâm Tình*, title IN HOA, lục bát, số trang chân trang (vd. *ÔNG BÀ VÀ CÁC CHÁU*).
