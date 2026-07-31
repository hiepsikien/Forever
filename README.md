# Forever

Private family space for **connection** and **preservation** — chat with living relatives, a shared memory library, and a living cognitive heritage entity for those who have passed.

> Món quà gửi mẹ: một mái nhà số trường tồn, nơi tình cảm không bị chia cắt bởi sinh tử.

## Product pillars

| Pillar | Meaning |
|--------|---------|
| Privacy | Family-only. No public feed, no engagement algorithms. |
| Chat-first | Familiar messaging UI — low friction for every generation. |
| Shared library | Photos, notes, voice, letters live in one digital living room. |
| Living heritage | Immutable identity (core values) + mutable life context from the living. |
| Longevity | Exportable archive and stewardship transfer across generations. |

Full product plan: [docs/PROJECT.md](./docs/PROJECT.md)

## Architecture

| App | Path | Role |
|-----|------|------|
| API | `apps/api` | FastAPI + PostgreSQL — auth, family spaces, chat, memories |
| Mobile | `apps/mobile` | Expo (iOS + Android) — primary client |
| Client | `packages/api-client` | Typed fetch client shared by mobile |

## Demo accounts (local)

| Person | Email | Password |
|--------|-------|----------|
| Mother | `me@forever.family` | `forever123` |
| Child | `con@forever.family` | `forever123` |

Local auth uses `AUTH_DEV_MODE` stand-in tokens (can stay on alongside Firebase for demos).

### Auth (Firebase + Forever identity)

1. Forever `User` is canonical (`id`, `@handle`, membership, steward). Firebase UID is a linked login.
2. API: set `FIREBASE_PROJECT_ID` + `FIREBASE_CREDENTIALS_JSON`, keep `AUTH_DEV_MODE=true` until ready to cut over.
3. Mobile: fill `apps/mobile/.env` from `.env.example` (`EXPO_PUBLIC_FIREBASE_*`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`).
4. Stewardship: Owner chỉ định kế nhiệm trên màn space → nominee accept → activate handover (steward + owner role).
5. Phone SMS needs Expo Dev Client + Firebase Phone provider; Google works with web client ID; Dev login remains for local demos.

## Run locally

### 1. Database

```bash
docker compose up -d db
```

### 2. API

```bash
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
cp apps/api/.env.example apps/api/.env
cd apps/api && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

API: http://localhost:8001 · Docs: http://localhost:8001/docs

On a physical device, the mobile app uses your machine’s LAN IP (same host as Expo) on port 8001. Ensure the API binds with `--host 0.0.0.0`.

### 3. Mobile

```bash
cd apps/mobile
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_URL` to your machine LAN IP when testing on a physical device.

## Phased delivery

1. **Phase 0** — Collect family memories & identity worksheet  
2. **Phase 1** — Family chat (living members) ← *current scaffold*  
3. **Phase 2** — Shared memory library  
4. **Phase 3** — Heritage AI (text + RAG)  
5. **Phase 4** — Voice DNA  
6. **Phase 5** — Stewardship, export, encryption roadmap  

## Stack

- **Mobile:** Expo 54 + React Native + expo-router  
- **API:** FastAPI + SQLAlchemy + PostgreSQL  
- **Auth:** Firebase ID tokens (with local `AUTH_DEV_MODE`)  
