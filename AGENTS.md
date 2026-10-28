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

Nhận người nói trên lượt gọi: embedding giọng (`speaker-id`) gửi **trước** STT
và chạy song song. Câu tự xưng trong bản chữ («Con Đình Anh đây ạ», «Anh ơi em
đây») là parse local ngay khi STT trả về — không gọi model thứ hai, nên không
thêm một bước chờ. Gallery là tập đóng của người sống đã có dấu giọng. Dấu
đó mở từ cụm đa số trong lịch sử Gọi, không từ mẫu Voice DNA; mẫu của người
đã mất không vào. Khớp chắc thì xưng theo người đó và chỉ trộn vào dấu giọng
đã có. Không chắc, quá ngắn, hai giọng, hoặc dịch vụ embed nằm thì giữ tài
khoản — trừ cửa tự ghi của chính tài khoản ở dưới. Câu tự xưng chỉ đổi người
được xưng hô, không mở dấu giọng mới. Tắt `speaker-id` thì Gọi vẫn trả lời
theo tài khoản.

Giọng khớp chắc thắng mọi lớp chữ, kể cả `_declares_grandchild`.
`speaker_user_id` đã khớp ra một vai thì vai ấy thắng câu «cháu…». Câu tự xưng
«cháu…» chỉ chọn vai cháu khi giọng không khớp.

Hai cửa tách nhau. Cửa 0,60 / cách 0,10 chỉ dành cho **xưng hô** — thà gọi theo
tài khoản còn hơn gọi nhầm người.

- **Xưng hô** giữ `speaker_match_threshold` 0,60 và `speaker_match_margin` 0,10.
  Dưới cửa đó giọng không đặt `speaker_user_id` (tài khoản đứng). Câu tự xưng
  (`reason` "words") vẫn đặt được người được xưng hô. Chữ không chọn dấu nào
  để ghi. Khi `words_user_id` khác tài khoản, cửa thấp hơn đóng — clip đó
  không được trộn vào dấu của tài khoản.
- **Kéo dấu của chính tài khoản** dùng `speaker_self_enroll_threshold` 0,45
  và `speaker_self_enroll_margin` 0,05. Một lượt chỉ trộn vào dấu **đã có**
  của `message.sender_user_id` khi clip không ngắn, không lẫn tiếng, tài khoản
  đã có dấu, tài khoản là ứng viên gần nhất, cosine ≥ 0,45, và cách người thứ
  hai ≥ 0,05. Cách này hẹp hơn cách 0,10 của xưng hô; `best > second` không đủ.
  Không ghi sang người khác ở ngưỡng này — mẹ trên máy con không được kéo dấu
  của con, kể cả khi câu «Anh ơi em đây» đã đổi xưng hô sang mẹ mà vector vẫn
  gần con. Không tạo dấu mới từ lượt Gọi. Không ghi `VoiceSample`. Khớp chắc
  (`reason` "match", ≥ 0,60 và cách ≥ 0,10) vẫn xưng người đó và chỉ trộn dấu
  đã có của chính họ.
- `scripts/rebuild-speaker-prints.py` mở dấu từ lịch sử Gọi, không từ mẫu
  Voice DNA. Người chưa thu Voice DNA vẫn có dấu nếu cuộc gọi của chính tài
  khoản đủ một cụm đa số. Cụm là các đoạn cách medoid ≤ `speaker_seed_link`
  0,60. Mở dấu khi cụm có ít nhất `speaker_seed_min_count` 4 đoạn, chiếm ít
  nhất `speaker_seed_majority` 0,60 số đoạn dùng được, và lớn hơn hẳn cụm thứ
  hai. Mỗi tài khoản chỉ nhúng tối đa `speaker_seed_max_clips` 48 đoạn, lấy
  đều suốt lịch sử — không nhúng hết hàng nghìn cuộc của người nói nhiều, và
  không chỉ lấy các cuộc mới nhất. Đoạn ngắn, lẫn tiếng, hoặc câu tự xưng chỉ người khác không vào cụm
  của tài khoản — chữ không tự mở dấu. Sau khi cụm đã chốt, đoạn lệch và đoạn
  trên máy người khác chỉ nhập dấu đã có khi khớp chắc 0,60 và cách 0,10.
  Script không dùng cửa 0,45. Hai lần `--commit` nhận cùng một tập vì centroid
  chấm điểm không trôi. Dry-run in một dòng mỗi tài khoản. Không bịa dấu khi
  chưa đủ cụm. Clone của người đã mất không phải giọng trên Gọi.

Cửa hai giọng `speaker_half_min_cosine` là 0,50. Hai nửa từ mức đó trở lên là
một giọng. Thấp hơn vẫn là một người khi cả đoạn khớp chắc một dấu và mỗi nửa
cách đúng dấu đó ít nhất `speaker_half_agree_min` 0,40. Hai nửa chỉ hai người
khác nhau thì không đổi xưng hô và không ghi dấu.

Tên trên màn Gọi lấy từ `listMessages` sau khi job nền ghi `speaker_user_id`.
`POST /messages/voice` trả ngay, `sender_name` vẫn là tài khoản. Mục «màn hiện
tên mẹ» chỉ đúng sau lần tải lại danh sách.

Phòng chat chữ (`/chat/[threadId]`) **không có nút Mic** — giọng chỉ đi qua
`/call`. Bàn phím Android ở đó không dùng `KeyboardAvoidingView`: SDK 54 vẽ tràn
viền nên cửa sổ không co lại; màn tự đội `paddingBottom` đúng chiều cao bàn phím
hệ thống báo. Đừng đo lại root đã pad rồi «trừ phần cửa sổ đã nhường» — đó chính
là padding vừa thêm, inset về 0 và ô gõ lại bị che.

Chữ sáng theo giọng ở `/call` chỉ là phép chia theo số ký tự (TTS không trả mốc
thời gian từng từ), nên lượt **đọc thơ / đọc truyện** phải nói cho màn hình biết
audio bắt đầu ở đâu: `meta.spoken_from` — bản ghi được cache theo bài thơ hoặc
theo đoạn và dùng chung với Thư viện lẫn kệ Nghe đọc, nên nó không bao giờ chứa
câu dẫn «Bà đọc «Truyện Kiều» — Đoạn 1 đây con.» Trải giọng lên cả câu dẫn là
highlight tụt sau tiếng nói vài giây trên một đoạn dài. `followAlongPlan` cắt
câu dẫn ra khỏi trục thời gian, `activeSentenceForProgress` chừa 0,2s cho câu
sáng lên cùng lúc nghe chứ không sáng sau.

Nút giữ để nói phải xin quyền mic qua `lib/micPermission.ts`. Gọi thẳng
`requestRecordingPermissionsAsync` là Android mở `GrantPermissionsActivity`
**dù quyền đã cấp, và cả khi quyền đã bị chặn hẳn**: cả hai trường hợp activity
ấy loé ~200ms rồi tự đóng, app mất focus, `AppState` báo rời app và lượt vừa mở
bị huỷ — đúng cái «mic loé rồi tắt» trên Samsung. Vì thế:

- hỏi `getRecordingPermissionsAsync` trước (không UI, không đổi focus);
- chỉ mở hộp thoại thật **một lần mỗi lần chạy app**; đã bị từ chối thì xin nữa
 chỉ loé lại chứ Android không hỏi mẹ lần hai. Đường về là Cài đặt
 (`openMicSettings`), và `micPermissionNeedsSettings()` cho UI biết để mời;
- chốt quyền lúc **mở màn** `/call`, đừng để hộp thoại nhảy giữa lúc đang giữ nút.

`expo-audio` phía native chỉ `checkSelfPermission` rồi ném `AudioPermissionsException`,
không bao giờ tự xin — nên thấy `GrantPermissionsActivity` trong logcat là do JS gọi.
Kèm đó: `AppState` chỉ huỷ khi `background` trên Android (không phải `inactive`),
và `HoldToTalkTarget` bỏ qua `touchCancel` trên Android.

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
phải có trong Docker image (`COPY data/` trong `apps/api/Dockerfile`) thì
`seed_storytelling_corpus` mới chạy trên prod. Voice DNA TTS + cache
`StoryRecording(source=tts)` (`routers/storytelling.py`, mobile
`/stories/[spaceId]/[identityId]`). Trong chat heritage, «đọc kinh /
truyện / Kiều…» đi short-circuit `try_story_recite_reply` (đúng tập, bỏ qua
DEPTH + chat-TTS 512) giống đọc thơ thư viện. Đoạn lấy theo
`pick_next_chunk_for_recite`: đọc tiếp sau đoạn xa nhất đã ghi, hết tập thì
vòng lại đầu — nghe theo thứ tự và dùng lại file đã ghi thay vì dựng TTS mới
mỗi lượt. «Kể Phạm Công Cúc Hoa» cũng vào đường này, nhưng «kể» phải gọi đúng
tên tập (đủ tên hoặc slug) chứ không phải trùng một chữ như «cô Hoa». «Niệm» và
«tụng» chỉ tính khi đứng cạnh «kinh/Phật» — để trống là «kỷ niệm» và «niềm vui»
kéo câu đòi bịa ký ức sang đường đọc kinh và mất lá chắn taboo. Steward bật tập
trên kệ; kinh và truyện chưa có chữ PD thì **Nhập chữ** từ sách/kinh nhà.
Tái tạo chunk: `./scripts/rebuild-storytelling-chunks.py`. Bật kệ bà trên
prod sau deploy: `./scripts/enable-ba-thong-stories-prod.sh`.

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
sơ. Không đếm được bậc thì mới rơi về đọc nhãn. Người nhắn tự xưng «cháu»
(`_declares_grandchild`) thắng nhãn và thắng phòng khi giọng không khớp. Giọng
đã khớp chắc thì vai lấy từ người khớp — câu «cháu…» không được lật vai đó.

`meta.persona_register` trên mỗi lượt ghi cặp xưng hô đã dùng («bà — cháu»);
đó là chỗ soi đầu tiên khi giọng nghe lệch.

`GeminiCall.max_output_tokens` là chỗ cho câu trả lời **nhìn thấy**. Suy nghĩ ẩn
tính chung vào `maxOutputTokens` và Gemini 3 không cho đặt trần cho riêng nó
(chỉ có `thinkingLevel`; 3.7 không nhận cả `minimal`), nên `call_gemini` tự cộng
`thinking_headroom_tokens(model)` — đổi model trong Cài đặt không làm câu bị bóp
cụt nữa. Chừa rộng không tốn thêm: hoá đơn tính trên token thực sinh ra.

`DEPTH_TOKENS` là lưới an toàn, không phải cách giữ câu ngắn — độ dài do
`DEPTH_RULES` trong prompt giữ. `short` là một hoặc hai câu đúng chuyện; hỏi
khi chuyện còn dang dở, không hỏi nếu lượt trước vừa hỏi. Câu «lượt vừa rồi đã
hỏi — lượt này không hỏi» nằm trong prompt. Đừng thêm một bước xóa câu hỏi ở
cuối câu trả lời: dễ cắt mất câu trả lời thật. Model vẫn có thể hỏi; xem vài
lượt là quan sát, không phải một đảm bảo. Bị chặn thì `_gemini_heritage_reply`
hỏi lại một lần với chỗ rộng gấp ba; `_finalize_reply_text` chỉ là nước cuối.
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
- Xưng hô trong phòng riêng theo người đang nói khi giọng hoặc câu tự xưng đã
  nhận ra họ — kể cả khi đó không phải chủ phòng. Đó là cố ý đảo luật cũ
  «phòng riêng lấy người của phòng, không đoán từ chữ». Chữ không khớp và giọng
  không khớp thì vẫn lấy chủ phòng.
- Khi người nhận ra không phải chủ phòng, prompt chỉ được đưa ký ức cả nhà
  (`visibility` family). `prompt_reader` trả `None` khi phòng là `direct`,
  `recognized_speaker_id` có giá trị, và khác `member_user_id`. Mọi chỗ truy
  hồi của lượt heritage (thơ, kiến thức, mốc đời, fact đã học, `family_shared`)
  đi qua helper đó. Trí nhớ cuộn của phòng đang mở (`load_state`) giữ nguyên —
  chỗ khép là kho riêng, không phải bản ghi của phòng họ đang đứng.
- Chat may only ever *propose* a fact. `memory_candidates` → a human approves →
  `MemoryItem`. A private thread's candidates stay with the room owner
  (`reviewer_for` → `member_user_id`), not the steward and not a moderator.
  Đừng gắn im lặng `reviewer_user_id` vào người vừa được nhận giọng — hàng chờ
  đổi chủ phải là một quyết định riêng.
- Only `stated` facts become memory; `implied` ones stay in message meta.
- The compactor may retire a fact, never reword one.

## Extract (Voice DNA từ ký ức)

- Engine + worker: `Extract/` (`extract-worker` polls Forever internal API)
- Run local worker: `./scripts/run-extract-worker.sh` (needs `HF_TOKEN`, API on `:8001`)
- Steward UX: Voice DNA → **Giọng từ ký ức** → review → import `VoiceSample(source=extract)`
- Do not auto-attach segments to heritage Voice DNA without human review.
