#!/usr/bin/env bash
# Import reviewed poetry JSON → Forever library (kind=poem)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${ROOT}/apps/api/.venv/bin/python"
if [[ ! -x "$PYTHON" ]] || ! "$PYTHON" -c "import httpx" 2>/dev/null; then
  PYTHON=python3
  if ! python3 -c "import httpx" 2>/dev/null; then
    echo "Installing httpx for current python…" >&2
    python3 -m pip install -q httpx
  fi
fi

exec "$PYTHON" "$ROOT/scripts/import-poems.py" "$@"
