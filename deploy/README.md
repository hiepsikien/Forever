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

Point the client at the public API:

```bash
# apps/mobile/.env
EXPO_PUBLIC_API_URL=https://forever-api.antunai.com
```

Rebuild the family APK after changing the URL (`npm run android:apk`).

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
10. Mobile `EXPO_PUBLIC_API_URL` updated (+ APK rebuild if shipping)

## Scale later

Rebuild the same image and run on Cloud Run + Cloud SQL + GCS; this compose is temporary shared-VM hosting.

## Network note

Forever joins external `angi_net`. The compose **service name must be `forever-api`**, never `api` — Angi already uses DNS alias `api` for Caddy.
