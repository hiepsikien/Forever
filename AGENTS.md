# Forever — agent notes

## Product

Forever is a private family chat + memory library + cognitive heritage entity.
Canonical plan: `docs/PROJECT.md`.

## Hard rules

- Do not fabricate biography for heritage entities.
- Label heritage messages distinctly from living members.
- Keep the Read book product separate — this repo is Forever only.
- Prefer mobile-first UX; mother is the first real user.

## Stack

- `apps/api` — FastAPI + Postgres
- `apps/mobile` — Expo / expo-router
- `apps/web` — Vite landing (philosophy-led)
- `packages/api-client` — typed client
- `packages/philosophy` — shared Triết lý / landing copy (keep web + mobile in sync)

## Local auth

`AUTH_DEV_MODE=true` + `POST /api/auth/dev-login`. Demo users seeded: `me@forever.family` / `con@forever.family` (`forever123`).

## Heritage chat

Pipeline + rationale: `docs/heritage-chat-v2.plan.md`. Code is flat in
`apps/api/app/services/heritage_*.py`; every stage sits behind a `heritage_*`
flag in `config.py`.

- Each remembered person has one family thread and one private thread per member
  (`threads.audience_scope`). Never widen `require_thread_access`.
- Audience in a private thread comes from the thread, not from guessing wording.
- Chat may only ever *propose* a fact. `memory_candidates` → a human approves →
  `MemoryItem`. A private thread's candidates are reviewed by that member, not
  the steward.
- Only `stated` facts become memory; `implied` ones stay in message meta.
- The compactor may retire a fact, never reword one.

## Extract (Voice DNA từ ký ức)

- Engine + worker: `Extract/` (`extract-worker` polls Forever internal API)
- Run local worker: `./scripts/run-extract-worker.sh` (needs `HF_TOKEN`, API on `:8001`)
- Steward UX: Voice DNA → **Giọng từ ký ức** → review → import `VoiceSample(source=extract)`
- Do not auto-attach segments to heritage Voice DNA without human review.
