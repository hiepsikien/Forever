# Forever — agent notes

## Product

Forever is a private family chat + memory library + cognitive heritage entity.
Canonical plan: `docs/PROJECT.md`.

## Hard rules

- Do not fabricate biography for heritage entities.
- Label heritage messages distinctly from living members.
- Keep the Read book product separate — this repo is Forever only.
- Prefer mobile-first UX; mother is the first real user.

## Voice-to-voice (mẹ)

Plan: `docs/voice-to-voice.plan.md`. Flags: `STT_ENABLED`, `HERITAGE_TTS_ENABLED`
(default on). Mobile entry: `/call/[threadId]` — auto-play only for the reply to
the turn she just spoke.

## Stack

- `apps/api` — FastAPI + Postgres
- `apps/mobile` — Expo / expo-router
- `apps/web` — Vite landing (philosophy-led)
- `packages/api-client` — typed client
- `packages/philosophy` — shared Triết lý / landing copy (keep web + mobile in sync)

## Auth

- Family + production: **Firebase email/password only**. No Google, no phone, no
  `google-services.json`, no SHA-1 — the JS SDK covers it.
- The client never stores a long-lived token; `getToken` asks Firebase for an ID
  token per request so it refreshes itself. Session survives restarts through
  `initializeAuth` + AsyncStorage persistence. Do not reintroduce a static Bearer.
- Local dev only: `AUTH_DEV_MODE=true` + `POST /api/auth/dev-login`. Seeded demo
  users `me@forever.family` / `con@forever.family` (`forever123`). Production runs
  `AUTH_DEV_MODE=false`, where that route 404s.
- Dev tokens are HS256 on a shared secret and `verify_id_token` falls back to them
  whenever dev mode is on, so a known `AUTH_DEV_SECRET` signs a session for *any*
  email. `auth_dev_mode` therefore defaults to `false`, and the API refuses to boot
  on a blank/placeholder/short secret. Never weaken that guard to make a deploy pass.
- Seat a real member before their first sign-in with
  `./scripts/link-family-accounts.py` — `upsert_user_from_claims` matches on email,
  so they skip the invite code.

## Roles and permissions

Helpers live in `apps/api/app/access.py`; keep authorization there rather than
inline in routers. `Membership.role` is `owner | moderator | member`, and
**steward is not a role** — it is `FamilySpace.steward_user_id`.

- `require_steward_or_owner` — heritage/space admin: settings, identities,
  extract, archiving, roles, account linking, Voice DNA for other people.
- `require_moderator_or_above` — what the family chooses to remember: the
  family review queue and the memorial pages. Never a private room.
- Mobile mirrors these predicates to hide controls. The gate that counts is the
  API; a mobile check that drifts only produces a button that 403s.

Two lines nothing may cross, however senior the caller:

- Candidates from a `direct` thread stay with `reviewer_user_id`. A moderator
  and the steward both get 403 there.
- A `private` memory is invisible to everyone but its saver, so moderator edit
  and delete cannot reach it (404, not 403).

Voice DNA follows `_can_mutate_voice`: steward/owner for anyone's voice, plus
the person themselves for their own. Generating TTS and hearing renders are open
to every member — collecting, reviewing and cloning are not.

Linking a login to an `IdentityProfile` (`linked_user_id`) grants that person
Voice DNA rights over the profile, so it is steward/owner only, one account per
profile, living profiles only.

## Archiving

`IdentityProfile.archived_at` / `VoiceProfile.archived_at` hide a person from lists,
threads and pickers without deleting anything; `?include_archived=true` reveals them.
Bulk tool: `./scripts/archive-profiles.py`. A `ready` heritage entity must be paused
first, and a profile linked to a login account can never be archived.

## Library (Thư viện)

IA: `docs/library-ia.plan.md`. One `MemoryItem` vault per `FamilySpace`.

Space home (`/space/{id}`) order: (1) keepsake if any · (2) Bố Cả nhà, Bà Nội
Cả nhà, Thư viện · (3) điều nghe về bố/bà if any · (4) lịch + nghe thơ/kể
chuyện + Time Capsule + Voice DNA · (5) phòng riêng bố/bà.

- **Hub** (`/library/{spaceId}`) — remembered memorials + living light pages.
  Family calendar lives at `/library/{spaceId}/calendar` (also from space home).
  Do not skip the hub when only one person is remembered.
- **Memorial** (`/person/{identityId}`) — poems / artifacts / heard + milestones
  tagged `heritage:{id}` only («Mốc đời»), never the whole family calendar.
- **Living light** (`/people/{spaceId}/{identityId}`) — profile + `@handle` + tagged items.
- **`@handle`** — `IdentityProfile.handle` unique per space; living linked mirrors
  `User.handle`. Resolve via `GET /api/spaces/{id}/handles/{handle}`. Storage tags
  stay `heritage:{uuid}`.
- **Nghe đọc** (truyện thơ / kinh) — per remembered identity under memorial
  (`/stories/{spaceId}/{identityId}`). Voice DNA TTS trên từng đoạn, cache
  `StoryRecording(source=tts)` để lần sau phát lại. Không thu mic cho người đã mất.
  Bật/tắt kệ và nạp chữ: `require_moderator_or_above` (giống duyệt ký ức).

## Heritage chat

Pipeline + rationale: `docs/heritage-chat-v2.plan.md`. Code is flat in
`apps/api/app/services/heritage_*.py`; every stage sits behind a `heritage_*`
flag in `config.py`.

**Nghe đọc (truyện thơ + kinh Phật):** corpus ở `apps/api/data/storytelling/`;
Voice DNA TTS + cache `StoryRecording(source=tts)` (`routers/storytelling.py`,
mobile `/stories/[spaceId]/[identityId]`). Trong chat heritage, «đọc kinh /
truyện / Kiều…» đi short-circuit `try_story_recite_reply` (đúng tập, đoạn ngẫu
nhiên, bỏ qua DEPTH + chat-TTS 512) giống đọc thơ thư viện. Steward bật tập
trên kệ; kinh và truyện chưa có chữ PD thì **Nhập chữ** từ sách/kinh nhà.
Tái tạo chunk: `./scripts/rebuild-storytelling-chunks.py`.

### Ba tầng quy định — luật của một người không được áp cho người khác

| Tầng | File | Phạm vi |
|------|------|---------|
| 1 · Ứng dụng | `heritage_rules_app.py` | Mọi người được nhớ, mọi nhà |
| 2 · Gia đình | `heritage_rules_family.py` | Một `FamilySpace` — lưu ở `SpaceSettings.family_charter_json`, steward sửa qua `PATCH /settings` |
| 3 · Cá nhân | `heritage_persona.py` | Một `IdentityProfile` — dựng từ Bản sắc |

Tầng 1 và 2 **không được viết cứng đại từ** («bố», «mẹ», «anh», «em»…). Chúng
nhận một `Persona` và hỏi `persona.me(audience)` / `persona.you(audience)`.
`tests/test_heritage_layers.py` canh ranh giới này — thêm một câu có đại từ cố
định vào tầng 1/2 sẽ làm hỏng test chứ không làm hỏng phòng chat của gia đình.

Ba vai, ba cặp xưng hô: `with_children`, `with_grandchildren`, `with_spouse`. Cụ
bà xưng «mẹ» với con nhưng «bà» với cháu — gộp hai vai làm một chính là cách
«Mẹ nhớ con» đến tay đứa cháu. Ô cháu để trống thì app đoán ông/bà, không bao
giờ mượn cặp của con.

Vai người nhắn **đếm ra từ bậc**, không đọc từ nhãn. Nhãn neo vào một người
(«Con trai» là con của Bố nhưng là cháu của Bà) và bản sao đăng nhập chỉ ghi
«Tôi», nên `_audience_by_generation` lấy `Persona.generation_rank` của người
được nhớ trừ đi bậc của người nghe: chênh 1 là con, chênh ≥2 là cháu. Chỗ neo
cho nhãn người sống là hồ sơ được nhớ cũ nhất, đúng như câu hỏi trên màn tạo hồ
sơ. Không đếm được bậc thì mới rơi về đọc nhãn. Người nhắn tự xưng «cháu» thì
lời họ thắng tất — `_declares_grandchild`.

`meta.persona_register` trên mỗi lượt ghi cặp xưng hô đã dùng («bà — cháu»);
đó là chỗ soi đầu tiên khi giọng nghe lệch.

`GeminiCall.max_output_tokens` là chỗ cho câu trả lời **nhìn thấy**. Suy nghĩ ẩn
tính chung vào `maxOutputTokens` và Gemini 3 không cho đặt trần cho riêng nó
(chỉ có `thinkingLevel`; 3.7 không nhận cả `minimal`), nên `call_gemini` tự cộng
`thinking_headroom_tokens(model)` — đổi model trong Cài đặt không làm câu bị bóp
cụt nữa. Chừa rộng không tốn thêm: hoá đơn tính trên token thực sinh ra.

`DEPTH_TOKENS` là lưới an toàn, không phải cách giữ câu ngắn — độ dài do
`DEPTH_RULES` trong prompt giữ. Bị chặn thì `_gemini_heritage_reply` hỏi lại một
lần với chỗ rộng gấp ba; `_finalize_reply_text` chỉ là nước cuối.
`meta.thoughts_tokens` trong telemetry cho biết model tiêu bao nhiêu cho suy nghĩ.

Câu kết phải thưa. `maybe_winddown` nhắc nghỉ mỗi `threshold` lượt chứ không
phải mọi lượt sau ngưỡng — bỏ mốt-đun ấy là «Bà nhớ cháu» dính vào cuối từng
câu trả lời. `strip_repeated_closing` cắt câu thương nhớ và cái đuôi «…, con.»
khi lượt ngay trước đã dùng, nên nói một lần vẫn được, nói mãi thì không.

Steward sửa hiến chương ở Cài đặt → AI → **Hiến chương gia đình**
(`PATCH /settings` với `family_charter`). Đổi `living_kin` là đổi được câu nói
ra, không cần deploy.

Bản sắc thắng suy đoán: `persona_for()` đọc `address_forms_json` trước, nhãn
quan hệ chỉ lấp chỗ trống. Bản sắc mâu thuẫn (hồ sơ Bà chép xưng hô của Bố) thì
báo ở `Persona.lock_conflict` để steward sửa — code không tự viết lại dữ liệu
của gia đình. Chỉ Bản sắc có khối `with_spouse` mới có vai vợ/chồng, nên
`_detect_audience` không thể biến người nhắn thành «vợ» của một người không có vợ.

Bộ dò lời người dùng (nhạy cảm, thương nhớ, đòi bịa) phải phủ hết từ thân tộc
trong `KINSHIP_SELF_WORDS`. Thiếu một từ là một người được nhớ mất lá chắn mà
người khác có — đó là cách «nhớ bà quá» từng không kích hoạt nhịp cầu gia đình.

- Each remembered person has one family thread and one private thread per member
  (`threads.audience_scope`). Never widen `require_thread_access`.
- Audience in a private thread comes from the thread, not from guessing wording.
- Chat may only ever *propose* a fact. `memory_candidates` → a human approves →
  `MemoryItem`. A private thread's candidates are reviewed by that member, not
  the steward and not a moderator.
- Only `stated` facts become memory; `implied` ones stay in message meta.
- The compactor may retire a fact, never reword one.

## Extract (Voice DNA từ ký ức)

- Engine + worker: `Extract/` (`extract-worker` polls Forever internal API)
- Run local worker: `./scripts/run-extract-worker.sh` (needs `HF_TOKEN`, API on `:8001`)
- Steward UX: Voice DNA → **Giọng từ ký ức** → review → import `VoiceSample(source=extract)`
- Do not auto-attach segments to heritage Voice DNA without human review.
