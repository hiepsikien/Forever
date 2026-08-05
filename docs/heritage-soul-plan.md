# Thổi hồn cho Bố — kế hoạch triển khai

> **Mục tiêu:** hoàn thiện trụ *bản sắc + tri thức* (Profile / Memories) sau Voice DNA (đã dùng được).  
> **Nguyên tắc:** Identity Lock bất biến · Memories retrieve theo ngữ cảnh · không bịa tiểu sử · label rõ tin nhắn Ký ức.  
> **Phạm vi repo:** Forever only.  
> **Pack steward:** [`docs/heritage-bo-trieu/`](./heritage-bo-trieu/).

---

## Quyết định đã khóa (steward Q&A 2026-08-05)

| # | Quyết định |
|---|------------|
| Neo bản sắc | **Tuổi 75 / năm 2015** (sinh 1940) — tinh thần sau hưu, mùa thơ Đền Lừ |
| Profile nguồn | Notion/PDF *PROFILE & KNOWLEDGE BASE ÔNG NGUYỄN ĐÌNH TRIỆU* → draft Identity Lock + milestones |
| Giá trị / câu mẫu | **Placeholder** — đề xuất sau OCR đầy đủ + hiệu đính mẹ |
| Taboo cứng | Chính trị · tình dục · trái pháp luật · trái đạo đức (+ không bịa tiểu sử) |
| Thơ | ~20 bài ảnh sẵn, tổng ~40+; **ảnh chụp trang in** (vd. mục *Thơ Tâm Tình*, lục bát) |
| Quote mode | Toggle; **default = mượn ý (paraphrase)**; optional verbatim + tên bài |
| Signature poems (#8) | Chọn **2–3 bài chữ ký** luôn nằm trong System Prompt — đề xuất sau OCR |
| Themes | `vo_chong`, `con_cai`, `gia_dinh`, `nghe_giao`, `tho`, `biet_on`, `truyen_thong` |
| Milestones | Seed từ Profile; UI/edit sau |
| Live context | Đề xuất bên dưới — steward tinh chỉnh |
| Review ship text | **Mẹ + steward (con)** trước; anh chị sau |
| Ưu tiên tiếp | **Ingest thơ (Gemini OCR)** trước heritage chat stub |
| Voice DNA | Đủ dùng — tinh chỉnh sau text “đúng bố” |
| Đường dẫn ảnh | Local Mac iCloud `…/Trieu/Thơ` — cloud agent không mount được; khi kéo code về local set `FOREVER_POETRY_PHOTOS` / `--input` |

---

## 0. Hiện trạng (gap)

| Lớp | Đã có | Thiếu |
|-----|-------|-------|
| **Giọng** | Voice DNA dùng được | Tinh chỉnh sau text |
| **Profile** | Draft Identity Lock + milestones (docs) | Schema API + màn Bản sắc + hiệu đính |
| **Thơ** | OCR script + 1 bài seed mẫu | Chạy OCR local trên folder Thơ (~20→40+) |
| **RAG / chat Ký ức** | Thread heritage + activate gate | Embedding, heritage LLM, quote toggle |

Agent `Người giữ nhà` vẫn từ chối đóng vai người đã mất — đúng. Twin chạy trên thread `heritage`.

---

## 1. Kiến trúc Profile vs Memories

```
Identity Lock (Profile)          Context Key (Memories)
─────────────────────────        ────────────────────────────
system_prompt / identity JSON    poetry (vector)  ← OCR → review → MemoryItem
  · nhân thân & vai trò            milestones       ← seed từ Profile
  · hệ giá trị & triết lý          library notes
  · ngôn ngữ & xưng hô             live_context     ← đề xuất §1.3
  · taboo / không nói
        │                              │
        └──────────► Heritage LLM ◄────┘
```

### 1.1 Profile — xem `docs/heritage-bo-trieu/identity-lock.draft.json`

Neo: GS.TS Nguyễn Đình Triệu · chồng bà Định (Anh–Em) · cha ba con · nhà giáo / thi sĩ sau hưu · **tuổi bảy nhăm (2015)**.

### 1.2 Thơ — dạng trang in

Mẫu đã thấy: header mục (*Thơ Tâm Tình*), title IN HOA, lục bát đời thường (chợ, bếp, cháu), số trang chân trang. OCR prompt đã calibrate theo layout này.

Pipeline:

```
ảnh trang  →  scripts/ocr-poetry-ingest.sh  →  poetry-ocr/*.json (needs_review)
         →  steward sửa  →  import MemoryItem kind=poem + themes + heritage:{id}
```

Local (sau khi pull):

```bash
export GEMINI_API_KEY=…
export FOREVER_POETRY_PHOTOS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/App Projects/A1 Forever/Trieu/Thơ"
./scripts/ocr-poetry-ingest.sh
# hoặc:
./scripts/ocr-poetry-ingest.sh --input "/path/to/Thơ"
```

Output mặc định: `data/heritage-bo-trieu/poetry-ocr/` (**gitignore** — không commit nguyên văn thơ lên git).

### 1.3 Live context — đề xuất (câu 11)

**Đưa vào prompt (mặc định):**

- Ghi chú steward `dynamic_context` (ô edit ngắn)
- Tóm tắt N tin Phòng khách gần đây (7 ngày / tối đa ~15 tin text)
- Milestone sắp tới ±30 ngày (sinh nhật mẹ, giỗ, …)

**Loại trừ mặc định:**

- Chủ đề trùng taboo (chính trị, tình dục, pháp lý nhạy cảm)
- Số tài khoản / giấy tờ / địa chỉ chi tiết người sống (redact)
- Thread riêng tư / chưa có đồng ý chia sẻ vào Ký ức
- Tranh cãi đang nóng — không làm “trọng tài” nhân danh bố

---

## 2. Heritage chat (sau ingest)

1. Retrieve top-k thơ + milestone + library theo câu hỏi  
2. Prompt = Lock + excerpts + live context + history  
3. Quote mode từ setting (default paraphrase)  
4. Refuse / khiêm tốn khi thiếu data  
5. `sender_kind=heritage` · TTS optional không auto-play  

Gate activate: giữ voice + knowledge; **thêm** Profile tối thiểu (values draft + speech_style + address_forms).

---

## 3. Lộ trình engineering

| Phase | Việc | Status |
|-------|------|--------|
| **A** | Identity Lock schema + API + màn Bản sắc | Draft JSON sẵn |
| **B** | OCR ingest + review + `kind=poem` | **Script sẵn — chạy local** |
| **C** | Heritage reply engine + quote toggle | Tiếp theo sau B |
| **D** | Milestones UI + live context | Seed JSON sẵn |
| **E** | Voice DNA tinh chỉnh | Sau text ổn |

---

## 4. Việc gia đình (nội dung)

1. Chạy OCR local trên folder Thơ (~20 bài)  
2. Review JSON (chính tả, themes)  
3. Hiệu đính Identity Lock placeholders (values, câu mẫu)  
4. Chọn 2–3 signature poems cho System Prompt  
5. Dry-run 10 câu với mẹ + steward  

---

## 5. Definition of Done

- [ ] Steward sửa Profile; prompt rebuild không deploy lại  
- [ ] ≥20 bài (hướng 40+) searchable; theme đúng  
- [ ] Toggle paraphrase/verbatim; default paraphrase  
- [ ] Heritage chat đúng khẩu khí; thiếu data thì thừa nhận  
- [ ] Label Ký ức rõ trên UI  
- [ ] Mẹ dùng được không cần biết RAG  
- [ ] Export Profile + metadata thơ (archive)

---

## 6. Rủi ro kỹ thuật

| Rủi ro | Xử lý |
|--------|--------|
| OCR lệch chữ trang in | `uncertain_spans` + steward đối sổ; temperature thấp |
| HEIC từ iPhone | Đổi JPEG/PNG nếu Gemini từ chối mime; script liệt kê `.heic` |
| Privacy thơ | Chỉ `data/` + DB space — không commit body thơ |
| Bịa thơ mới | Cấm mặc định; chỉ paraphrase hoặc verbatim có nguồn |
