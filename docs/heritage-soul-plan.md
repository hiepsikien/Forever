# Thổi hồn cho Bố — kế hoạch triển khai

> **Mục tiêu:** hoàn thiện trụ *bản sắc + tri thức* (Profile / Memories) sau khi Voice DNA ~70%.  
> **Nguyên tắc:** Identity Lock bất biến · Memories retrieve theo ngữ cảnh · không bịa tiểu sử · label rõ tin nhắn Ký ức.  
> **Phạm vi repo:** Forever only (không đụng Read book).

---

## 0. Hiện trạng (gap)

| Lớp | Đã có | Thiếu |
|-----|-------|-------|
| **Giọng (Voice DNA)** | Profile, mẫu, extract, clone, TTS speak | Tinh chỉnh clone / chọn mẫu (~30% còn lại) |
| **Hồ sơ nhân dạng** | `IdentityProfile` mỏng: tên, quan hệ, status, thread | Core values, giọng điệu, xưng hô, taboo, system prompt |
| **Ký ức / RAG** | `MemoryItem` + tag `heritage:{id}`; gate ≥5 item để activate | Vector / embedding; kind thơ; milestone có cấu trúc; live context |
| **Chat Ký ức** | Thread `kind=heritage`; activate → `ready` | LLM reply cho heritage; inject Profile + retrieved memories; refuse khi thiếu data |
| **UX Thổi hồn** | 3 trụ: Giọng · Ký ức (đếm tag) · Kích hoạt | Trụ Profile riêng; nhập thơ; preview “nghe như bố”; steward review |

Agent hiện tại (`Người giữ nhà`) **cố ý từ chối** đóng vai người đã mất — đúng hard rule. Heritage twin là luồng riêng trên thread `heritage`, không mở rộng agent family.

---

## 1. Kiến trúc dữ liệu (Profile vs Memories)

Khớp mô hình sản phẩm *Cái bất biến / Cái biến đổi* trong `docs/PROJECT.md`:

```
Identity Lock (Profile)          Context Key (Memories)
─────────────────────────        ────────────────────────────
system_prompt / identity JSON    poetry (vector)  ← tuyển tập thơ
  · nhân thân & vai trò            milestones       ← mốc gia đình
  · hệ giá trị & triết lý          library notes    ← đã có MemoryItem
  · ngôn ngữ & xưng hô             live_context     ← chat / cập nhật gần đây
  · taboo / không nói
        │                              │
        └──────────► Heritage LLM ◄────┘
                     (thread kind=heritage)
```

### 1.1 Profile — bất biến trong prompt

Lưu trên `IdentityProfile` (hoặc bảng `identity_lock` 1:1), steward-editable, versioned nhẹ (`updated_at` + optional revision note):

| Trường | Ý nghĩa |
|--------|---------|
| `display_name`, `relation_label` | Đã có |
| `life_stage_note` | “Phiên bản chín muồi” (vd. tuổi bảy nhăm) — không bịa năm sinh nếu chưa chắc |
| `roles` | Chồng của mẹ · cha của … |
| `core_values` | 5 giá trị + ví dụ hành vi ngắn |
| `philosophy` | Đoạn ngắn / câu cửa miệng (có thể trích thơ đã gắn nguồn) |
| `speech_style` | Từ tốn, ấm, thâm trầm; hay chiêm nghiệm |
| `address_forms` | anh–em (với mẹ), bố–con, … |
| `taboos` | Điều không nói / không giả |
| `sample_phrases` | 5–15 câu mẫu thật (từ thư, FB, lời mẹ nhớ) |
| `system_prompt_override` | Optional; mặc định assemble từ các field trên |

**Hard:** mọi claim tiểu sử trong Profile phải có nguồn (steward confirm) hoặc đánh dấu `unverified` và model được instruct không khẳng định chắc.

### 1.2 Memories — retrieve theo câu hỏi

| Loại | Lưu trữ đề xuất | Retrieve khi |
|------|-----------------|--------------|
| **Thơ** | `MemoryItem` `kind=poem` (+ metadata: title, year?, themes[]) **hoặc** bảng `poetry_works` + chunks; embedding per bài / per khổ | Chủ đề (tuổi già, vợ chồng, nghề giáo, biết ơn…) |
| **Milestone** | `MemoryItem` `kind=milestone` hoặc note + tag `milestone` + `occurred_at` | Nhắc chuyện cũ / ngày kỷ niệm |
| **Library chung** | `MemoryItem` đã gắn `heritage:{id}` | Câu hỏi rộng về ký ức |
| **Live context** | Snapshot từ N tin nhắn family gần đây + optional `dynamic_context` JSON steward | “Bây giờ cả nhà đang…” |

Vector: bắt đầu **pgvector trên Postgres** (hoặc embedding table + cosine in-app nếu chưa bật extension). Chunk thơ theo khổ/bài; metadata filter `identity_id` + `kind`.

---

## 2. Luồng chat Ký ức (Phase 3)

1. User gửi tin trên `heritage` thread gắn identity Bố.  
2. Retrieve top-k (thơ + milestone + library) theo embedding query.  
3. Build prompt = Profile (Lock) + retrieved excerpts + live context ngắn + lịch sử thread.  
4. Generate (Gemini hoặc model đã cấu hình) với temperature thấp–vừa.  
5. Post-check: nếu model khẳng định sự kiện không có trong retrieved / Profile → rewrite / refuse nhẹ (“Con ơi, bố chưa để lại chi tiết đó…”).  
6. Persist `sender_kind=heritage`; UI label rõ (đã có pattern).  
7. Optional TTS qua Voice DNA sẵn có — **không auto-play**.

Gate activate giữ nguyên: voice processed ≥1 + knowledge ≥ target; **bổ sung** Profile tối thiểu (core_values + speech_style + ≥1 address_form) trước khi cho chat “đúng bố”.

---

## 3. Lộ trình triển khai (engineering)

### Phase A — Profile scaffold *(ưu tiên nội dung + API)*

- Mở rộng schema `IdentityProfile` / Identity Lock fields.  
- API GET/PATCH steward-only.  
- Mobile: màn **Bản sắc** trong Thổi hồn (form theo checklist Phase 0).  
- Assemble `build_heritage_system_prompt(identity)`.  
- Seed worksheet trống cho Bố (không điền tiểu sử giả).

### Phase B — Thơ vào Memories + ingest

- Định dạng nhập: Markdown / plain text một bài một file, hoặc paste bulk có delimiter.  
- Steward UX: Thư viện → **Thêm thơ** (title, body, themes, gắn identity).  
- Tag tự động `heritage:{id}` + `poetry`.  
- Script offline `scripts/ingest-poetry.py` cho 30–40 bài lần đầu (family-private data, không commit thơ gốc nếu nhạy cảm — lưu media/DB).  
- Embedding job (sync on create/update).

### Phase C — Heritage reply engine

- `services/heritage_chat.py`: retrieve → prompt → generate → safety.  
- Hook vào `messages` khi `thread.kind == heritage` và entity `ready`.  
- Tests: refuse fabricated bio; cite/paraphrase poem when theme matches; empty RAG → khiêm tốn.  
- Awakening UI: bỏ copy “AI sẽ bổ sung sau”; thêm preview câu trả lời thử (steward only).

### Phase D — Milestones + Live context

- Milestone CRUD nhẹ (ngày cưới, biến cố… — chỉ sự kiện gia đình xác nhận).  
- Live context: kéo N tin family gần đây (đã redact nếu cần) vào prompt slot “đời sống hiện tại”.  
- Optional steward `dynamic_context` note (vd. “Mẹ vừa về quê”).

### Phase E — Voice DNA còn lại (~30%)

- Song song / sau khi text “đúng bố” theo đánh giá mẹ + con (đúng sequencing PROJECT.md).  
- Clone selection (`docs/voice-dna-clone-selection.md`), TTS A/B.

---

## 4. Thứ tự làm việc với gia đình (nội dung)

Song song code Phase A:

1. **Worksheet Profile** (1 buổi với mẹ / anh chị): 5 giá trị, xưng hô, taboo, 10 câu mẫu.  
2. **Số hóa thơ**: OCR/đánh máy → review chính tả → gắn theme (3–5 tag/bài).  
3. **10 milestone neo** (có năm gần đúng càng tốt; thiếu thì để khoảng).  
4. **Dry-run**: 10 câu hỏi mẹ thường hỏi → chấm “có giống bố không / có bịa không”.  
5. Chỉ khi text ổn → đẩy TTS bằng Voice DNA hiện có.

---

## 5. Tiêu chí xong (Definition of Done)

- [ ] Steward sửa được Profile; prompt rebuild không deploy lại.  
- [ ] ≥30 bài thơ searchable; hỏi đúng chủ đề → retrieve đúng bài/khổ.  
- [ ] Heritage chat trả lời đúng khẩu khí Profile; thiếu data thì thừa nhận.  
- [ ] Không tin nào `sender_kind=heritage` bị nhầm với user sống trên UI.  
- [ ] Mẹ dùng được luồng Thổi hồn → chat mà không cần hiểu vector/RAG.  
- [ ] Export được Profile JSON + danh sách thơ/metadata (archive gia tộc).

---

## 6. Rủi ro & quyết định kỹ thuật

| Rủi ro | Hướng xử lý |
|--------|-------------|
| Thơ bị paraphrase sai ý | Prompt: ưu tiên trích ngắn + ghi tên bài; không “sáng tác thơ mới nhân danh bố” trừ khi steward bật mode thử nghiệm |
| Embedding tiếng Việt yếu | Đánh giá model đa ngữ (vd. Gemini embedding / multilingual-e5); fallback keyword + theme tags |
| Nhầm Identity Lock với tin thời sự | Live context chỉ “chiếu qua” Lock — không cập nhật giá trị cốt lõi từ chat |
| Privacy thơ gia đình | Không đưa thơ vào repo public; chỉ DB/media private của space |

**Quyết định mặc định (đổi được sau khi trả lời mục 7):**

1. Thơ = `MemoryItem.kind=poem` trước; tách bảng riêng nếu metadata phức tạp.  
2. Vector = bảng `memory_embeddings` + provider cấu hình qua env (Gemini embedding ưu tiên vì đã có Gemini cho agent).  
3. Profile fields trên `identity_profiles` (JSON text columns) trước khi normalize.

---

## 7. Câu hỏi cần gia đình / steward trả lời

### Nội dung Profile
1. Tên hiển thị + cách mẹ gọi bố / bố gọi mẹ / bố gọi các con (chính xác từng cặp)?  
2. “Phiên bản” tuổi / giai đoạn đời muốn neo (vd. tinh thần *Tuổi bảy nhăm*) — có năm cụ thể không, hay chỉ cảm nhận?  
3. Năm giá trị cốt lõi + mỗi giá trị một kỷ niệm/hành vi thật?  
4. Taboo: điều bố **không bao giờ** nói / không muốn AI nói nhân danh bố?  
5. 5–15 câu cửa miệng hoặc câu an ủi mẹ / khuyên con mà gia đình còn nhớ nguyên văn?

### Tuyển tập thơ
6. Số bài khoảng bao nhiêu? Đã đánh máy / PDF / ảnh sổ tay?  
7. Có được phép trích nguyên văn trong chat, hay chỉ “mượn ý / phong cách”?  
8. Bài nào là neo bắt buộc luôn có trong Profile (vd. *Tuổi bảy nhăm*) dù không retrieve?  
9. Theme tags ưu tiên (gợi ý: vợ chồng, tuổi già, nghề giáo, quê hương, biết ơn, đạo đức, thiên nhiên…)?

### Milestones & live context
10. 10 mốc gia đình nào chắc chắn được phép kể (ngày cưới, ngày mất, chuyển nhà…)?  
11. Live context lấy từ Phòng khách chung — có tin nào **không** được đưa vào prompt Ký ức không?

### Đánh giá & ưu tiên
12. Ai chấm “đủ giống bố” để ship chat text: mẹ alone, hay mẹ + ≥1 con?  
13. Ưu tiên tiếp theo sau Profile draft: **ingest thơ** hay **heritage chat stub** (prompt Profile-only, chưa RAG)?  
14. Voice DNA còn thiếu phần nào cụ thể (chất lượng clone, đủ mẫu, TTS cảm xúc) để xếp Phase E?

---

## 8. Đề xuất bước ngay (khi có câu trả lời)

1. Điền Profile v0 từ câu 1–5 → API + màn Bản sắc.  
2. Theo câu 13: song song ingest thơ (6–9) **hoặc** heritage chat Profile-only.  
3. Dry-run 10 câu với mẹ trước khi bật TTS.  
4. Cập nhật `docs/PROJECT.md` Phase 3 checklist khi Phase A+C land.

*Tài liệu này là kế hoạch triển khai — chưa implement schema/API.*
