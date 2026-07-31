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
- `packages/api-client` — typed client

## Local auth

`AUTH_DEV_MODE=true` + `POST /api/auth/dev-login`. Demo users seeded: `me@forever.family` / `con@forever.family` (`forever123`).
