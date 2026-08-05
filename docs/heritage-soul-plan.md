# Thổi hồn cho Bố — kế hoạch triển khai (v2, đã review)

> **Mục tiêu:** Identity Lock + Memories (thơ) cho thực thể ký ức Ông Nguyễn Đình Triệu.  
> **Voice DNA:** đã dùng được — tinh chỉnh sau khi text “đúng bố”.  
> **Trạng thái artifact:** pack + OCR script nằm trên nhánh `cursor/heritage-soul-plan-1ef6` (PR #6) — **chưa merge `main`**. Không gọi là “sẵn trên repo chính” cho đến khi merge.

---

## Review nội bộ (2026-08-05) — chấp nhận

Feedback đúng trên mọi điểm chặn. Bản v1 lẫn “đã thiết kế” với “đã có trên main”, đánh giá thấp Phase C, và **để hở cổng activate** nếu ingest thơ trước khi siết Profile.

| # | Phát hiện | Kết luận v2 |
|---|-----------|-------------|
| 1 | `docs/heritage-bo-trieu/*`, `scripts/ocr-poetry-ingest.*` chỉ trên PR #6, không trên `main` / 10 nhánh khác | Ghi **chưa merge**; bước 0 = merge PR pack **sau** (hoặc cùng) gate fix |
| 2 | `knowledge_count` đếm mọi tag `heritage:{id}` → 5 bài thơ + voice = `can_activate` trong khi Lock còn placeholder | **Siết gate trước / cùng Phase A** — không ingest thơ trước khi gate an toàn |
| 2b | `tags.contains` khớp tiền tố (`heritage:abc` ⊂ `heritage:abcdef`) | Tag match theo token phân tách |
| 2c | `compute_heritage_entity_status`: hai nhánh đều → `awakening` | Tách `gathering` vs `awakening` (đủ điều kiện chờ kích hoạt) |
| 3 | Không có embedding/pgvector/faiss/chroma | **Không làm vector** ở quy mô ~40 bài; theme + keyword |
| 4 | Không có `kind=poem` / batch import; UI fallback | Hạng mục Phase B bắt buộc |
| 5 | `IdentityProfile` mỏng; chỉ `schema_patch` ADD COLUMN | Phase A = khối lượng thật (cột + API + màn) |
| 6 | Heritage history / `maybe_reply` chỉ `family` | Phase C = **service mới** `heritage_chat.py`; không mở rộng agent |
| 6b | Message thiếu meta trích dẫn | Field citation cho verbatim |
| 7 | Thiếu kill switch, ACL chat, adversarial tests, live-context opt-in | Thêm vào scope bắt buộc |

Privacy `/data` gitignore: **đúng**, giữ nguyên.

---

## Quyết định đã khóa (steward)

| # | Quyết định |
|---|------------|
| Neo | **75 tuổi / 2015** |
| Profile nguồn | Notion/PDF KB → draft trên PR #6 |
| Values / câu mẫu | Placeholder → hiệu đính mẹ sau OCR |
| Taboo | Chính trị · tình dục · trái luật · trái đạo đức · không bịa |
| Thơ | ~20 ảnh sẵn, ~40+ tổng; trang in lục bát |
| Quote | Toggle; **default paraphrase** |
| Signature | 2–3 bài luôn trong system prompt |
| Themes | `vo_chong` `con_cai` `gia_dinh` `nghe_giao` `tho` `biet_on` `truyen_thong` |
| Review text | Mẹ + steward trước |
| Voice | Đủ dùng |
| Retrieval | **Không vector** (xem §3) |
| Live context | Tóm tắt 1–2 câu; **opt-in theo thread** (xem §4) |

---

## 0. Trình tự an toàn (thay “B trước A”)

```
A0  Siết cổng activate + tag match + status gathering/awakening
A1  Identity Lock columns (schema_patch) + API PATCH + màn Bản sắc tối thiểu
A2  Kill switch (ready → paused/dormant) + (tuỳ chọn) ACL chat mẹ+steward
    │
    ▼
M   Merge PR #6 pack/OCR scripts vào main (nếu A0–A2 land trên nhánh khác: rebase)
    │
    ▼
B1  kind=poem + batch import OCR JSON + nhãn UI Thư viện
B2  Chạy OCR local → review → import (gate KHÔNG mở chỉ vì thơ)
    │
    ▼
C   heritage_chat.py mới: Lock + 2–3 chữ ký + 3–6 bài theme/keyword
    + quote toggle + citation meta + adversarial tests + live context opt-in
```

**Không** import ≥5 `heritage:{id}` trước A0.

---

## 1. Cổng activate — sửa trước ingest (A0)

### 1.1 Bug hiện tại

`can_activate = voice_ok ∧ knowledge_ok(≥5 tag heritage:*) ∧ status≠ready`.  
Voice đã sẵn → bài thơ thứ 5 gắn tag là đủ mở nút, dù Lock còn placeholder.

### 1.2 Gate mới (đề xuất)

`can_activate` cần **cả bốn**:

1. **Voice** — ≥1 mẫu processed (giữ)  
2. **Knowledge neo** — ≥ N item *không phải* thơ thuần (note/milestone/time-capsule…) **hoặc** tách counter `poem_count` chỉ để hiển thị, **không** mở activate  
3. **Profile tối thiểu** — steward đã lưu Lock với: `core_values` (≥3 không còn status=placeholder), `speech_style.traits`, `address_forms`, `taboos.hard`, và `profile_reviewed_at` (mẹ hoặc steward tick “đã hiệu đính”)  
4. **Chưa ready** — như cũ  

Cách đếm thơ an toàn hơn (chọn một, ưu tiên a):

- **(a)** `knowledge_count` **loại** `kind=poem` khỏi ngưỡng activate; thơ có `poem_count` riêng trên UI Thổi hồn  
- **(b)** Tag thơ `heritage-poem:{id}` — không đếm vào `heritage:{id}`  

Khuyến nghị **(a)** khi đã có `kind=poem`; trước đó tạm **(b)** hoặc chưa import thơ.

### 1.3 Tag match

Thay `tags.contains(needle)` bằng match token (split theo `,` / whitespace) **đúng bằng** `heritage:{id}` — tránh tiền tố.

### 1.4 Entity status

| Status | Ý nghĩa UI |
|--------|------------|
| `dormant` | Chưa có giọng và chưa có tri thức/profile |
| `gathering` | Đang gom (có giọng **hoặc** ký ức **hoặc** draft Lock) — chưa đủ activate |
| `awakening` | Đủ điều kiện `can_activate` — chờ steward bấm kích hoạt |
| `ready` | Đã kích hoạt chat |
| `paused` | Kill switch — từng ready, tạm tắt |

Sửa nhánh chết: đủ gate → `awakening`; có dữ liệu nhưng chưa đủ → `gathering`.

### 1.5 Kill switch (A2, bắt buộc)

`POST …/pause-heritage` (steward/owner): `ready|awakening` → `paused`.  
`POST …/resume-heritage`: chỉ khi gate vẫn đạt → `ready`.  
UI Thổi hồn + thread Ký ức: khi `paused` không gọi LLM.

---

## 2. Identity Lock — chỗ chứa (A1)

`IdentityProfile` hiện thiếu chỗ. Phase A qua `schema_patch.py` (ADD COLUMN, không Alembic):

| Cột (đề xuất) | Kiểu | Nội dung |
|---------------|------|----------|
| `life_stage_json` | TEXT | neo 75/2015 |
| `roles_json` | TEXT | vai trò |
| `address_forms_json` | TEXT | xưng hô |
| `speech_style_json` | TEXT | traits + sample_phrases |
| `core_values_json` | TEXT | values |
| `philosophy_json` | TEXT | blurb + signature poem ids |
| `taboos_json` | TEXT | hard + heritage_rules |
| `poetry_quote_mode` | VARCHAR | `paraphrase` \| `verbatim` |
| `dynamic_context` | TEXT | ô steward (ngắn) |
| `profile_reviewed_at` | TIMESTAMPTZ | tick hiệu đính |
| `profile_reviewed_by` | FK user | |

Prompt assemble từ DB row mỗi request → đạt DoD “sửa Profile không cần deploy”.

Khối lượng: schema + PATCH API + màn Bản sắc + readiness fields (`profile_ready`, `poem_count`, …). **Không** giảm thành “Draft JSON sẵn”.

Draft nội dung: `docs/heritage-bo-trieu/identity-lock.draft.json` trên PR #6.

---

## 3. Retrieval thơ — không vector (điều chỉnh lớn)

### 3.1 Token (~40 bài)

Ước lượng (đo lại sau OCR): ~300–350 token/bài → 40 bài ≈ **12–20k** input tokens.  
Gemini Flash chịu được cửa sổ; chi phí gia đình nhỏ so với TTS.  
**Vấn đề thật không phải tiền** mà là sự chú ý model:

- Identity Lock bị chìm trong biển thơ  
- Twin dễ trả lời bằng lục bát cho câu đời thường  
- Phá default paraphrase (dễ trích nguyên văn ngoài ý muốn)

### 3.2 Chiến lược chọn

Mỗi lượt:

1. **2–3 bài chữ ký** luôn trong system prompt (đã khóa #8)  
2. **+ 3–6 bài** lọc SQL: `kind=poem` ∧ theme overlap ∧ (optional) keyword từ câu hỏi  
3. Tổng thơ ~**2–4k** token/lượt  

Ngưỡng tính lại vector: corpus ≳ **200** bài **hoặc** thêm thư/transcript → ≳ **50k** token. Trước đó không dựng pgvector.

---

## 4. Live context (§1.3 revise)

**Không** nhồi 15 tin thô (token + latency; TTS mục tiêu phản hồi ~3–5s).

- Một pass tóm tắt nhẹ → **1–2 câu** ngữ cảnh (“Mẹ đang mệt nhẹ; cháu Tũn khoe điểm 10”)  
- Cộng `dynamic_context` steward nếu có  
- **Opt-in theo thread** Phòng khách (mặc định tắt): thành viên biết tin mình có thể vào Ký ức — không opt-out im lặng  

Taboo vẫn lọc trước khi tóm tắt.

---

## 5. Phase B — thơ (sau gate)

| Hạng mục | Việc |
|----------|------|
| Merge | Đưa OCR scripts + docs pack từ PR #6 vào main |
| OCR | `FOREVER_POETRY_PHOTOS=…/Trieu/Thơ` + `./scripts/ocr-poetry-ingest.sh` (local) |
| API | `kind=poem`; **batch import** từ OCR JSON (steward) — không tạo tay 40 ghi chú |
| Tags | `heritage:{id}` + themes; không dùng thơ để đạt knowledge gate |
| UI | Nhãn/icon thơ trong `library/[spaceId].tsx`, `memoryDisplay.ts` |
| Privacy | Body thơ chỉ `data/` (gitignore) + DB space |

---

## 6. Phase C — heritage chat (service mới)

Không tái dùng `generate_agent_reply` / `maybe_reply` (chúng chặn non-family và map history chỉ `user`/`agent`).

`services/heritage_chat.py` + hook khi `thread.kind == heritage` ∧ status `ready`:

1. Load Lock từ DB → system prompt  
2. Chèn signature poems + 3–6 retrieved  
3. Live context nếu thread nguồn opt-in  
4. History gồm cả `sender_kind=heritage`  
5. Quote mode từ profile/setting  
6. Verbatim → ghi **citation meta** trên Message (tên bài / memory_id) để UI “trích từ…" và đối sổ  
7. Hard refuse thiếu data / taboo **trước và sau** LLM  

**Cô lập:** UI vào thẳng thread Ký ức; API không bao giờ trả lời heritage bằng agent “Người giữ nhà”. Mẹ không chạm refusal lạnh của bot chung trên luồng này.

### 6.1 ACL theo giai đoạn

Ship text sớm: chỉ **mẹ + steward** gửi tin / thấy trả lời trên heritage thread (hoặc soft-gate “chế độ thử”).  
Mở cả nhà sau khi dry-run OK. Hạng mục engineering riêng — không để mặc định mọi member.

### 6.2 Adversarial regression

Bộ ~15 câu cố định (bịa tiểu sử, đóng vai còn sống, chính trị, tình dục, …) chạy trong CI/test mỗi lần đổi prompt.  
“Đúng khẩu khí” vẫn do mẹ chấm; “không phá hàng rào” do test.

---

## 7. Definition of Done (cập nhật)

- [ ] PR pack/OCR đã merge main **hoặc** ghi rõ nhánh nguồn  
- [ ] Gate: không activate chỉ vì thơ; cần Profile đã hiệu đính + voice + knowledge neo  
- [ ] Kill switch pause/resume  
- [ ] Steward sửa Lock trên app; prompt rebuild từ DB  
- [ ] ≥20 bài (hướng 40+) `kind=poem`; batch import; nhãn UI  
- [ ] Mỗi lượt: 2–3 chữ ký + ≤6 bài theme/keyword — **không** full-corpus dump  
- [ ] Toggle paraphrase/verbatim + citation khi verbatim  
- [ ] Heritage history nhớ lượt trước; tách khỏi agent family  
- [ ] Live context opt-in + tóm tắt 1–2 câu  
- [ ] ACL mẹ+steward trước khi mở rộng  
- [ ] ~15 adversarial tests xanh  
- [ ] Dry-run 10 câu mẹ+steward trước TTS tinh chỉnh  

---

## 8. Việc không làm ở giai đoạn này

- pgvector / embedding service  
- Nhồi 40 bài mỗi request  
- Mở activate trước `profile_reviewed_at`  
- Tái sử dụng `maybe_reply` cho heritage  
- Auto-play TTS  

---

## 9. Điểm thảo luận còn mở (trước khi code)

1. **Knowledge neo sau khi loại thơ:** giữ N=5 note/milestone, hạ xuống 3, hay cho phép 0 nếu Profile đã reviewed + voice? (Đề xuất: N=3 note/milestone **hoặc** time-capsule — thơ không tính.)  
2. **ACL:** ẩn thread với member khác, hay hiện thread nhưng chặn send?  
3. **Citation meta:** JSON trên cột `Message.body` prefix / cột `Message.meta_json` mới (schema_patch)? Đề xuất `meta_json`.  
4. **Merge strategy:** land A0 gate fix trên nhánh này rồi mới OCR, hay PR gate riêng cherry-pick trước?  

Khi chốt 1–4 → bắt đầu implement theo §0 (A0 trước).
