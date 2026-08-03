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
| Web | `apps/web` | Vite landing — philosophy-led early access site |
| Client | `packages/api-client` | Typed fetch client shared by mobile |
| Philosophy | `packages/philosophy` | Shared copy for mobile Triết lý screen + web landing |

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

### 4. Landing (web)

```bash
npm install
npm run dev:web
```

Open http://localhost:5173 — philosophy copy comes from `packages/philosophy` (same source as in-app *Triết lý Forever*). Optional waitlist: copy `apps/web/.env.example` → `.env` and set `VITE_FORMSPREE_ID` or `VITE_WAITLIST_ENDPOINT`.

### 5. Extract worker (Voice DNA từ ký ức)

Local diarization worker — polls Forever API for jobs created from **Voice DNA → Giọng từ ký ức**:

```bash
export HF_TOKEN=hf_xxx   # accept pyannote model terms on Hugging Face
export FOREVER_API_URL=http://127.0.0.1:8001
./scripts/run-extract-worker.sh
```

Keep `EXTRACT_WORKER_TOKEN` in sync with `apps/api/.env` (default `forever-extract-worker`). Details: [`Extract/README.md`](./Extract/README.md).

## Android family APK (local build — no EAS quota)

Sideloadable release APK via Gradle on this Mac. Does **not** use EAS cloud builds.

### One-time: Google Sign-In for Android

1. Create/open the Firebase Android app with package `com.nguyendinhanh.forever` (same string as iOS bundle ID).
2. Run `npm run android:keystore` in `apps/mobile` and paste the printed **SHA-1** into Firebase → Project settings → Android app.
3. Enable **Authentication → Google**.
4. Copy the **Web client ID** (`….apps.googleusercontent.com`) into `apps/mobile/.env` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
5. Set `EXPO_PUBLIC_API_URL` to a URL family phones can reach (LAN IP on same Wi‑Fi, or a public HTTPS host). `localhost` will not work on their devices.

### Build

```bash
cd apps/mobile
cp .env.example .env   # then fill Google Web client ID + API URL
npm install
npm run android:apk
```

APK output: `apps/mobile/dist/forever-0.1.0.apk`

Install on a phone:

```bash
adb install -r dist/forever-0.1.0.apk
```

Or share the APK file (Drive / Zalo). Recipients: Settings → allow install from that source.

Toolchain (already used for local builds): JDK 17 + Android command-line tools (`brew install openjdk@17` and `brew install --cask android-commandlinetools`).

## Phased delivery

1. **Phase 0** — Collect family memories & identity worksheet  
2. **Phase 1** — Family chat (living members) ← *current scaffold*  
3. **Phase 2** — Shared memory library  
4. **Phase 3** — Heritage AI (text + RAG)  
5. **Phase 4** — Voice DNA (self + heritage; ElevenLabs key in Space Settings)  
6. **Phase 5** — Stewardship, export, encryption roadmap  

## Stack

- **Mobile:** Expo 54 + React Native + expo-router  
- **API:** FastAPI + SQLAlchemy + PostgreSQL  
- **Auth:** Firebase ID tokens (with local `AUTH_DEV_MODE`)  
