#!/usr/bin/env bash
# Local release APK — no EAS cloud quota.
# Usage: from apps/mobile, after filling .env:
#   npm run android:apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=/dev/null
source "$ROOT/scripts/android-env.sh"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

API_URL="${EXPO_PUBLIC_API_URL:-}"
WEB_CLIENT="${EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:-}"
ALLOW_MISSING_GOOGLE="${FOREVER_ALLOW_MISSING_GOOGLE:-}"

if [[ -z "$API_URL" || "$API_URL" == *"localhost"* || "$API_URL" == *"127.0.0.1"* ]]; then
  echo "WARNING: EXPO_PUBLIC_API_URL is missing or localhost."
  echo "Family phones cannot reach your Mac's localhost."
  echo "Set a LAN IP (same Wi‑Fi) or a public HTTPS URL before distributing."
  echo ""
fi

if [[ -z "$WEB_CLIENT" ]]; then
  if [[ "$ALLOW_MISSING_GOOGLE" == "1" ]]; then
    echo "WARNING: building without EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (dev login only)."
    echo ""
  else
    echo "ERROR: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is empty."
    echo "Firebase Console → Authentication → Google → Web client ID" >&2
    echo "Or set FOREVER_ALLOW_MISSING_GOOGLE=1 to build a Dev-login-only APK." >&2
    exit 1
  fi
fi

bash "$ROOT/scripts/ensure-keystore.sh"

echo "→ expo prebuild (android)"
npx expo prebuild --platform android --clean

STORE="$ROOT/credentials/android/forever-upload.keystore"
cp "$STORE" "$ROOT/android/app/forever-upload.keystore"

python3 - <<'PY'
from pathlib import Path

path = Path("android/app/build.gradle")
text = path.read_text()

release_cfg = """
        release {
            storeFile file('forever-upload.keystore')
            storePassword System.getenv("FOREVER_KEYSTORE_PASSWORD") ?: "forever-local-upload"
            keyAlias "forever"
            keyPassword System.getenv("FOREVER_KEYSTORE_PASSWORD") ?: "forever-local-upload"
        }
"""

if "forever-upload.keystore" not in text:
    needle = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }"""
    replacement = (
        """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }"""
        + release_cfg
        + "\n    }"
    )
    if needle not in text:
        raise SystemExit("Unexpected signingConfigs block in android/app/build.gradle")
    text = text.replace(needle, replacement, 1)

old_release = """        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
"""
new_release = """        release {
            signingConfig signingConfigs.release
"""
if old_release not in text:
    # Already patched or differently formatted — force release signing line.
    if "signingConfig signingConfigs.release" not in text:
        raise SystemExit("Could not locate release signingConfig to patch")
    # Drop any leftover debug assignment inside release {}
    lines = []
    in_release = False
    depth = 0
    for line in text.splitlines(True):
        if (not in_release) and "release {" in line and "signingConfigs" not in "".join(lines[-5:]):
            # Heuristic: buildTypes.release
            if any("buildTypes" in l for l in lines[-15:]):
                in_release = True
                depth = line.count("{") - line.count("}")
                lines.append(line)
                if "signingConfig signingConfigs.release" not in line:
                    lines.append("            signingConfig signingConfigs.release\n")
                continue
        if in_release:
            depth += line.count("{") - line.count("}")
            if "signingConfig signingConfigs." in line:
                continue
            lines.append(line)
            if depth <= 0:
                in_release = False
            continue
        lines.append(line)
    text = "".join(lines)
else:
    text = text.replace(old_release, new_release, 1)

path.write_text(text)
print("Patched android/app/build.gradle with release signing")
PY

mkdir -p "$ROOT/dist"
echo "→ gradle assembleRelease"
(
  cd "$ROOT/android"
  ./gradlew assembleRelease --no-daemon
)

APK_SRC="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
APK_DST="$ROOT/dist/forever-0.1.0.apk"
cp "$APK_SRC" "$APK_DST"

echo ""
echo "APK ready: $APK_DST"
ls -lh "$APK_DST"
echo "Install: adb install -r \"$APK_DST\""
echo "Or share the file — recipients enable Install unknown apps."
echo ""
bash "$ROOT/scripts/ensure-keystore.sh"
