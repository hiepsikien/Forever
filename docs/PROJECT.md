# Forever — Product & Engineering Plan

> **Định danh:** Két sắt ký ức gia tộc (*The Family Vault*) — không cạnh tranh Zalo/Messenger (nhắn nhanh) hay Facebook (phô diễn xã hội).  
> **Tầm nhìn:** phòng khách số riêng tư — chat người thân + shared library + thực thể ký ức sống (cognitive heritage).  
> **Người nhận đầu tiên:** mẹ. Bắt đầu từ gia đình mình, piece by piece.  
> **Nguồn luận:** Forever App Brainstorm (31/7/2026).

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
| Con cần riêng tư | Tôn trọng ranh giới | **Private compartments** (post-MVP) — nhật ký riêng, chia sẻ chọn lọc |

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

## 6. MVP scope (1 gia đình — gift for mother)

### In scope (gần)
- Auth + invite  
- Family space + chat (living members)  
- Shared library (ảnh, ghi chú, audio)  
- Identity profile + heritage AI **text** (RAG + system prompt)  
- Time-capsule interview prompts (ít nhất bản tối giản)  
- Owner / Member  

### Out of scope gần (giữ trong roadmap)
- Voice clone / conversational voice production  
- Emotional Translator tự động  
- Private compartments đầy đủ  
- E2E / IPFS / on-chain family tree  
- Social graph, marketplace  

## 7. Lộ trình piece by piece

### Phase 0 — Thu thập & làm sạch nguyên liệu
| Nguồn | Việc cần làm |
|-------|----------------|
| Giọng nói | Video, Zalo voice, cuộc gọi ghi âm → lọc nhiễu (Adobe Podcast Enhance / tương đương); ưu tiên ngữ điệu ấm, bình thản |
| Văn bản | Sổ tay, thư, tin nhắn; **Facebook/Meta Download Your Information** (JSON + media High, All time nếu được) |
| Triết lý | Worksheet: câu cửa miệng, cách an ủi mẹ, cách khuyên con, taboo |
| Ảnh | Album mốc đời + caption/ngữ cảnh |

Checklist Identity Lock:
- [ ] 5 giá trị cốt lõi (+ ví dụ hành vi)  
- [ ] Giọng điệu + mẫu câu  
- [ ] Taboo / điều không nói  
- [ ] Quan hệ với mẹ (xưng hô, biệt danh, thói quen quan tâm)  
- [ ] 10 kỷ niệm neo  
- [ ] Export FB (nếu có quyền / Legacy Contact)  

### Phase 1 — Family chat skeleton *(scaffold hiện tại)*
Vehicle quen thuộc cho mẹ & anh chị em.  
Done: ≥2 người chat ổn trên điện thoại thật.

### Phase 1b — Time-Capsule Interview (wedge UX)
- Bộ câu hỏi cội nguồn  
- Trả lời bằng voice note → lưu vào library  
- Playback bất đồng bộ cho thành viên  

### Phase 2 — Shared Memory Library → mầm Family Codex
- `MemoryItem` + save-from-chat  
- Timeline theo thời gian (+ tag người / sự kiện)  
- Sau: Memory Curator tổng hợp niên giám  

### Phase 3 — Cognitive Twin (text)
- `IdentityProfile` + embeddings + RAG  
- System prompt tính cách; refuse khi thiếu data  
- Context Key từ chat đời sống  

### Phase 4 — Voice DNA
- Audio clean → Instant Voice Clone (ElevenLabs); API key trong **Cài đặt không gian**
- Hai luồng: giọng sống (self) + giọng ký ức (steward/owner + Identity Profile)
- TTS optional, **không auto-play**
- Voice DNA thường vài chục MB–<1GB (raw + model)  

### Phase 5 — Micro-rituals & Bridge soft features
- Nghi thức tuần (1 câu hỏi / 1 ảnh cũ)  
- Gợi ý kể chuyện bất đồng bộ thay vì ép “nói chuyện thẳng”  

### Phase 6 — Trường tồn & chủ quyền
Blockchain **không** để lưu video/ảnh nặng. Vai trò dài hạn:

1. **Data sovereignty** — quyền sở hữu / khóa gia tộc (kèm storage phi tập trung kiểu IPFS cho bản hash/metadata)  
2. **Proof of authenticity** — timestamp + hash tư liệu gốc chống giả mạo khi GenAI phổ biến  
3. **Generational handover** — smart-contract-like rules cho steward transfer  

Trước mắt: export archive ZIP/JSON + steward chỉ định trong app + encryption-at-rest roadmap.

## 8. Schema (Phase 1 hiện tại)

- `users`  
- `family_spaces`  
- `memberships` (owner|member)  
- `threads` (family|heritage)  
- `messages` (sender_kind: user|heritage)  
- `invites`  

Sắp tới: `memory_items`, `identity_profiles`, `interview_prompts`, `interview_answers`, `voice_profiles`, `space_settings`.

## 9. Success (món quà gửi mẹ)

1. Mẹ tự mở app và dùng được mà không cần hướng dẫn dài.  
2. Ít nhất một buổi tối bà cảm thấy được vỗ về — rồi bước ra tiếp tục sống (anchor, không giam cầm).  
3. Thực thể không bịa chuyện; thiếu thì thừa nhận.  
4. Có ít nhất vài time-capsule answers bằng giọng / chữ của bố trong library.  
5. Cả nhà cùng góp kỷ niệm; dữ liệu export được.  

## 10. Ưu tiên engineering sắp tới

1. Phase 0 data pack (song song với code)  
2. Ổn định Phase 1 chat trên device thật  
3. Library + interview prompts (wedge)  
4. Heritage text twin  
5. Voice layer khi text đã “đúng bố” theo đánh giá gia đình  
