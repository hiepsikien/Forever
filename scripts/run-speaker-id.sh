#!/usr/bin/env bash
# Speaker-embedding process for «Gọi». Sits beside the Extract worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/Extract"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

if [[ ! -x .venv/bin/speaker-id ]]; then
  echo "Installing Extract (editable + [worker] extra)…"
  .venv/bin/pip install -U pip
  .venv/bin/pip install -e ".[worker]"
fi

export SPEAKER_ID_TOKEN="${SPEAKER_ID_TOKEN:-${EXTRACT_WORKER_TOKEN:-forever-extract-worker}}"
export SPEAKER_ID_BIND="${SPEAKER_ID_BIND:-0.0.0.0}"
export SPEAKER_ID_PORT="${SPEAKER_ID_PORT:-8091}"
export HF_TOKEN="${HF_TOKEN:-${HUGGINGFACE_TOKEN:-}}"

if [[ -z "${HF_TOKEN}" ]]; then
  echo "WARNING: HF_TOKEN chưa set — model nhận giọng cần Hugging Face token." >&2
  echo "  export HF_TOKEN=hf_…  (chấp nhận điều khoản model trên huggingface.co)" >&2
fi

exec .venv/bin/speaker-id "$@"
