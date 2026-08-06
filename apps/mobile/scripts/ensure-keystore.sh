#!/usr/bin/env bash
# Create a local upload keystore (gitignored) and print SHA-1 for Firebase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/android-env.sh"

DIR="$ROOT/credentials/android"
STORE="$DIR/forever-upload.keystore"
PROPS="$DIR/keystore.properties"
ALIAS="forever"
PASS="${FOREVER_KEYSTORE_PASSWORD:-forever-local-upload}"

mkdir -p "$DIR"

if [[ ! -f "$STORE" ]]; then
  echo "Generating upload keystore at $STORE"
  keytool -genkeypair \
    -v \
    -storetype PKCS12 \
    -keystore "$STORE" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$PASS" \
    -keypass "$PASS" \
    -dname "CN=Forever Family, OU=Forever, O=Forever, L=Home, ST=VN, C=VN"
fi

cat >"$PROPS" <<EOF
storeFile=$STORE
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
EOF

echo ""
echo "Signing keystore: $STORE"
# Firebase email/password goes through the JS SDK, so no SHA-1 registration is
# needed. Keep this fingerprint anyway — reinstalls must be signed by the same key.
keytool -list -v -keystore "$STORE" -alias "$ALIAS" -storepass "$PASS" 2>/dev/null \
  | awk '/SHA1:/{print; exit}'
echo ""
