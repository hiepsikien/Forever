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

## Heritage chat

Pipeline + rationale: `docs/heritage-chat-v2.plan.md`. Code is flat in
`apps/api/app/services/heritage_*.py`; every stage sits behind a `heritage_*`
flag in `config.py`.

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
