# Backlog — Chất lượng heritage (HITL · vùng miền · giọng kể)

> Ghi nhận từ trao đổi 21/8/2026. Chưa lên lịch triển khai.

Ba chủ đề độc lập nhưng cùng mục tiêu: Bố / bà nghe **đúng giọng Kinh Bắc**, **đúng cảm giác kể
chuyện**, và gia đình có **vòng lặp người duyệt** để cải thiện dần — không auto-sửa Bản sắc,
không chặn mẹ chờ duyệt từng câu.

---

## Hiện trạng (tóm tắt)

| Lớp | Đã có | Chưa có |
|-----|--------|---------|
| **Dữ liệu** | `memory_candidates`, ingest, extract review, golden hard | Vòng lặp chất lượng **câu chat / TTS** |
| **Chữ (Gemini)** | `speech_style`, xưng hô, guardrail | Khóa **phương ngữ Bắc**; paraphrase dễ lệch Nam |
| **Giọng (TTS)** | Clone + `tts_prefs` («Dùng cho Gói») | Accent Bắc trên API; **`body_tts` cho Nghe đọc** |

Phân biệt nhanh lỗi:

- Chữ lệch trên **chat chữ** → Gemini.
- Chữ ổn, **nghe** lệch miền / đọc máy → MiniMax (+ format chữ đưa vào TTS).
- Kiều / LVT / lục bát dài → gần như chắc **TTS + storytelling pipeline** (chữ cố định từ kho).

---

## 1. Human-in-the-loop (chất lượng chat & giọng)

### Bối cảnh

Forever **đã có HITL cho sự thật** (`memory_candidates` → «Điều nghe được», extract, ingest,
Thổi hồn). **Chưa có HITL cho chất lượng cảm giác**: giọng nghe lệch, xưng hô lạ, đọc không
giống kể.

Telemetry sẵn có trên mỗi reply: `meta.persona_register`, `meta.grounding`, `meta.new_facts`.
Golden-set có **soft score** (đúng giọng) — docs ghi steward/mẹ chấm tay; chưa operationalize.

### Mục tiêu

Vòng **chat → cờ → sửa nguồn → regression**, không RLHF, không duyệt từng câu trước khi mẹ nghe.

### Backlog

| # | Hạng mục | Gợi ý triển khai |
|---|----------|------------------|
| 1.1 | **Flag reply** | Nút nhẹ trên tin heritage / sau buổi Gọi: «Nghe chưa giống» / «Xưng hô lệch» → `message_id` + lý do (xưng hô / dài / lạ giọng / bịa). API `reply_flags` hoặc tương đương. |
| 1.2 | **Steward dashboard** | Gộp với `/review/[spaceId]`: pending candidates + flagged replies; link tới `persona_register` + message. |
| 1.3 | **Soft score golden** | Sau `./scripts/run-heritage-golden.py`: form 1–5 giọng / ấm / độ dài; case pass hard fail soft → sửa prompt hoặc thêm golden. |
| 1.4 | **Flywheel sửa nguồn** | Flag → steward sửa Bản sắc / Codex / hiến chương / `sample_phrases` — **không** auto-patch persona từ thumbs-down. |
| 1.5 | **TTS feedback (tùy chọn)** | Sau đoạn TTS dài: «Đoạn này ổn không?» — ghi nhận setting + chunk, không import audio TTS vào clone. |

### Nguyên tắc

- HITL **async**, sau buổi chat — không chặn `/call`.
- Giữ tường riêng tư: fact phòng `direct` chỉ chủ phòng duyệt / thấy flag.
- Tách **hard** (golden, critic) vs **soft** (chỉ người trong nhà).

### Tham chiếu

- `apps/mobile/app/review/[spaceId].tsx`, `heritage_candidates.py`
- `docs/heritage-bo-trieu/golden-set.json`, `heritage_golden.py`
- `docs/heritage-chat-v2.plan.md` (Stage 5b)

---

## 2. Vùng miền (phương ngữ Bắc · lẫn Nam)

### Bối cảnh

Bố Triệu / bà Thông — Kinh Bắc / Bắc Ninh. Pipeline khóa **xưng hô**, không khóa **phương ngữ**.

- **Gemini:** `speech_style` mô tả khẩu khí, không có «tiếng Bắc»; `paraphrase` dễ rơi tiếng Việt chung.
- **MiniMax:** chỉ `language_boost: "Vietnamese"` — **không** tham số Bắc/Nam; clone từ mẫu Bắc
  vẫn có thể trôi prosody trên đoạn dài (nhiều chunk TTS).

### Mục tiêu

Giảm lẫn miền Nam (chữ và/hoặc giọng) cho entity quê Bắc; biết sửa đúng lớp (Gemini vs TTS).

### Backlog

| # | Hạng mục | Gợi ý triển khai |
|---|----------|------------------|
| 2.1 | **Bản sắc** | `speech_style.traits`: «Tiếng Việt miền Bắc (Kinh Bắc); không từ/cách nói miền Nam» + `sample_phrases` Bắc thật từ thơ/ký ức. |
| 2.2 | **Prompt Lớp 1/3** | Rule (hoặc charter): phương ngữ theo `Persona` / quê — không hardcode «bố/mẹ» ở tầng app. |
| 2.3 | **Guardrail chữ (tùy chọn)** | Kiểu `strip_deference`: danh sách từ Nam thường gặp → cảnh báo hoặc gợi ý sửa; test `heritage_layers`. |
| 2.4 | **TTS profile Nghe đọc** | `speech-2.8-hd`, emotion `calm`, speed ~0.85–0.9; tách khỏi chat `turbo`. |
| 2.5 | **Theo dõi MiniMax** | Preset «giọng Bắc» trên web vs clone API; `pronunciation_dict` nếu hỗ trợ Việt. |
| 2.6 | **Bust cache** | Đổi `tts_prefs` → tái tạo `StoryRecording` (fingerprint). |

### Chẩn đoán

| Triệu chứng | Lớp |
|-------------|-----|
| Chat **chữ** đã có từ Nam | Gemini |
| Chữ ổn, **nghe** Nam (nhất là Kiều/LVT dài) | MiniMax + chunking |
| Đọc thơ Thư viện (`body_tts`) ổn hơn Nghe đọc | Thiếu `body_tts` trên story chunks |

### Tham chiếu

- `apps/api/app/services/minimax.py` (`LANGUAGE_BOOST`)
- `apps/api/app/services/heritage_chat.py` (`build_system_prompt`)
- `docs/heritage-bo-trieu/identity-lock.final.json` (`speech_style`)

---

## 3. Giọng kể chuyện (lục bát · «kể» không «đọc»)

### Bối cảnh

Bà thật **nhớ và kể** truyện thơ Nôm lục bát — chơn chu, nhịp cặp 6–8. App Nghe đọc (Kiều,
Lục Vân Tiên, …) nghe như **đọc từng dòng sách**:

- Thư viện thơ có **`body`** + **`body_tts`** (`poetry_clean.format_body_tts`: «câu 6, câu 8.»,
  nghỉ mỗi 4 cặp).
- **`StoryChunk` chỉ có `body`** (mỗi câu một dòng `\n`) → `ensure_story_tts_recording` đọc
  thẳng `chunk.body`.
- Cắt ~**280 ký tự**/lần TTS, ghép MP3 — nhiều mảnh, nhịp máy; `lengthen_pauses=False` cho truyện
  (tránh cắt sớm) nhưng không bù thiếu `body_tts`.

### Mục tiêu

Nghe gần **kể / đọc thuộc** hơn **đọc bài** — nhất trên kệ Nghe đọc và chat «đọc Kiều / LVT».

### Backlog

| # | Hạng mục | Gợi ý triển khai |
|---|----------|------------------|
| 3.1 | **`body_tts` cho story** | Cột hoặc field derived; sinh bằng `format_body_tts(..., meter="luc_bat")` lúc seed/import/rebuild chunks. TTS dùng `body_tts or body`. |
| 3.2 | **TTS theo cặp lục bát** | Chunk API theo 2 dòng (6+8) thay vì 280 ký tự cắt giữa câu; hoặc tăng `chunk_chars` có kiểm soát. |
| 3.3 | **Pause storytelling** | `<#0.25#>` / `<#0.35#>` giữa cặp (chỉ Nghe đọc); A/B với comma trong `body_tts`. |
| 3.4 | **Profile «Kể truyện»** | `tts_prefs` riêng hoặc flag `storytelling`: HD + calm + speed chậm; khác chat Gọi. |
| 3.5 | **Bản sắc** | Trait: «Kể truyện thơ: chậm, nối cặp lục bát, không đọc líu từng dòng» (+ wire vào prompt nếu chat kể). |
| 3.6 | **Mẫu human (dài hạn)** | `StoryRecording(source=human)`: steward ghi bà kể 1–2 đoạn mẫu làm reference / fallback. |
| 3.7 | **Rebuild corpus** | `./scripts/rebuild-storytelling-chunks.py` + migration regenerate `body_tts`; bust fingerprint `POEM_TTS_REV`. |

### ROI gợi ý (thứ tự)

1. `body_tts` lục bát cho story chunks + profile HD/calm/chậm.
2. Chunk TTS theo cặp verse / ít mảnh hơn.
3. HITL flag + human sample (mục 1 + 3.6).

### Tham chiếu

- `apps/api/app/services/poetry_clean.py` (`format_body_tts`)
- `apps/api/app/services/storytelling.py` (`ensure_story_tts_recording`, `VERSE_LINES_PER_CHUNK`)
- `apps/api/app/services/heritage_tts.py` (`synthesize_poem_audio`, `chunk_tts_text`)
- `docs/heritage-bo-trieu/STEWARD-NEXT.md` (bảng `body` vs `body_tts`)
- `apps/api/data/storytelling/*.chunks.json`

---

## Thứ tự gợi ý giữa ba chủ đề

1. **Giọng kể + vùng miền (TTS)** — `body_tts` story + profile Nghe đọc (impact trực tiếp mẹ nghe bà kể).
2. **Vùng miền (chữ)** — Bản sắc + prompt; golden soft score.
3. **HITL** — flag reply + steward queue (cải thiện liên tục, không block UX).

Ba hạng mục có thể làm song song nếu có người: 3.1 và 2.4 cùng một PR TTS; 1.1 độc lập mobile+API.
