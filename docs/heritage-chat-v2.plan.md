# Heritage Chat v2 — Context-Aware Pipeline

> Trạng thái: Phase 0–5 đã xong. Còn lại: bộ golden để đo bằng số, và
> `visibility` trên `MemoryItem` nếu muốn fact riêng mà vẫn lâu dài.
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
  "entity_slugs": ["nguyen_le_huong"],
  "topics": ["con_cai", "gia_dinh"],
  "retrieval_queries": ["con gái đi xa"],
  "new_facts": ["Con đang test server local"]
}
```

Ba ràng buộc:

- `audience_hint` **chỉ** dùng khi không resolve được `IdentityProfile` của người
  gửi. Có profile → rule thắng. Không bao giờ để model đoán vai.
- `entity_slugs` chọn từ roster gửi kèm prompt (closed set); slug lạ bị loại khi parse.
- `depth` điều khiển cả chỉ dẫn câu chữ lẫn `maxOutputTokens` (192 / 384 / 768).

Kết quả đo trên dữ liệu Bố Triệu:

| Tin nhắn | intent · depth | Codex | Mốc đời |
|---|---|---|---|
| «Con đang chat với bố trên server local ạ.» | meta · ack | — | — |
| «con gái đầu của bố dạo này thế nào?» | ask_person · story | Nguyễn Lê Hương | 3 mốc con cái |
| «kể chuyện hồi bố cưới mẹ đi ạ» | ask_event · story | Lê Thị Định | Kết hôn, Hàng Da |

`retrieval_queries` là thứ bắc cầu từ vựng: hỏi «cưới» thì analyzer đề xuất
«kết hôn», và mốc đời tìm thấy. Câu «con gái đầu» không nêu tên ai nhưng vẫn
resolve được về slug — regex alias không làm được việc đó.

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
| Grounding | năm + danh từ riêng phải có trong ngữ liệu | critic rewrite |
| Anti-repeat | xem mục Trí nhớ | regenerate 1 lần |
| Độ dài | so với `depth` | cắt theo câu |
| Taboo | `looks_like_taboo` | câu từ chối |

### Grounding

«Đã neo» = **xuất hiện trong chính system prompt vừa sinh ra câu đó, hoặc trong
lời người nhà tự nói**. Không liệt kê lại từng nguồn evidence — lấy luôn prompt
làm ngữ liệu nên check tự đúng khi prompt lớn thêm. Reply heritage cũ **bị loại
khỏi ngữ liệu**: nếu tính, một cái năm bịa sẽ tự rửa mình lan tiếp cả thread.

Tên riêng tiếng Việt là phần khó, hai cái bẫy đã trả giá mới thấy:

- So khớp stoplist vai vế phải **giữ dấu**. Bỏ dấu thì "hạ" nuốt "Hà", "bác" nuốt
  "Bắc" — "Hà Nội" bị xé còn "Nội", một mảnh không gì neo nổi.
- Chỉ bỏ từ chỉ vai ở **đầu** cụm. "Bà Phú" → "Phú", nhưng "Quốc Anh" và
  "Đình Anh" phải giữ nguyên, vì cắt ra thì mảnh còn lại chắc chắn báo động sai.
- Từ đơn viết hoa **mở đầu câu** thì bỏ qua: trong tiếng Việt đó thường là văn
  xuôi thường, và báo động sai ở đây tốn một lần viết lại mỗi lượt.

Đo trên 22 reply thật của Bố Triệu: 0 lần nhận sai tên, 1 lần cờ lên
(«Hồ Chí Minh» — kiến thức phổ thông, không phải tiểu sử).

Phản ứng theo bậc, và **critic tắt thì không sửa gì**:

| Tình huống | Xử lý |
|---|---|
| `heritage_critic_enabled=false` | chỉ ghi cờ vào `meta.grounding`, giữ nguyên chữ |
| Critic viết lại, recheck sạch | dùng bản mới (`action: rewritten`) |
| Viết lại vẫn bẩn | bỏ đúng câu chứa chi tiết đó (`trimmed`) |
| Không còn câu nào | trả câu trung tính `_FALLBACK` (`replaced`) |

Nhận diện tên là heuristic, mà cắt một câu trong thư của bố người ta dựa trên
heuristic thì tệ hơn cả điều nó định chặn. Nên grounding bật sẵn để **quan sát**,
còn bật critic mới là hành động — đúng nghĩa "lời gọi Gemini thứ ba chỉ khi có flag".

## Trí nhớ (Stage 5)

Bảng `thread_memory`, một hàng mỗi thread. `summary_json` =
`{facts_learned, topics_open, already_asked, emotional_tone, entities_seen}`,
mỗi danh sách có trần cứng để khối trí nhớ luôn chiếm một phần cố định của prompt.

Mỗi fact là một bản ghi, không phải một câu trôi nổi:

```json
{
  "statement": "Con và Hương về quê thắp hương thứ bảy",
  "kind": "event",
  "subject_slug": "le_thi_dinh",
  "occurred_at": "2026-08-08",
  "source_message_id": "..."
}
```

- `kind`: `life_state` (có thể bị thay thế) | `event` | `preference` | `relationship`
- `occurred_at`: analyzer nhận ngày hôm nay trong prompt và **quy thời gian tương
  đối về ngày tuyệt đối** — «thứ bảy này» thành `2026-08-08`, nếu không thì một
  tuần sau câu đó thành sai.
- `source_message_id`: do code gắn, luôn truy được về đúng tin nhắn gốc.
- `confidence`: analyzer trả `stated` | `implied`. **Chỉ `stated` vào trí nhớ.**
  Điều suy luận nằm lại trong `meta` của reply để tra vết, không bao giờ được
  đưa lại cho composer như thứ gia đình đã nói — đó chính là đường mà một người
  bố được nhớ bắt đầu bịa.

Ghi vào bằng hai nhịp:

| Nhịp | Ai làm | Lấy từ đâu |
|---|---|---|
| Mỗi lượt | `record_turn`, thuần code | `new_facts` + `codex_slugs` trong `meta` của reply, câu hỏi trong chính reply |
| Mỗi 6 lượt | `compact_thread_memory`, một lời gọi Gemini | 20 tin gần nhất + bản ghi nhớ hiện có |

`already_asked` do code giữ, không để model sửa — đó là danh sách trực tiếp
chặn việc hỏi thăm lặp. Facts chỉ đến từ `meta` mà analyzer đã sinh ra, nên trí
nhớ không bao giờ chứa thứ pipeline chưa từng neo được.

Compactor **không được sửa chữ trong một fact**. Nó chỉ trả `topics_open`,
`emotional_tone`, và `retire_statements` — những câu đã hết đúng vì có thông tin
mới hơn, sao lại nguyên văn. Code tự khớp rồi loại. Nếu để model viết lại
`facts_learned` thì mỗi 6 lượt là một lần tam sao thất bản.

### Cắt trần theo giá trị, không theo thứ tự đến

Ban đầu trần 12 cắt kiểu FIFO. Kết quả trên hội thoại thật: «công việc trong ngày
diễn ra tốt đẹp» đẩy «mẹ từng bị cô điều dưỡng gọi đùa là Em gái mưa» ra khỏi trí
nhớ — thực thể quên một biệt danh được kể, mà vẫn nhớ một ngày làm việc suôn sẻ.

`trim_facts` chia fact thành **dễ hỏng** (`life_state`) và **lâu bền** (còn lại):

- `MAX_PERISHABLE_FACTS = 3` là **sàn dự trữ**, không phải trần: chuyện hôm nay
  luôn có vài chỗ, nhưng khi tiểu sử còn ít thì nó được lan ra chỗ trống chứ
  không để trí nhớ rỗng một nửa.
- Fact không có `kind` (viết trước khi fact có cấu trúc) được coi là lâu bền —
  cái cũ không được là cái đầu tiên bị bỏ.

Cùng lý lẽ đó, `life_state` **không vào hàng đợi duyệt**: «hôm nay ổn» đúng hôm
nay và là rác trong một cuộc đời. Nó vẫn ở `thread_memory`, chỉ không được đề
xuất thành ký ức vĩnh viễn.

Trí nhớ vẫn là **ngắn hạn có trần**. Đường để một điều được nhớ mãi là qua hàng
đợi duyệt vào Thư viện, rồi `retrieve_learned` gọi lại theo độ liên quan.

Write-back chạy **sau** khi reply đã commit, trong cùng background task, và
nuốt mọi lỗi: một lượt trí nhớ hỏng không được phép làm mất câu trả lời.

Anti-repeat đọc chính trí nhớ đó:

| Tín hiệu | Ngưỡng | Xử lý |
|---|---|---|
| Jaccard token vs 3 reply heritage gần nhất | ≥ 0.6 | regenerate 1 lần |
| Câu hỏi trong reply vs `already_asked` | ≥ 0.7 | regenerate 1 lần |

Lần viết lại được thêm khối «đã hỏi rồi / đã nói rồi»; giữ bản nào ít trùng hơn,
không bao giờ gọi lần thứ ba. Lý do bị chặn ghi vào `meta.repeat_guard`.

## Hàng đợi duyệt (Stage 5b)

Chat **chỉ được đề xuất**. Fact `stated` của mỗi lượt vào bảng `memory_candidates`
(`pending`), một người thật bấm giữ thì mới thành `MemoryItem(kind="knowledge")`
gắn tag `heritage:{identity_id}`. Chat nuôi Thư viện, Thư viện nuôi chat.

Ai được duyệt là câu hỏi về quyền riêng tư, không phải về vai trò:

| Thread | Người duyệt |
|---|---|
| Cả nhà | steward (hoặc người tạo space) |
| Riêng | **chính chủ phòng đó** |

Đẩy fact của phòng riêng cho steward thì bằng đưa cho một người tất cả những gì
người khác nói riêng — hàng đợi duyệt sẽ chọc thủng đúng bức tường vừa dựng.
`reviewer_user_id` là người duy nhất được bấm, owner hay steward cũng không mở được.

Duyệt **cũng là chia sẻ**: fact vào Thư viện thì cả nhà đọc được, nên với fact từ
phòng riêng UI phải nói thẳng điều đó trước khi bấm. Không muốn chia sẻ thì bỏ —
fact vẫn còn trong `thread_memory` của phòng đó, chỉ là không thành vĩnh viễn.
Muốn giữ riêng mà vẫn lâu dài thì cần `visibility` trên từng `MemoryItem`, để sau.

Đường về prompt **không dùng «3 cái mới nhất»** như `_knowledge_snippets`.
`retrieve_learned` chấm điểm theo độ liên quan (dùng lại thang của milestone,
ngưỡng 6.0) rồi mới nhập vào khe knowledge. Nếu không, chuyện vụn mới nhất
("con về thứ bảy") sẽ đẩy tiểu sử đã biên tập ra khỏi ngân sách bằng chứng.

Vì fact đã duyệt nằm trong prompt, nó tự động **được coi là đã neo** ở Stage 4 —
không phải thêm luật gì cho grounding.

Chống trùng theo văn bản đã chuẩn hoá, xét cả hàng đợi (`pending`/`approved`) và
cả Thư viện, nên cùng một điều kể lại lần nữa không sinh thêm việc cho người duyệt.
Trần `MAX_PENDING_PER_IDENTITY = 40` để hàng đợi không thành bãi rác.

Chỗ vào phải **luôn thấy được**: ô «Điều nghe được» ở màn không gian có mặt kể cả
khi hàng đợi rỗng, có số đếm khi có việc. Ban đầu nó chỉ là banner hiện khi
`pendingCount > 0` — nghĩa là lúc rỗng thì không ai biết tính năng tồn tại.

Lượt chat có trước Stage 5b vẫn còn nguyên fact trong `meta_json.new_facts` nhưng
chưa từng được xếp hàng. `scripts/backfill-memory-candidates.py` gom lại (chỉ
`stated`, dedupe qua service nên chạy lại vô hại) — cần mỗi khi hàng đợi ra sau
cuộc trò chuyện. Nó gọi thẳng `heritage_memory.stated_facts` chứ không tự lọc:
bản lọc riêng đầu tiên bỏ qua fact dạng chuỗi trần và thế là mất đúng những lượt
sớm nhất — phần việc duy nhất của một backfill.

Chống trùng phải chịu được **cùng một câu ở hai độ dài**, vì `statement` bị cắt ở
160 ký tự trên đường vào: câu nào là tiền tố của câu kia (và đủ dài, ≥60) thì là
một. Không có luật này thì Thư viện hiện hai lần cùng một ký ức, một lần đứt giữa
chữ — đọc như lỗi trong chính kho lưu của gia đình.

## Hình thái thread

Mỗi người được nhớ có **một phòng cả nhà** và **một phòng riêng cho từng thành
viên**. Trên `threads`:

| Cột | Ý nghĩa |
|---|---|
| `heritage_identity_id` | nói với ai (thay cho `IdentityProfile.heritage_thread_id` một-chiều) |
| `audience_scope` | `family` — cả nhà đọc; `direct` — một người |
| `member_user_id` | chủ của phòng riêng |

`heritage_identity_id` cố ý **không phải FK**: `identity_profiles.heritage_thread_id`
đã trỏ ngược lại, ràng buộc hai chiều là một vòng mà `create_all` không sắp thứ tự
được. Thread cũ được backfill thành `family` trong `ensure_schema()`.

Phòng riêng tạo lười, lần đầu thành viên bấm vào —
`POST /api/spaces/{id}/identities/{id}/direct-thread`. `require_thread_access`
chặn mọi người khác đọc hay gửi, kể cả owner và steward, và `list_threads` không
liệt kê phòng riêng của người khác.

Lợi ích không nằm ở UI: **trong phòng riêng, audience là tất định**. Thread đã
biết ai đang nói nên không phải đoán theo câu chữ nữa — lỗi gốc «con nhắc lời mẹ
thì bị trả lời như vợ» biến mất về mặt cấu trúc. Phòng cả nhà vẫn phải đoán, vì
ở đó thật sự có nhiều người.

## Cấu trúc code

Giữ file phẳng theo đúng style `services/` hiện tại:

```
services/heritage_gemini.py     client chung: text + JSON mode, retry, fallback
services/heritage_codex.py      alias resolve, entity lookup
services/heritage_retrieval.py  EvidencePack
services/heritage_analyzer.py   Stage 1 (Phase 2)
services/heritage_memory.py     ThreadMemory + anti-repeat (Phase 3)
services/heritage_grounding.py  grounding check + critic (Phase 4)
services/heritage_candidates.py hàng đợi duyệt fact (Phase 5)
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
| 2 ✅ | Context Analyzer + Value Lens + depth control | Câu meta → ack 1 câu; hỏi sâu → 4–6 câu có trục giá trị |
| 3 ✅ | ThreadMemory + anti-repeat | 10 lượt liên tiếp không lặp câu hỏi thăm |
| 3.5 ✅ | Thread 1-1 + phòng cả nhà, fact có cấu trúc | Phòng riêng kín với người khác; «thứ bảy này» lưu thành ngày tuyệt đối |
| 4 ✅ | Grounding check + critic | Bịa năm/tên = 0 trên bộ golden |
| 5 ✅ | MemoryCandidate + màn duyệt | Fact từ chat vào Thư viện sau khi duyệt, rồi quay lại prompt |

## Đánh đổi

| Quyết định | Vì sao | Giá phải trả |
|---|---|---|
| 2 lời gọi Gemini/lượt | Tách "hiểu" khỏi "nói" → prompt ngắn, test được | +latency, +cost ~2x |
| Bảng `family_entities` riêng | Không làm rối `IdentityProfile`/Voice DNA UI | Duplicate nhẹ với identity |
| Fact mới cần steward duyệt | Hard rule không bịa tiểu sử | Bố "nhớ" chậm hơn một nhịp |
| Grounding chỉ ghi cờ khi critic tắt | Không cắt thư dựa trên heuristic | Muốn chặn thật phải bật critic |
| Reply async | Chat không treo | Mobile cần refetch (đã có typing indicator) |

## Riêng tư

Analyzer gửi nội dung gia đình lên Gemini — compose hiện tại đã gửi rồi nên
không phát sinh loại phơi nhiễm mới. Riêng `new_facts` gated qua steward.

Phòng riêng kín theo `require_thread_access`, không có cửa sau cho owner hay
steward. Trí nhớ nằm theo thread nên điều mẹ kể riêng không rò sang phòng của
con. Hàng đợi duyệt giữ đúng bức tường đó: fact của phòng riêng chỉ chủ phòng
thấy, và chia sẻ ra cả nhà là một hành động có chủ ý, có xác nhận.
