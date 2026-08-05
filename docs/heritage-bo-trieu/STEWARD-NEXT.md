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

## 3. Review nhanh (~20 bài)

Với mỗi file JSON:
1. Đọc `title` + `body` — đối 1–2 chỗ khó với ảnh gốc nếu `uncertain_spans` không rỗng  
2. Themes đúng chưa (`vo_chong`, `con_cai`, …)  
3. Nghe thử TTS (optional): copy `body_tts` vào màn Speak Voice DNA  
4. Đổi `review_status` → `approved` khi ổn  

**Không** cần import tay 40 ghi chú — báo agent khi xong review để làm batch `kind=poem`.

## 4. Bản sắc (song song, 1 buổi với mẹ)

Mở draft: `docs/heritage-bo-trieu/identity-lock.draft.json`  
Hiệu đính: 3+ giá trị thật, xưng hô, taboo, vài câu mẫu — rồi tick `mark_profile_reviewed` trên app (API đã có).  
Cổng activate cần: giọng + **3 ký ức neo (không phải thơ)** + Bản sắc đã duyệt.

## 5. Sau khi OCR xong — giao lại agent

- “OCR xong, JSON trong `data/heritage-bo-trieu/poetry-ocr/`”  
→ Phase B: endpoint batch import `kind=poem` + nhãn Thư viện  
→ Rồi mới Phase C: chat Ký ức  

## Lưu ý TTS

| Dùng cho | Field |
|----------|--------|
| Lưu Thư viện / RAG / paraphrase | `body` |
| Đọc thành tiếng (Speak / sau này chat voice) | `body_tts` |

Nếu TTS vẫn nhanh: thêm nghỉ bằng cách tách đoạn trong `body_tts` (script đã chèn dòng trống mỗi 4 cặp lục bát).
