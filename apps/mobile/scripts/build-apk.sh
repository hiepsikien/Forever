#!/usr/bin/env bash
# Local release APK — no EAS cloud quota.
# Usage: from apps/mobile, after filling .env:
#   npm run android:apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=/dev/null
source "$ROOT/scripts/android-env.sh"

# Defaults to .env (your local dev config). Point FOREVER_ENV_FILE at
# .env.family to build the shared APK without disturbing local development:
#   FOREVER_ENV_FILE=.env.family npm run android:apk
ENV_FILE="${FOREVER_ENV_FILE:-.env}"
if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$ROOT/$ENV_FILE"
fi

# What the caller asked for on the command line. `source` below would otherwise
# overwrite these from the file, silently building a different app than the one
# requested — wrong package id is not something you notice until install fails.
CLI_APP_VARIANT="${APP_VARIANT:-}"
CLI_API_URL="${EXPO_PUBLIC_API_URL:-}"

if [[ -f "$ENV_FILE" ]]; then
  echo "→ env: $ENV_FILE"
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

for pair in "APP_VARIANT:$CLI_APP_VARIANT" "EXPO_PUBLIC_API_URL:$CLI_API_URL"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  [[ -z "$value" ]] && continue
  if [[ "${!name:-}" != "$value" ]]; then
    echo "→ $name: ${!name:-<unset>} → $value (from command line)"
  fi
  export "$name=$value"
done

# Family APKs are the real app: package com.nguyendinhanh.forever, name "Forever".
# Override with APP_VARIANT=dev for a side-by-side install while testing.
export APP_VARIANT="${APP_VARIANT:-production}"
echo "→ variant: $APP_VARIANT"

API_URL="${EXPO_PUBLIC_API_URL:-}"

if [[ -z "$API_URL" || "$API_URL" == *"localhost"* || "$API_URL" == *"127.0.0.1"* ]]; then
  echo "ERROR: EXPO_PUBLIC_API_URL is missing or localhost." >&2
  echo "Family phones cannot reach your Mac's localhost." >&2
  echo "Set a LAN IP (same Wi‑Fi) or the HTTPS API before distributing." >&2
  exit 1
fi

# Firebase email/password is the only way into a family build, so a missing key
# would ship an APK nobody can log into.
missing=()
for var in \
  EXPO_PUBLIC_FIREBASE_API_KEY \
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN \
  EXPO_PUBLIC_FIREBASE_PROJECT_ID \
  EXPO_PUBLIC_FIREBASE_APP_ID \
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if (( ${#missing[@]} )); then
  echo "ERROR: missing Firebase config in apps/mobile/.env:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

if [[ "${EXPO_PUBLIC_AUTH_DEV:-}" != "false" && "$APP_VARIANT" == "production" ]]; then
  echo "WARNING: EXPO_PUBLIC_AUTH_DEV is not \"false\" — set it before sharing the APK."
  echo ""
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
if [[ "$APP_VARIANT" == "production" ]]; then
  APK_DST="$ROOT/dist/forever-0.1.0.apk"
  APK_LABEL="Forever"
else
  APK_DST="$ROOT/dist/forever-dev-0.1.0.apk"
  APK_LABEL="Forever Dev"
fi
cp "$APK_SRC" "$APK_DST"

echo ""
echo "APK ready: $APK_DST ($APK_LABEL)"
ls -lh "$APK_DST"
echo "Install: adb install -r \"$APK_DST\""
echo "Or share the file — recipients enable Install unknown apps."
if [[ "$APP_VARIANT" == "production" ]]; then
  echo "Phones with the old Forever (Dev) build must uninstall it first —"
  echo "different package id, so this will not upgrade over it."
fi
