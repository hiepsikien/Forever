#!/usr/bin/env bash
# Shared env for local Android builds (no EAS cloud).
set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "JDK 17 not found at $JAVA_HOME. Install: brew install openjdk@17" >&2
  exit 1
fi
if [[ ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "Android SDK incomplete at $ANDROID_HOME." >&2
  echo "Install: brew install --cask android-commandlinetools" >&2
  echo "Then: sdkmanager --install \"platform-tools\" \"platforms;android-35\" \"build-tools;35.0.0\"" >&2
  exit 1
fi
