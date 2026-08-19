#!/usr/bin/env bash
# Push bà Đoàn Thị Thông Voice DNA (profile + samples + MiniMax clone id)
# from local Postgres onto production. Reuses the existing clone — no re-clone.
#
# Usage (from repo root):
#   ./scripts/push-ba-thong-voice-prod.sh           # dry-run apply
#   ./scripts/push-ba-thong-voice-prod.sh --apply
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${FOREVER_DEPLOY_HOST:-angi-vm}"
VOLUME="${FOREVER_UPLOADS_VOLUME:-forever_forever_uploads}"
BUNDLE_DIR="${TMPDIR:-/tmp}/ba-thong-voice"
REMOTE_REL="Forever/sync/ba-thong-voice"
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

SCRIPT="$ROOT/scripts/push-ba-thong-voice.py"
if [[ ! -f "$SCRIPT" ]]; then
  echo "Missing $SCRIPT" >&2
  exit 1
fi

echo "→ export local Voice DNA"
python3 "$SCRIPT" export --out "$BUNDLE_DIR"

echo "→ copy bundle to ${HOST}:${REMOTE_REL}/"
ssh "$HOST" "mkdir -p ${REMOTE_REL}"
rsync -az --delete "$BUNDLE_DIR/" "${HOST}:${REMOTE_REL}/"
rsync -az "$SCRIPT" "${HOST}:${REMOTE_REL}/push-ba-thong-voice.py"

echo "→ copy sample audio into volume ${VOLUME} (new/changed only, no delete)"
ssh "$HOST" "set -euo pipefail
  docker volume inspect $(printf '%q' "$VOLUME") >/dev/null
  docker run --rm \\
    -v $(printf '%q' "$VOLUME"):/data/uploads \\
    -v \$HOME/${REMOTE_REL}/uploads:/incoming:ro \\
    alpine:3.20 \\
    sh -c 'apk add --no-cache -q rsync && rsync -a --update /incoming/ /data/uploads/'
"

echo "→ docker cp into forever-api"
ssh "$HOST" "docker cp \$HOME/${REMOTE_REL}/push-ba-thong-voice.py forever-api:/tmp/push-ba-thong-voice.py && docker cp \$HOME/${REMOTE_REL}/bundle.json forever-api:/tmp/ba-thong-bundle.json"

DRY=(--dry-run)
LABEL="dry-run"
if [[ "$APPLY" -eq 1 ]]; then
  DRY=()
  LABEL="apply"
fi

echo "→ apply on production (${LABEL})"
ssh "$HOST" "docker exec -e PYTHONPATH=/app forever-api python /tmp/push-ba-thong-voice.py apply --bundle /tmp/ba-thong-bundle.json ${DRY[*]:-}"
