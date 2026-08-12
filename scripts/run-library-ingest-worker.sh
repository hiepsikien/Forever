#!/usr/bin/env bash
# Optional worker: claim queued library-ingest jobs and process via API.
# Normally the API BackgroundTasks already processes on upload; this covers
# jobs left queued after a restart.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${FOREVER_API_URL:-http://127.0.0.1:8001}"
TOKEN="${LIBRARY_INGEST_WORKER_TOKEN:-${EXTRACT_WORKER_TOKEN:-forever-library-ingest-worker}}"
POLL="${LIBRARY_INGEST_POLL_SECONDS:-4}"

echo "[library-ingest-worker] api=$API_URL poll=${POLL}s"
while true; do
  code=$(curl -s -o /tmp/forever-ingest-claim.json -w "%{http_code}" \
    -X POST "$API_URL/api/internal/library-ingest/claim" \
    -H "X-Library-Ingest-Worker-Token: $TOKEN" || true)
  if [[ "$code" == "204" ]]; then
    sleep "$POLL"
    continue
  fi
  if [[ "$code" != "200" ]]; then
    echo "[library-ingest-worker] claim failed ($code)" >&2
    sleep "$POLL"
    continue
  fi
  job_id=$(python3 -c "import json; print(json.load(open('/tmp/forever-ingest-claim.json'))['job_id'])")
  echo "[library-ingest-worker] process $job_id"
  curl -s -X POST "$API_URL/api/internal/library-ingest/$job_id/process" \
    -H "X-Library-Ingest-Worker-Token: $TOKEN" \
    -H "Content-Type: application/json" >/tmp/forever-ingest-process.json || true
done
