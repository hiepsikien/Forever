#!/usr/bin/env bash
# Push the 2016 Word-album photos (≈80) to production via the API.
# Files + library rows + keepsakes. Not a volume rsync.
#
# Usage (from repo root):
#   ./scripts/push-album-2016.sh
#   ./scripts/push-album-2016.sh --dry-run
set -euo pipefail
cd "$(dirname "$0")/.."

export FOREVER_API="${FOREVER_API:-https://forever-api.antunai.com}"
export FOREVER_EMAIL="${FOREVER_EMAIL:-anh.nguyendinh.cs@gmail.com}"

exec python3 scripts/import-keepsakes.py --ready "$@"
