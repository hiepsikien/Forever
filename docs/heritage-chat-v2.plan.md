# Heritage Chat v2 — Context-Aware Pipeline

> Trạng thái: Phase 0 và Phase 1 đã xong; Phase 2 (Context Analyzer) là bước kế.
> Bối cảnh: sau buổi thử đầu tiên với mẹ, chat của Bố Triệu bị hai lỗi lớn —
> xác định sai người đối thoại, và trả lời dài như một bức thư.
> Bản v1 (`services/heritage_chat.py`) đã vá tạm bằng rule; v2 dựng lại luồng
> để Bố "hiểu ngữ cảnh" thật sự mà vẫn neo chặt vào Identity Lock.

## Nguyên tắc

1. **Gemini phân tích, Lock quyết định.** LLM chỉ sinh dữ liệu có cấu trúc
   (ContextFrame) và văn phong. Xưng hô, giá trị cốt lõi, điều cấm do code +
   Identity Lock chốt — không để model tự suy.
2. **Deterministic trước, LLM sau.** Việc nào regex/SQL làm được thì không gọi model.
3. **Không có bằng chứng thì không khẳng định.** Mọi tên/năm/sự kiện trong reply
   phải truy được về một evidence item có `id`.
4. **Degrade an toàn.** Gemini lỗi/timeout → rơi về pipeline v1, không vỡ chat.
5. **Mọi tính năng mới có cờ tắt** — rollback tức thì nếu gia đình thấy lạ.

## Pipeline

```
POST /threads/{id}/messages  →  201 ngay (không chờ AI)
                                     │
                                     ▼ BackgroundTask (session riêng)
Stage 0 · Pre-flight        taboo guard · audience theo profile · alias scan
Stage 1 · Context Analyzer  Gemini flash, JSON mode, temp 0 → ContextFrame
Stage 2 · Retrieval         SQL thuần → EvidencePack (có id, token-budgeted)
Stage 3 · Compose           Gemini, temp 0.5, systemInstruction = Identity Lock
Stage 4 · Guardrails        fix xưng hô · anti-repeat · grounding · trim
Stage 5 · Write-back        ThreadMemory compaction · MemoryCandidate queue
```

## ContextFrame (Stage 1)

Gemini trả JSON theo schema chặt (`responseMimeType: application/json`):

```json
{
  "intent": "smalltalk | ask_person | ask_event | ask_advice | share_news | meta | grief",
  "depth": "ack | short | story",
  "emotion": "neutral | warm | sad | proud | worried | playful",
  "audience_hint": "spouse | child | grandchild | unknown",
  "entities": [{ "mention": "Hương", "entity_id": "huong", "confidence": 0.9 }],
  "unresolved_mentions": ["Nam"],
  "topics": ["con_cai", "gia_dinh"],
  "retrieval_queries": ["con gái đi xa"],
  "new_facts": [{ "text": "Con đang test server local", "about": "steward" }],
  "needs_clarification": false,
  "clarify_question": null
}
```

Ba ràng buộc:

- `audience_hint` **chỉ** dùng khi không resolve được `IdentityProfile` của người
  gửi. Có profile → rule thắng. Không bao giờ để model đoán vai.
- `entity_id` chọn từ alias list gửi kèm prompt (closed set) — model không tự bịa id.
- `depth` điều khiển độ dài: `ack` = 1 câu, `short` = 2–3 câu, `story` = 4–6 câu.

## Family Codex (Stage 2)

Bảng `family_entities` — tách khỏi `IdentityProfile` để không làm rối màn
Voice DNA khi thêm hàng chục người thân.

| Cột | Ghi chú |
|---|---|
| `id`, `space_id` | |
| `identity_profile_id` | nullable — link khi người đó là member/heritage |
| `canonical_name` | «Nguyễn Lê Hương» |
| `aliases_json` | `["Hương","Phương","con gái đầu"]` |
| `relation_json` | `{"to_subject":"con gái","order":1}` |
| `address_json` | override xưng hô riêng nếu có |
| `disambiguation` | «Khác cháu Xuân Nam» |
| `status` | `draft \| approved` — chỉ `approved` vào prompt |

Seed từ `roles_json` trong `docs/heritage-bo-trieu/identity-lock.final.json`.

Milestones dùng lại `MemoryItem(kind="milestone")` + `occurred_at` (đã có sẵn
trong schema), import từ `docs/heritage-bo-trieu/milestones.draft.json`.

Cả hai chạy bằng `scripts/seed-heritage-context.py --identity <id> [--approve]`.
Milestone retrieval chấm theo whole-word overlap + năm, có ngưỡng tối thiểu để
một câu chào không kéo cả cuộc đời vào prompt. Câu hỏi diễn đạt khác từ trong
kho ("cưới" vs "kết hôn") sẽ do `retrieval_queries` của analyzer xử lý ở Phase 2.

## Value Lens (Stage 3)

Thay vì để core values nằm chết trong prompt như một danh sách, chọn 1–2 giá trị
liên quan theo `intent` + `topics` rồi inject thành chỉ dẫn hành vi:

| Topic / intent | Value lens (id trong Lock) |
|---|---|
| `vo_chong` | `marital_fidelity`, `family_love` |
| `con_cai` + `ask_advice` | `moral_integrity`, `filial_piety` |
| `nghe_giao` | `teacher_craft` |
| `grief`, tuổi tác | `serene_aging` |
| mặc định | `family_love` |

Thứ tự trong `systemInstruction`: Identity Lock → Audience → Value Lens → Style
→ Evidence. Lock luôn đứng đầu, ContextFrame không ghi đè được.

## Guardrails (Stage 4)

| Check | Cách làm | Khi fail |
|---|---|---|
| Xưng hô | `_fix_spouse_address` / `_fix_child_address` | thay thế tại chỗ |
| Grounding | năm `\b(19\|20)\d{2}\b` + danh từ riêng phải có trong EvidencePack/Lock | critic rewrite |
| Anti-repeat | Jaccard token vs 3 reply heritage gần nhất > 0.6 | regenerate 1 lần |
| Độ dài | so với `depth` | cắt theo câu |
| Taboo | `looks_like_taboo` | câu từ chối |

Critic là lời gọi Gemini thứ ba, **chỉ chạy khi có flag** (~10% lượt).

## Trí nhớ (Stage 5)

- `thread_memory`: `summary_json` = `{facts_learned, topics_open, already_said,
  emotional_tone, entities_seen}`, compaction mỗi 6 lượt, chạy background.
- `memory_candidates`: `new_facts` vào hàng đợi `pending` → steward duyệt →
  `MemoryItem(kind="knowledge")`. Chat nuôi Thư viện, Thư viện nuôi chat.

## Cấu trúc code

Giữ file phẳng theo đúng style `services/` hiện tại:

```
services/heritage_gemini.py     client chung: text + JSON mode, retry, fallback
services/heritage_codex.py      alias resolve, entity lookup
services/heritage_retrieval.py  EvidencePack
services/heritage_analyzer.py   Stage 1 (Phase 2)
services/heritage_memory.py     Stage 5 (Phase 3)
services/heritage_chat.py       orchestrator (đã có)
```

Không có Alembic — bảng mới qua `Base.metadata.create_all`, cột mới thêm vào
`schema_patch.ensure_schema()`.

## Ngân sách

| Stage | Khi nào | In/Out | Latency |
|---|---|---|---|
| Analyzer | mỗi lượt | ~1.2k / 200 | 0.4–0.8s |
| Compose | mỗi lượt | ~2.5k / 400 | 1–2s |
| Critic | ~10% lượt | ~1k / 300 | 0.8s |
| Compactor | mỗi 6 lượt, background | ~2k / 250 | không chặn |

p50 ≈ 2–3s → Phase 0 bắt buộc chuyển reply sang background.

## Lộ trình

| Phase | Nội dung | Acceptance |
|---|---|---|
| 0 ✅ | Background dispatch + client Gemini chung + feature flags | POST trả 201 <200ms; tắt cờ → hành vi y hệt v1 |
| 1 ✅ | Family Codex + milestone import + EvidencePack | Hỏi «Hương» ra đúng con gái + đúng bài thơ |
| 2 | Context Analyzer + Value Lens + depth control | Câu meta → ack 1 câu; hỏi sâu → 4–6 câu có trục giá trị |
| 3 | ThreadMemory + anti-repeat | 10 lượt liên tiếp không lặp câu hỏi thăm |
| 4 | Grounding check + critic | Bịa năm/tên = 0 trên bộ golden |
| 5 | MemoryCandidate + steward review UI | Fact từ chat vào Thư viện sau khi duyệt |

## Đánh đổi

| Quyết định | Vì sao | Giá phải trả |
|---|---|---|
| 2 lời gọi Gemini/lượt | Tách "hiểu" khỏi "nói" → prompt ngắn, test được | +latency, +cost ~2x |
| Bảng `family_entities` riêng | Không làm rối `IdentityProfile`/Voice DNA UI | Duplicate nhẹ với identity |
| Fact mới cần steward duyệt | Hard rule không bịa tiểu sử | Bố "nhớ" chậm hơn một nhịp |
| Reply async | Chat không treo | Mobile cần refetch (đã có typing indicator) |

## Riêng tư

Analyzer gửi nội dung gia đình lên Gemini — compose hiện tại đã gửi rồi nên
không phát sinh loại phơi nhiễm mới. Riêng `new_facts` gated qua steward.
