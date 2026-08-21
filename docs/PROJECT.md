# Forever — Product & Engineering Plan

> **Định danh:** Két sắt ký ức gia tộc (*The Family Vault*) — không cạnh tranh Zalo/Messenger (nhắn nhanh) hay Facebook (phô diễn xã hội).  
> **Tầm nhìn:** phòng khách số riêng tư — chat người thân + shared library + thực thể ký ức sống (cognitive heritage).  
> **Người nhận đầu tiên:** mẹ. Bắt đầu từ gia đình mình, piece by piece.  
> **Nguồn luận:** Forever App Brainstorm (31/7/2026).  
> **Chi tiết thực thể ký ức:** `docs/heritage-chat-v2.plan.md` (pipeline, guardrails,
> trí nhớ). Tài liệu này giữ phần sản phẩm và lộ trình.

## 1. Core needs (khác mạng xã hội)

| Mạng xã hội | Forever |
|-------------|---------|
| “Hãy nhìn tôi này!” (validation & attention) | “Chúng ta là ai, và chúng ta sẽ đi về đâu?” (continuity & belonging) |

Ba nhu cầu neo sản phẩm:

1. **Legacy & Immortality** — sợ bị lãng quên; muốn để lại di sản tinh thần qua thế hệ.  
2. **Absolute Safety & Belonging** — vùng không phán xét; thuộc về vô điều kiện.  
3. **Rooted Identity** — neo cội nguồn để biết mình đứng đâu và bước tiếp thế nào.

## 2. Định vị trải nghiệm

**Là:** phòng khách số / két sắt ký ức / neo tinh thần.  
**Không phải:** mạng xã hội gia đình, nghĩa trang số tĩnh, chatbot generic, “revive” người chết như còn sống ở phòng bên.

### UX tâm lý (hard)

- **Chân thực vừa đủ:** label rõ thực thể ký ức; không đánh lừa rằng bố vẫn còn sống.  
- **Emotional anchor, không emotional opioid:** hỗ trợ *rooted remembrance*, không giam người sống trong quá khứ.  
- **Không ép đối thoại trực diện** giữa các thế hệ khi đang căng — app là **vùng đệm (buffer zone)**.

## 3. Rào cản thế hệ → nguyên tắc thiết kế

Nút thắt thực tế: bố mẹ giữ oai nghiêm; con trẻ cần riêng tư/độc lập; dễ tâm sự với người lạ hơn người thân; định kiến tích tụ lâu năm.

| Pain | Demand | Product response |
|------|--------|------------------|
| Ngượng / sĩ diện / sợ phán xét | Vùng đệm an toàn, không tranh luận trực diện | **Bridge of Time** — kể chuyện bất đồng bộ + AI trung gian |
| Đứt gãy ký ức, sợ lãng quên | Trường tồn bản sắc & cội nguồn | **Family Codex** — niên giám sống / timeline mạch lạc |
| Sống vội, ngại tương tác sâu | Gắn kết nhẹ, không gánh nặng | **Micro-rituals** — nghi thức ngắn định kỳ (1 câu hỏi / tuần) |
| Lời quan tâm hóa phán xét | Được hiểu đúng ý thương | **Emotional Translator** (post-MVP) — dịch cảm xúc giữa thế hệ |
| Con cần riêng tư | Tôn trọng ranh giới | **Private compartments** — đã có phòng riêng 1-1 với thực thể ký ức; nhật ký riêng vẫn post-MVP |

## 4. GTM & mũi khoan (wedge)

**Sai:** bán “mạng xã hội gia đình” → bị so với Zalo/FB nhóm.  
**Đúng:** bán **hành trình bảo tồn di sản / time-capsule thế hệ**.

- **Hook timing:** Tết, ngày giỗ, mừng thọ, khi thế hệ trước cao tuổi / vừa mất mát.  
- **Wedge feature:** **Time-Capsule Interview** — AI gợi câu hỏi cội nguồn; người lớn tuổi trả lời bằng **giọng nói** (nói dễ hơn viết); con cháu nghe lại bất đồng bộ.  
- **Vì sao wedge mạnh:** ít kháng cự, giá trị cảm xúc tức thì (giọng nói), không ép đối thoại live.

> **Sequencing note:** Scaffold kỹ thuật hiện tại là chat-first (vehicle dài hạn). Wedge *sản phẩm/GTM* ưu tiên time-capsule interview + thu thập ký ức. Hai hướng bổ sung nhau: chat = mái nhà; interview = lối vào cảm xúc.

## 5. Mô hình nhận thức (cốt lõi SP)

```
CÁI BẤT BIẾN (Identity Lock)
  Core values · tính cách · giọng · cách ra quyết định
  (định hình ~40 tuổi) — không tự “sống theo thời sự”
                ▲
                │ chiếu qua lăng kính
CÁI BIẾN ĐỔI (Context Key)
  Người sống cập nhật đời sống qua chat / library
  → thực thể phản hồi đúng bản sắc trong bối cảnh mới
```

**Living Family DNA** (không phải gene sinh học) gồm:

- Hệ giá trị & triết lý sống (kể cả ân hận / tâm nguyện)  
- Vân tay ngôn từ & biểu cảm (xưng hô, khẩu khí, hài hước)  
- Bản đồ ký ức liên thế hệ (sự kiện gia đình × bối cảnh thời đại)

### Hard rules

1. Không bịa tiểu sử hoặc sự kiện chưa có trong kho ký ức.  
2. Phân biệt rõ tin nhắn người sống vs. thực thể ký ức (UI label).  
3. Consent & stewardship; chuyển giao quyền Owner / steward.  
4. AI là neo tinh thần — không thay thế tang lễ hay trị liệu chuyên nghiệp.  
5. Bảo vệ tôn nghiêm thực thể số — không biến thành công cụ giải trí / deepfake tùy tiện.  
6. AI không phải bố; không thay gia đình; không quyết định thay người sống (tiền, sức khỏe, pháp lý, tâm linh, quan hệ).  
7. Không chia rẽ mẹ với các con. Sau nỗi nhớ, hướng về người thật.  
8. Tiêu chí tốt: nhớ lành mạnh và gắn với gia đình — không phải số lượt nói với AI.

Rule 1 không còn là lời nhắc trong prompt. Nó có bộ máy: grounding check chặn năm
và tên không có trong tư liệu, fact nghe được từ trò chuyện phải qua người duyệt,
và detector Stage 0 chặn lời khuyên đời sống nhạy cảm. Chi tiết:
`docs/heritage-chat-v2.plan.md`, `app.services.heritage_safety`.

## 6. MVP scope (1 gia đình — gift for mother)

### Đã xong
- Auth + invite; Owner / Member / steward  
- Family space + chat (living members)  
- Shared library (ảnh, ghi chú, audio, thơ)  
- Identity profile + heritage AI **text** — pipeline đầy đủ, xem §7 Phase 3  
- Time-capsule interview prompts  
- Voice DNA + Extract (vượt scope MVP ban đầu)  
- Phòng riêng 1-1 với thực thể ký ức  

### Còn ngoài scope (giữ trong roadmap)
- Emotional Translator tự động  
- Nhật ký riêng / chia sẻ chọn lọc từng `MemoryItem`  
- E2E / IPFS / on-chain family tree  
- Social graph, marketplace  
- **Mời vào nhà:** QR quét camera, duyệt admin trước khi join, sửa nhiều mã mời song song — `docs/join-invite.backlog.md`  

## 7. Lộ trình piece by piece

> Số phase ở đây là lộ trình sản phẩm, **không trùng** với Phase 0–5 trong
> `heritage-chat-v2.plan.md` (đó là các tầng của riêng pipeline chat).

### Phase 0 — Thu thập & làm sạch nguyên liệu
| Nguồn | Việc cần làm |
|-------|----------------|
| Giọng nói | Video, Zalo voice, cuộc gọi ghi âm → lọc nhiễu (Adobe Podcast Enhance / tương đương); ưu tiên ngữ điệu ấm, bình thản |
| Văn bản | Sổ tay, thư, tin nhắn; **Facebook/Meta Download Your Information** (JSON + media High, All time nếu được) |
| Triết lý | Worksheet: câu cửa miệng, cách an ủi mẹ, cách khuyên con, taboo |
| Ảnh | Album mốc đời + caption/ngữ cảnh |

Checklist Identity Lock — trạng thái cho **bố Triệu** (đã chốt 5/8/2026,
`docs/heritage-bo-trieu/`). Mỗi người được nhớ sau này làm lại từ đầu:

- [x] 5 giá trị cốt lõi (+ ví dụ hành vi) — 6 giá trị  
- [x] Giọng điệu + mẫu câu  
- [x] Taboo / điều không nói — 4  
- [x] Quan hệ với mẹ (xưng hô, biệt danh, thói quen quan tâm) — 5 lối xưng hô, 7 vai  
- [x] 10 kỷ niệm neo — 14 mốc, 18 bài thơ  
- [ ] Export FB (nếu có quyền / Legacy Contact)  
- [ ] Thư / sổ tay dạng văn bản — chưa có món nào vào Thư viện  

### Phase 1 — Family chat skeleton ✅
Vehicle quen thuộc cho mẹ & anh chị em.  
Done: ≥2 người chat ổn trên điện thoại thật.

### Phase 1b — Time-Capsule Interview (wedge UX) ✅
- Bộ câu hỏi cội nguồn  
- Trả lời bằng voice note → lưu vào library  
- Playback bất đồng bộ cho thành viên  

### Phase 2 — Shared Memory Library → mầm Family Codex ✅
- `MemoryItem` + save-from-chat  
- Timeline theo thời gian (+ tag người / sự kiện)  
- `family_entities` là mầm Codex đang chạy: alias → người thật, dùng để chat gọi
  đúng tên. Memory Curator tổng hợp niên giám vẫn còn phía trước.

### Phase 3 — Cognitive Twin (text) ✅ — nhưng **không** bằng embeddings
Đã chạy qua pipeline 5 tầng (`docs/heritage-chat-v2.plan.md`): phân tích ngữ cảnh
bằng Gemini → Codex + truy hồi → lăng kính giá trị → guardrails → trí nhớ.

Chệch có chủ ý so với kế hoạch cũ: **chưa dùng embeddings/vector RAG**. Ở quy mô
một gia đình (vài chục bài thơ, vài chục mốc đời), truy hồi theo từ khoá có chấm
điểm + Codex có cấu trúc cho kết quả kiểm được và gỡ được, còn vector thì mờ.
pgvector chỉ thêm khi có bằng chứng là truy hồi trượt, không phải vì nó hiện đại.

### Phase 4 — Voice DNA ✅
- Audio clean → Instant Voice Clone (ElevenLabs); API key trong **Cài đặt không gian**
- Hai luồng: giọng sống (self) + giọng ký ức (steward/owner + Identity Profile)
- TTS optional, **không auto-play** — trừ trong phiên «Gọi cho Bố», nơi mẹ vừa
  bấm nói và câu trả lời là thứ bà đang chờ (`docs/voice-to-voice.plan.md` §3)
- Voice DNA thường vài chục MB–<1GB (raw + model)
- Thêm ngoài kế hoạch: **Extract** — tách giọng bố khỏi video/ghi âm cũ thành
  `VoiceSample`, có bước người xem lại trước khi nhận (`Extract/`, `extract_jobs`)

### Phase 5 — Micro-rituals & Bridge soft features *(chưa bắt đầu)*
- Nghi thức tuần (1 câu hỏi / 1 ảnh cũ)  
- Gợi ý kể chuyện bất đồng bộ thay vì ép “nói chuyện thẳng”  

### Phase 6 — Trường tồn & chủ quyền *(chưa bắt đầu, trừ steward transfer)*
`steward_successions` đã có. Blockchain **không** để lưu video/ảnh nặng. Vai trò dài hạn:

1. **Data sovereignty** — quyền sở hữu / khóa gia tộc (kèm storage phi tập trung kiểu IPFS cho bản hash/metadata)  
2. **Proof of authenticity** — timestamp + hash tư liệu gốc chống giả mạo khi GenAI phổ biến  
3. **Generational handover** — smart-contract-like rules cho steward transfer  

Trước mắt: export archive ZIP/JSON + steward chỉ định trong app + encryption-at-rest roadmap.

## 8. Schema (hiện tại)

| Nhóm | Bảng |
|---|---|
| Người & không gian | `users`, `family_spaces`, `memberships`, `invites`, `space_settings`, `steward_successions` |
| Trò chuyện | `threads`, `messages` |
| Thư viện & phỏng vấn | `memory_items`, `interview_prompts`, `interview_answers` |
| Thực thể ký ức | `identity_profiles`, `family_entities`, `thread_memory`, `memory_candidates` |
| Voice DNA | `voice_profiles`, `voice_samples`, `voice_renders`, `extract_jobs`, `extract_segments` |

`threads` mang thêm `heritage_identity_id` + `audience_scope` (`family` \| `direct`)
+ `member_user_id`: mỗi người được nhớ có một phòng cả nhà và một phòng riêng cho
từng thành viên. Chưa có Alembic — bảng mới qua `create_all`, cột mới thêm vào
`schema_patch.ensure_schema()`.

## 9. Success (món quà gửi mẹ)

1. Mẹ tự mở app và dùng được mà không cần hướng dẫn dài.  
2. Ít nhất một buổi tối bà cảm thấy được vỗ về — rồi bước ra tiếp tục sống (anchor, không giam cầm).  
3. Thực thể không bịa chuyện; thiếu thì thừa nhận.  
4. Có ít nhất vài time-capsule answers bằng giọng / chữ của bố trong library.  
5. Cả nhà cùng góp kỷ niệm; dữ liệu export được.  

## 10. Ưu tiên engineering sắp tới

1. **Bộ golden ~20 câu hỏi** — file + checker cứng đã có:
   `docs/heritage-bo-trieu/golden-set.json`, chấm bằng
   `app.services.heritage_golden`, chạy tay
   `./scripts/run-heritage-golden.py --identity <id>`. Soft score (đúng giọng)
   vẫn do mẹ/steward; bước tiếp theo là chạy live trên API local rồi mới bật
   critic / tinh chỉnh pipeline theo số.  
2. **Quy hoạch lại trang Ký ức** — hub theo người + bốn kệ (A–E):
   `apps/mobile/app/library/[spaceId]/`, helpers `lib/libraryShelves.ts`,
   plan `docs/library-ia.plan.md`.  
3. **Voice-to-voice cho mẹ** — mẹ không chat được; nói và nghe thì được. STT
   (chưa có gì) → pipeline sẵn có → TTS gắn vào reply → màn «Gọi cho Bố».
   Kế hoạch: `docs/voice-to-voice.plan.md`. Bao trùm luôn mục «TTS trong chat».  
4. Bật critic (`HERITAGE_CRITIC_ENABLED`) sau khi golden live đạt *bịa năm/tên = 0*.  
5. Micro-rituals (Phase 5) và export archive (Phase 6) khi mẹ đã dùng đều.  

Đã xong: `visibility` trên `MemoryItem` (`family` / `private`) — fact nghe trong
phòng riêng có thể giữ lâu dài mà vẫn không thành chuyện của cả nhà. Luật đọc nằm
gọn trong `services/memory_scope.py`.

Nợ kỹ thuật đáng ghi: chưa có Alembic, `_knowledge_snippets` vẫn lấy «3 cái mới
nhất» thay vì theo độ liên quan như `retrieve_learned`.
