#!/usr/bin/env bash
# OCR poetry page photos → data/heritage-bo-trieu/poetry-ocr/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load API key from apps/api/.env if present and unset in shell
if [[ -z "${GEMINI_API_KEY:-}" && -f apps/api/.env ]]; then
  # shellcheck disable=SC1091
  set -a
  # only export GEMINI_* lines
  while IFS= read -r line; do
    case "$line" in
      GEMINI_*=*) eval "export $line" ;;
    esac
  done < <(grep -E '^GEMINI_' apps/api/.env || true)
  set +a
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY chưa set." >&2
  echo "  export GEMINI_API_KEY=…   hoặc thêm vào apps/api/.env" >&2
  exit 2
fi

# Prefer project venv httpx if available
PYTHON="${ROOT}/apps/api/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="${PYTHON:-python3}"
fi
if ! "$PYTHON" -c "import httpx" 2>/dev/null; then
  PYTHON=python3
  if ! python3 -c "import httpx" 2>/dev/null; then
    echo "Installing httpx for current python…" >&2
    python3 -m pip install -q httpx
  fi
fi

# Default local Mac path (override with --input). Fix when pulling to your machine.
DEFAULT_INPUT="${FOREVER_POETRY_PHOTOS:-$ROOT/data/heritage-bo-trieu/poetry-photos}"

exec "$PYTHON" "$ROOT/scripts/ocr-poetry-ingest.py" --input "$DEFAULT_INPUT" "$@"
