#!/usr/bin/env bash
# Run the local Extract worker against Forever API.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/Extract"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

if [[ ! -x .venv/bin/extract-worker ]]; then
  echo "Installing Extract worker (editable + [worker] extra)…"
  .venv/bin/pip install -U pip
  .venv/bin/pip install -e ".[worker]"
fi

export FOREVER_API_URL="${FOREVER_API_URL:-http://127.0.0.1:8001}"
export EXTRACT_WORKER_TOKEN="${EXTRACT_WORKER_TOKEN:-forever-extract-worker}"
export EXTRACT_POLL_SECONDS="${EXTRACT_POLL_SECONDS:-3}"
export HF_TOKEN="${HF_TOKEN:-${HUGGINGFACE_TOKEN:-}}"

if [[ -z "${HF_TOKEN}" ]]; then
  echo "WARNING: HF_TOKEN chưa set — pyannote cần Hugging Face token." >&2
  echo "  export HF_TOKEN=hf_…  (chấp nhận điều khoản model trên huggingface.co)" >&2
fi

exec .venv/bin/extract-worker "$@"
