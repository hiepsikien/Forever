#!/usr/bin/env bash
# Deploy Forever API to the shared VM without touching the Extract worker.
#
# Usage (from repo root, on the Mac):
#   ./scripts/deploy-api.sh
#   ./scripts/deploy-api.sh --with-worker   # also rebuild extract-worker
#
# Host defaults to SSH alias angi-vm (see deploy/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${FOREVER_DEPLOY_HOST:-angi-vm}"
HEALTH_URL="${FOREVER_HEALTH_URL:-https://forever-api.antunai.com/health}"
WITH_WORKER=0

for arg in "$@"; do
  case "$arg" in
    --with-worker) WITH_WORKER=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--with-worker]" >&2
      exit 1
      ;;
  esac
done

echo "→ rsync apps/api → ${HOST}:~/Forever/apps/api/"
rsync -avz --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude 'uploads' \
  --exclude '.env' --exclude '*firebase-adminsdk*.json' --exclude '*service-account*.json' \
  apps/api/ "${HOST}:~/Forever/apps/api/"

if [[ "$WITH_WORKER" -eq 1 ]]; then
  echo "→ rsync Extract → ${HOST}:~/Forever/Extract/"
  rsync -avz --delete \
    --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
    --exclude '.env' --exclude 'out' --exclude '*.egg-info' --exclude '.DS_Store' \
    Extract/ "${HOST}:~/Forever/Extract/"
fi

echo "→ rsync compose files → ${HOST}:~/Forever/deploy/"
rsync -avz \
  deploy/docker-compose.prod.yml deploy/.env.prod.example deploy/README.md \
  "${HOST}:~/Forever/deploy/"

SERVICES=(forever-api)
if [[ "$WITH_WORKER" -eq 1 ]]; then
  SERVICES+=(forever-extract-worker)
fi

echo "→ rebuild on VM: ${SERVICES[*]}"
ssh "$HOST" "set -euo pipefail
  cd ~/Forever/deploy
  docker compose -p forever -f docker-compose.prod.yml --env-file .env.prod \
    up -d --build ${SERVICES[*]}
"

echo "→ health ${HEALTH_URL}"
ok=0
for i in $(seq 1 30); do
  if out="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    echo "$out"
    ok=1
    break
  fi
  echo "  waiting (${i}/30)…"
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "Health check failed after ~60s (Caddy 502 while API is still booting, or a crash)." >&2
  echo "On the VM: docker logs forever-api --tail 80 --timestamps" >&2
  exit 1
fi
if [[ "$WITH_WORKER" -eq 1 ]]; then
  echo "Done (API + extract-worker rebuilt)."
else
  echo "Done (API rebuilt; extract-worker left running)."
fi
