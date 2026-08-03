#!/usr/bin/env bash
# Local iOS dev build — installs as "Forever (Dev)" on device/simulator.
# Usage: from apps/mobile (with .env filled):
#   npm run ios:build
#   npm run ios:build -- --device
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export APP_VARIANT=dev

API_URL="${EXPO_PUBLIC_API_URL:-}"
if [[ -z "$API_URL" || "$API_URL" == *"localhost"* || "$API_URL" == *"127.0.0.1"* ]]; then
  echo "WARNING: EXPO_PUBLIC_API_URL is missing or localhost."
  echo "Physical iPhone cannot reach Mac localhost — use LAN IP in .env before distributing."
  echo ""
fi

echo "→ Building Forever (Dev) for iOS (APP_VARIANT=dev)"
echo "→ expo prebuild (ios)"
npx expo prebuild --platform ios --clean

echo "→ expo run:ios --configuration Release"
npx expo run:ios --configuration Release "$@"

echo ""
echo "Done. App name on home screen: Forever (Dev)"
echo "Bundle id: com.nguyendinhanh.forever.dev"
