#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OWNER="${GITHUB_OWNER:-hiepsikien}"
REPO="${GITHUB_REPO:-Forever}"
VIS="${VISIBILITY:-public}"

if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "Creating $OWNER/$REPO ($VIS)..."
  gh repo create "$OWNER/$REPO" --"$VIS" \
    --description "Forever — private family chat, shared memory library, and living cognitive heritage" \
    --source=. --remote=origin --push
else
  echo "Repo exists. Pushing main..."
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
fi

echo "Done: https://github.com/$OWNER/$REPO"
