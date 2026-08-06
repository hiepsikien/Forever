# Deploy Forever API on shared `vstock-api` VM

Shares the Angi Postgres container (**separate** database `forever` + role `forever`) and Caddy on `angi_net`.

| Item | Value |
|------|--------|
| GCP project | `vstock-prod` |
| VM | `vstock-api` (`asia-southeast1-a`) |
| SSH | `angi-vm` → `34.124.179.140` |
| Public URL | `https://forever-api.antunai.com` |
| Firebase Auth | `forever-70614` (not the GCP compute project) |

Extract worker (`forever-extract-worker`) runs on the same VM — polls `forever-api` on `angi_net`, shares upload volume.

## Domains

DNS A record → `34.124.179.140`:

- `forever-api.antunai.com`

## One-time: Postgres role + database

On the VM (password = `POSTGRES_PASSWORD` from `~/check-food/deploy/.env.prod`):

```bash
# Generate a password for Forever, then:
export FOREVER_DB_PASSWORD='...'

docker exec -i deploy-postgres-1 psql -U checkfood -d postgres <<SQL
CREATE USER forever WITH PASSWORD '${FOREVER_DB_PASSWORD}';
CREATE DATABASE forever OWNER forever;
GRANT ALL PRIVILEGES ON DATABASE forever TO forever;
\\c forever
GRANT ALL ON SCHEMA public TO forever;
ALTER DATABASE forever OWNER TO forever;
SQL
```

## One-time / update: Caddy route

In `~/check-food/deploy/Caddyfile`, add:

```caddy
forever-api.antunai.com {
	encode gzip
	reverse_proxy forever-api:8000
}
```

Then reload Caddy:

```bash
cd ~/check-food/deploy
docker compose -f docker-compose.prod.yml --env-file .env.prod exec caddy caddy reload --config /etc/caddy/Caddyfile
# or: docker compose ... up -d caddy
```

## One-time: secrets on VM

```bash
mkdir -p ~/Forever/deploy ~/Forever/apps/api
cp ~/Forever/deploy/.env.prod.example ~/Forever/deploy/.env.prod
# Edit .env.prod — set FOREVER_DB_PASSWORD, GEMINI/ELEVENLABS/MINIMAX keys, EXTRACT_WORKER_TOKEN
```

Copy the Firebase Admin service account JSON for project `forever-70614` to:

```text
~/Forever/deploy/firebase-service-account.json
```

Compose mounts it at `/run/secrets/firebase.json` (`FIREBASE_CREDENTIALS_JSON`).

## Deploy / update API

From Mac (rsync source + compose):

```bash
rsync -avz --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude 'uploads' \
  --exclude '.env' --exclude '*firebase-adminsdk*.json' --exclude '*service-account*.json' \
  apps/api/ angi-vm:~/Forever/apps/api/

# Worker build context — compose builds forever-extract-worker from ../Extract,
# so this must be synced too or the VM rebuilds stale worker code silently.
rsync -avz --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
  --exclude '.env' --exclude 'out' --exclude '*.egg-info' --exclude '.DS_Store' \
  Extract/ angi-vm:~/Forever/Extract/

rsync -avz deploy/docker-compose.prod.yml deploy/.env.prod.example deploy/README.md \
  angi-vm:~/Forever/deploy/
```

On VM:

```bash
cd ~/Forever/deploy
# first time only: fill .env.prod + place firebase-service-account.json
docker compose -p forever -f docker-compose.prod.yml --env-file .env.prod up -d --build
curl -fsS https://forever-api.antunai.com/health
```

Expected: `{"ok":true,"service":"forever"}`.

## Mobile / APK

The family APK reads `apps/mobile/.env.family` (copied from `.env.family.example`,
already pointed at this API), so `.env` can stay on localhost for development:

```bash
cd apps/mobile
FOREVER_ENV_FILE=.env.family npm run android:apk
```

Rebuild after changing the API URL or Firebase project.

## Auth on production

`AUTH_DEV_MODE=false` is required here, and the stakes are higher than "an extra
login form". Dev tokens are signed with `AUTH_DEV_SECRET` (symmetric HS256), and
`verify_id_token` falls back to them whenever dev mode is on — so anyone who knows
or guesses that secret can sign a token naming *any* email, and
`upsert_user_from_claims` resolves the caller by email. A blank or placeholder
secret is therefore a full account takeover, not a weaker login.

The API now fails closed: it refuses to start when `AUTH_DEV_MODE=true` and
`AUTH_DEV_SECRET` is blank, the published placeholder, or under 16 characters.
`auth_dev_mode` also defaults to `false`, so a missing variable is safe.

With dev mode off, `POST /api/auth/dev-login` returns 404 and only Firebase ID
tokens are accepted — verify after each deploy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://forever-api.antunai.com/api/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.com","password":"x"}'
# expect 404
```

A 200 here means the endpoint just created that user. Delete any account it made.

Turning dev mode off does not lock out the family: everyone signs in through
Firebase, and `upsert_user_from_claims` matches an existing row by email and
re-links its `firebase_uid`. Only `dev-*` test accounts stop working.

### Outstanding on the live VM

As of the last check, `deploy/.env.prod` on the VM still has `AUTH_DEV_MODE=true`
with an **empty** `AUTH_DEV_SECRET`, which is the takeover case above. The next
deploy will refuse to boot until it is fixed — that is intended. Before shipping:

1. Set `AUTH_DEV_MODE=false` in `deploy/.env.prod` on the VM.
2. Delete the accounts dev-login created: `probe@example.com`,
   `me@forever.favorite`, and the seeded `dev-*` users once they are unused.
3. Re-check that `anh.nguyendinh.cs@gmail.com` still holds `owner` on
   "Nhà tôi ở Đền Lừ" — on prod it is still a `dev-` uid and will re-link by
   email at the first real Firebase sign-in.
4. Seat mẹ (`lethidinh315@gmail.com`), who has signed in but belongs to no space:

```bash
./scripts/link-family-accounts.py --space 5K__lcaDoIozrdKA5r0NL \
  --member 'lethidinh315@gmail.com:Mẹ'          # add --commit to apply
```

`archived_at` needs no manual migration: `ensure_schema()` runs on startup and
adds the column.

## Extract worker

Included in compose. Set `HF_TOKEN` in `.env.prod` (pyannote model terms on Hugging Face). Sync `Extract/` first (see above), then:

```bash
docker compose -p forever -f docker-compose.prod.yml --env-file .env.prod up -d --build forever-extract-worker
docker logs -f forever-extract-worker --timestamps
```

Expected: one line `[worker] api=http://forever-api:8000 poll=3.0s` and nothing else. The worker only logs on start, on error, and per job — so `--tail` alone can surface a stale error as if it were current. Always read timestamps.

A `Connection refused` to `forever-api:8000` right at startup is self-healing: compose waits for the API healthcheck, but a rebuild that recreates the API can leave a short gap where the worker polls a port with no listener. It retries and recovers.

Local dev fallback: `./scripts/run-extract-worker.sh` with `FOREVER_API_URL=https://forever-api.antunai.com`.

### Disk

The worker image is ~2.8GB (torch CPU ~914MB, pyannote tree ~640MB) and BuildKit keeps a second copy as build cache, so each build generation costs ~4.5GB on a 20GB disk. Check before building and reclaim orphaned cache after:

```bash
df -h /
docker system df
docker builder prune -f    # orphaned cache only; keeps what current images use
```

## Checklist (first deploy)

1. DNS `forever-api.antunai.com` → `34.124.179.140`
2. Postgres role/DB `forever` created
3. Caddy block added + reloaded
4. `deploy/.env.prod` filled on VM (incl. `EXTRACT_WORKER_TOKEN`, `HF_TOKEN`)
5. `deploy/firebase-service-account.json` present on VM
6. `apps/api/` **and** `Extract/` rsynced to `~/Forever/`
7. `docker compose … up -d --build` succeeds
8. `curl https://forever-api.antunai.com/health` OK
9. `docker logs forever-extract-worker --timestamps` shows the poll line
10. `AUTH_DEV_MODE=false` in `.env.prod`; dev-login probe returns 404
11. Mobile `.env.family` points here (+ APK rebuild if shipping)
12. Family seated in their space (`scripts/link-family-accounts.py`), dev-login
    leftovers deleted — see [Outstanding on the live VM](#outstanding-on-the-live-vm)

## Scale later

Rebuild the same image and run on Cloud Run + Cloud SQL + GCS; this compose is temporary shared-VM hosting.

## Network note

Forever joins external `angi_net`. The compose **service name must be `forever-api`**, never `api` — Angi already uses DNS alias `api` for Caddy.
