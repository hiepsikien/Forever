#!/usr/bin/env bash
# Copy local media into the production uploads volume.
# Only new or changed files (size + mtime). Never deletes cloud files.
#
# Does NOT copy Postgres rows. A photo with no MemoryItem on production will
# sit on disk and not show in the library — re-upload in the app, or sync DB
# separately.
#
# Usage (from repo root, on the Mac):
#   ./scripts/sync-uploads.sh
#   ./scripts/sync-uploads.sh --dry-run
#
# Host defaults to SSH alias angi-vm (same as deploy-api.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${FOREVER_DEPLOY_HOST:-angi-vm}"
LOCAL_DIR="${FOREVER_UPLOADS_LOCAL:-$ROOT/apps/api/uploads}"
VOLUME="${FOREVER_UPLOADS_VOLUME:-forever_forever_uploads}"
REMOTE_STAGING="${FOREVER_UPLOADS_STAGING:-/tmp/forever-uploads-incoming}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--dry-run]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "ERROR: local uploads dir missing: $LOCAL_DIR" >&2
  exit 1
fi

RSYNC_EXCLUDES=(
  --exclude '.DS_Store'
  --exclude '._*'
  --exclude '.git/'
)

echo "→ local:  $LOCAL_DIR"
echo "→ host:   $HOST"
echo "→ volume: $VOLUME"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "→ dry-run (no writes on the VM volume)"
fi

echo "→ rsync to ${HOST}:${REMOTE_STAGING}/"
rsync -avz --delete \
  "${RSYNC_EXCLUDES[@]}" \
  "$LOCAL_DIR/" \
  "${HOST}:${REMOTE_STAGING}/"

RSYNC_FLAGS=(-a --update --info=stats2)
if [[ "$DRY_RUN" -eq 1 ]]; then
  RSYNC_FLAGS+=(--dry-run)
fi

# Quote the flag list for the remote shell.
REMOTE_RSYNC_FLAGS=""
for f in "${RSYNC_FLAGS[@]}"; do
  REMOTE_RSYNC_FLAGS+=" $(printf '%q' "$f")"
done

echo "→ rsync staging → volume ${VOLUME} (new/changed only, no delete)"
ssh "$HOST" "set -euo pipefail
  docker volume inspect $(printf '%q' "$VOLUME") >/dev/null
  docker run --rm \\
    -v $(printf '%q' "$VOLUME"):/data/uploads \\
    -v $(printf '%q' "$REMOTE_STAGING"):/incoming:ro \\
    alpine:3.20 \\
    sh -c 'apk add --no-cache -q rsync && rsync${REMOTE_RSYNC_FLAGS} /incoming/ /data/uploads/'
"

echo "Done. Files are on disk only — library rows still come from the production database."
