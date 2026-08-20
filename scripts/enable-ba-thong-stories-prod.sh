#!/usr/bin/env bash
# After API redeploy (storytelling JSON in image), enable Bà Nội's shelf on prod.
#
#   ./scripts/enable-ba-thong-stories-prod.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${FOREVER_DEPLOY_HOST:-angi-vm}"
SCRIPT="$ROOT/scripts/enable-ba-thong-stories.py"

rsync -az "$SCRIPT" "${HOST}:/tmp/enable-ba-thong-stories.py"
ssh "$HOST" "docker cp /tmp/enable-ba-thong-stories.py forever-api:/tmp/enable-ba-thong-stories.py"
ssh "$HOST" "docker exec -e PYTHONPATH=/app forever-api python /tmp/enable-ba-thong-stories.py"
