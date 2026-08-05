# Việc bạn làm tiếp — thổi hồn Bố (steward)

Thứ tự an toàn đã siết gate trên PR #6. Bạn làm phần **local OCR**; agent làm import API sau.

## 1. Kéo code về máy

```bash
git fetch origin
git checkout cursor/heritage-soul-plan-1ef6
# hoặc merge PR #6 vào main rồi pull
```

Cần `GEMINI_API_KEY` trong shell hoặc `apps/api/.env`.

## 2. OCR + làm sạch (một lệnh)

```bash
export FOREVER_POETRY_PHOTOS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ"

# Kiểm tra thấy đủ ~20 ảnh
./scripts/ocr-poetry-ingest.sh --dry-run

# OCR toàn bộ (Gemini) + clean + bản TTS
./scripts/ocr-poetry-ingest.sh
```

Output (gitignore): `data/heritage-bo-trieu/poetry-ocr/*.json`

Mỗi bài có:
- `body` — văn học, mỗi câu một dòng, đã bỏ header/số trang/ký tự rác
- `body_tts` — cùng nội dung, có dấu phẩy/chấm nghỉ hơi (lục bát: `câu 6, câu 8.`) để Voice DNA TTS không đọc ồ ạt

Chỉ re-clean JSON đã có (không gọi API lại):

```bash
./scripts/ocr-poetry-ingest.sh --reformat-only
```

Ngày sáng tác ký dưới bài (`7/8/2014`) được tách khỏi `body` thành `composed_on`
— khi import nó thành `occurred_at` để Thư viện xếp đúng dòng thời gian.

## 3. Review nhanh (~20 bài)

```bash
./scripts/import-poems.sh --list   # trạng thái duyệt từng trang
```

Với mỗi file JSON:
1. Đọc `title` + `body` — đối 1–2 chỗ khó với ảnh gốc nếu `uncertain_spans` không rỗng  
2. Themes đúng chưa (`vo_chong`, `con_cai`, …)  
3. Nghe thử TTS (optional): copy `body_tts` vào màn Speak Voice DNA  
4. Đổi `review_status` → `approved` khi ổn  

Bài trải hai trang: dán tiếp phần sau vào `body` của trang đầu, rồi để `poems: []`
ở file trang sau (ghi lý do vào `notes`).

## 3b. Import vào Thư viện

Chỉ trang `approved` mới được gửi.

```bash
./scripts/import-poems.sh --identity <identity_id> --dry-run
./scripts/import-poems.sh --identity <identity_id>
```

Import lại nhiều lần vẫn an toàn — trùng nội dung sẽ bị bỏ qua.
Thơ vào Thư viện với `kind=poem`, tag `heritage:{identity_id}` + `chu-de:…`,
và **không** tính vào cổng kích hoạt.

## 4. Bản sắc (song song, 1 buổi với mẹ)

Mở **[`identity-lock.CHOICE-SHEET.md`](./identity-lock.CHOICE-SHEET.md)** — tick chốt từng mục.  
Chi tiết máy đọc: [`identity-lock.proposed.json`](./identity-lock.proposed.json) (đề xuất agent sau OCR 18 bài).  
Draft gốc: [`identity-lock.draft.json`](./identity-lock.draft.json).  
Cổng activate cần: giọng + **3 ký ức neo (không phải thơ)** + Bản sắc đã duyệt.

> Hồ sơ Triệu đã được kích hoạt từ trước khi siết cổng, nên chạy với Bản sắc trống.
> Đã chuyển sang `paused` sau khi import thơ. `resume-heritage` kiểm tra lại Bản sắc,
> nên chat chỉ mở lại được sau khi hiệu đính xong và tick `mark_profile_reviewed`.

## 5. Sau khi import xong — giao lại agent

- “Đã import N bài thơ vào Thư viện”  
→ Phase C: chat Ký ức (RAG trên thơ + ký ức neo)  

## Lưu ý TTS

| Dùng cho | Field |
|----------|--------|
| Lưu Thư viện / RAG / paraphrase | `body` |
| Đọc thành tiếng (Speak / sau này chat voice) | `body_tts` |

Nếu TTS vẫn nhanh: thêm nghỉ bằng cách tách đoạn trong `body_tts` (script đã chèn dòng trống mỗi 4 cặp lục bát).
