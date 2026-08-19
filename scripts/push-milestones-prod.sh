#!/usr/bin/env bash
# Push Lịch gia đình milestones onto production Postgres via forever-api.
#
# Usage (from repo root):
#   ./scripts/push-milestones-prod.sh              # dry-run
#   ./scripts/push-milestones-prod.sh --apply
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${FOREVER_DEPLOY_HOST:-angi-vm}"
IDENTITY="${FOREVER_IDENTITY_ID:-XLLFcmmNSIiWIOhc2vwYw}"
JSON="$ROOT/docs/heritage-bo-trieu/milestones.draft.json"
SEED="$ROOT/scripts/seed-heritage-context.py"
APPLY=0

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--apply]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$JSON" || ! -f "$SEED" ]]; then
  echo "Missing $JSON or $SEED" >&2
  exit 1
fi

REMOTE_DIR="~/Forever/sync/milestones"
echo "→ copy seed files to ${HOST}:${REMOTE_DIR}/"
ssh "$HOST" "mkdir -p ${REMOTE_DIR}"
rsync -az "$JSON" "$SEED" "${HOST}:${REMOTE_DIR}/"

echo "→ docker cp into forever-api"
ssh "$HOST" "docker cp ${REMOTE_DIR}/milestones.draft.json forever-api:/tmp/milestones.draft.json && docker cp ${REMOTE_DIR}/seed-heritage-context.py forever-api:/tmp/seed-heritage-context.py"

DRY=(--dry-run)
LABEL="dry-run"
if [[ "$APPLY" -eq 1 ]]; then
  DRY=()
  LABEL="apply"
fi

echo "→ seed on production (${LABEL}), identity ${IDENTITY}"
ssh "$HOST" "docker exec -e PYTHONPATH=/app forever-api python /tmp/seed-heritage-context.py --identity ${IDENTITY} --milestones /tmp/milestones.draft.json --milestones-only ${DRY[*]:-}"
