#!/usr/bin/env bash
# Local iOS production archive + TestFlight upload.
# Pattern: Read uses `eas build --local`; this script uses xcodebuild directly when
# EAS credentials for com.nguyendinhanh.forever are not yet provisioned.
#
# Usage (from apps/mobile):
#   npm run ios:prod
#   npm run ios:prod -- --no-submit
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SUBMIT=1
USE_EAS=0
for arg in "$@"; do
  case "$arg" in
    --no-submit) SUBMIT=0 ;;
    --eas) USE_EAS=1 ;;
  esac
done

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export APP_VARIANT=production
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://forever-api.antunai.com}"
export EXPO_PUBLIC_AUTH_DEV="${EXPO_PUBLIC_AUTH_DEV:-true}"
export EAS_BUILD_NO_EXPO_GO_WARNING=true

IOS_CLIENT="${EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:-}"
if [[ -z "$IOS_CLIENT" ]]; then
  echo "WARNING: EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is empty."
  echo "Google Sign-In on iOS will not work; dev login (EXPO_PUBLIC_AUTH_DEV) still works."
  echo ""
fi

DIST_DIR="$ROOT/dist"
ARCHIVE_PATH="$DIST_DIR/Forever.xcarchive"
IPA_PATH="$DIST_DIR/forever-production.ipa"
EXPORT_PLIST="$DIST_DIR/ExportOptions.plist"
TEAM_ID="L22DU942ZT"

mkdir -p "$DIST_DIR"

if [[ "$USE_EAS" -eq 1 ]]; then
  echo "→ EAS local production build (requires iOS credentials on Expo)"
  BUILD_ARGS=(--platform ios --profile production --local --output "$IPA_PATH")
  eas build "${BUILD_ARGS[@]}"
else
  echo "→ Forever production iOS (xcodebuild, bundle com.nguyendinhanh.forever)"
  echo "→ API: $EXPO_PUBLIC_API_URL"
  echo ""

  echo "→ expo prebuild (ios, production)"
  npx expo prebuild --platform ios --clean

  echo "→ pod install"
  (
    cd "$ROOT/ios"
    pod install
  )

  SCHEME="$(python3 - <<'PY'
import plistlib
from pathlib import Path
p = Path("ios/Forever.xcodeproj/xcshareddata/xcschemes")
if not p.exists():
    p = Path("ios")
schemes = sorted(p.glob("*.xcscheme")) if p.is_dir() else []
if not schemes:
    # fallback: first scheme in xcodeproj
    import subprocess
    out = subprocess.check_output(
        ["xcodebuild", "-list", "-json"],
        cwd="ios",
        text=True,
    )
    import json
    data = json.loads(out)
    names = data.get("workspace", {}).get("schemes") or data.get("project", {}).get("schemes") or []
    if not names:
        raise SystemExit("Could not detect Xcode scheme")
    print(names[0])
else:
    print(schemes[0].stem)
PY
)"

  WORKSPACE="$ROOT/ios/Forever.xcworkspace"
  if [[ ! -d "$WORKSPACE" ]]; then
    WORKSPACE="$(find "$ROOT/ios" -maxdepth 1 -name '*.xcworkspace' | head -1)"
  fi
  if [[ -z "$WORKSPACE" || ! -d "$WORKSPACE" ]]; then
    echo "ERROR: No .xcworkspace under ios/" >&2
    exit 1
  fi

  echo "→ xcodebuild archive (scheme: $SCHEME)"
  xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    archive

  cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>uploadSymbols</key>
  <true/>
  <key>signingStyle</key>
  <string>automatic</string>
</dict>
</plist>
PLIST

  echo "→ xcodebuild exportArchive"
  rm -f "$IPA_PATH"
  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$DIST_DIR/export" \
    -exportOptionsPlist "$EXPORT_PLIST" \
    -allowProvisioningUpdates

  EXPORTED="$(find "$DIST_DIR/export" -maxdepth 1 -name '*.ipa' | head -1)"
  if [[ -z "$EXPORTED" ]]; then
    echo "ERROR: exportArchive did not produce an IPA" >&2
    exit 1
  fi
  cp "$EXPORTED" "$IPA_PATH"
  echo "IPA: $IPA_PATH"
fi

if [[ "$SUBMIT" -eq 1 ]]; then
  echo ""
  echo "→ Uploading to TestFlight (eas submit)…"
  eas submit --platform ios --profile production --path "$IPA_PATH" --non-interactive
fi

echo ""
echo "Done. Check App Store Connect → TestFlight when Apple finishes processing."
