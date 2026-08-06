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

These demo accounts only exist with `AUTH_DEV_MODE=true`, which is local development only.

### Auth (Firebase email/password)

Family builds sign in with **Firebase email/password and nothing else**. Google and
phone sign-in were removed: the Firebase JS SDK handles email/password without any
native module, so an APK needs no `google-services.json` and no SHA-1 registration.

1. Forever `User` is canonical (`id`, `@handle`, membership, steward). Firebase UID is a linked login.
2. API: set `FIREBASE_PROJECT_ID` + `FIREBASE_CREDENTIALS_JSON`. Production runs `AUTH_DEV_MODE=false`.
3. Mobile: fill the five `EXPO_PUBLIC_FIREBASE_*` values from `.env.example`.
4. The app holds no long-lived token. Every request asks the Firebase SDK for an ID
   token, which it refreshes on its own, and the session survives restarts via
   AsyncStorage persistence.
5. Stewardship: Owner chỉ định kế nhiệm trên màn space → nominee accept → activate handover (steward + owner role).

#### Seating a family member before their first sign-in

`upsert_user_from_claims` matches an existing user by email, so create the row and
membership first and they land straight in the space with no invite code:

```bash
# 1. Firebase Console → Authentication → Add user (email + password)
# 2. Create the Forever row + membership
./scripts/link-family-accounts.py --space <space_id> \
    --member anh.nguyendinh.cs@gmail.com:"Con":owner \
    --member me@gmail.com:"Mẹ" \
    --steward anh.nguyendinh.cs@gmail.com --commit
```

Drop `--commit` for a dry run. These rows carry no `password_hash`, so dev login
cannot be used to impersonate a family member.

### Archiving test profiles

Identity profiles and their Voice DNA can be shelved instead of deleted — nothing is
destroyed, and Steward → Cài đặt → **Lưu trữ hồ sơ** restores them. In bulk:

```bash
cd apps/api
python ../../scripts/archive-profiles.py                          # inventory
python ../../scripts/archive-profiles.py --space <id> --keep <identity_id> --commit
```

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

### Production (shared GCE VM)

Deploy the API on the shared `vstock-api` VM (`forever-api.antunai.com`) — same pattern as Read: Docker Compose + Angi Postgres + Caddy. See [`deploy/README.md`](./deploy/README.md).

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

Sideloadable release APK via Gradle on this Mac. Family builds are the real app:
package `com.nguyendinhanh.forever`, home-screen name **Forever**, Firebase
email/password login, no dev login.

### One-time

1. Firebase Console → **Authentication → Sign-in method → Email/Password → Enable**.
2. Add each family member under **Authentication → Users**, then run
   `scripts/link-family-accounts.py` (see Auth above) so they skip the invite code.
3. No SHA-1 and no `google-services.json` are needed — email/password goes through
   the Firebase JS SDK.

### Build

```bash
cd apps/mobile
cp .env.family.example .env.family     # already filled for forever-70614 + prod API
npm install
FOREVER_ENV_FILE=.env.family npm run android:apk
```

`FOREVER_ENV_FILE` keeps `.env` pointed at localhost for daily development. Building
without it uses `.env`; the script refuses to build against `localhost`, since family
phones cannot reach your Mac.

APK output: `apps/mobile/dist/forever-0.1.0.apk`

Install on a phone:

```bash
adb install -r dist/forever-0.1.0.apk
```

Phones carrying the older **Forever (Dev)** build must uninstall it first — that was
package `…forever.dev`, so this will not upgrade over it.

Or share the APK file (Drive / Zalo). Recipients: Settings → allow install from that source.

### Verify before handing the phone over

1. Sign in with the Firebase email/password.
2. Force-stop the app and reopen it — it must still be signed in.
3. Leave it idle for over an hour, then send a message. This is what proves the ID
   token refreshed instead of expiring.
4. Open **Gọi cho Bố** and check that the reply plays back.

Toolchain (already used for local builds): JDK 17 + Android command-line tools (`brew install openjdk@17` and `brew install --cask android-commandlinetools`).

## iOS TestFlight (local build)

Production bundle: `com.nguyendinhanh.forever` · home screen **Forever** · API `https://forever-api.antunai.com`.

Same pattern as Read: EAS project `@hiepsikien/forever`, local archive via `xcodebuild`, upload via `eas submit`.

### One-time

1. The five `EXPO_PUBLIC_FIREBASE_*` values are all iOS needs — same email/password login as Android.
2. First TestFlight upload creates the App Store Connect app (needs Apple 2FA in Terminal once).

### Build + upload

```bash
cd apps/mobile
npm install
npm run ios:prod              # archive + export IPA + eas submit
npm run ios:prod -- --no-submit   # IPA only → dist/forever-production.ipa
```

After Apple processes (~5–10 min), open App Store Connect → **Forever** → TestFlight. Add `ascAppId` to `eas.json` `submit.production.ios` once known (Read/Recall pattern) so later submits can run `--non-interactive`.

**Dev vs production (important):** EAS may auto-create ASC app `6798107548` for **`com.nguyendinhanh.forever.dev`** (Forever Dev). Production IPA uses **`com.nguyendinhanh.forever`** — a separate App Store Connect app. Do not point `submit.production` at the dev app id.

| Variant | Bundle ID | ASC app | Name on device |
|---------|-----------|---------|----------------|
| Production / TestFlight | `com.nguyendinhanh.forever` | create separately | Forever |
| Dev | `com.nguyendinhanh.forever.dev` | `6798107548` | Forever (Dev) |

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
- **Auth:** Firebase email/password ID tokens (`AUTH_DEV_MODE` for local dev only)  
