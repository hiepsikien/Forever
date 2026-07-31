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

Local auth uses `AUTH_DEV_MODE` stand-in tokens until Firebase is configured.

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
cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 8000
```

API: http://localhost:8000 · Docs: http://localhost:8000/docs

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
