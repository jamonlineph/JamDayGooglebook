#!/usr/bin/env bash
# Builds dist/jamday-<version>.apk: the JamDay web app bundled into a small native Android shell.
#
# Needs: a JDK (javac, keytool) plus Android build tools. It uses the official Android SDK when
# ANDROID_HOME is set, and otherwise Ubuntu's packages:
#   sudo apt-get install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner zip
#
# Signing: set KEYSTORE, KEYSTORE_PASS and KEY_ALIAS to use your own key. If none is given, a key is
# created once in android/keystore/ (git-ignored). Keep that key safe: Android only installs updates
# signed with the same key.
#
# Usage: android/build-apk.sh            VERSION_CODE=2 android/build-apk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="$ROOT/android"
OUT="$A/build"
DIST="$ROOT/dist"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
VERSION_CODE="${VERSION_CODE:-1}"

say() { printf '\033[1;35m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- tools
latest_bt() { ls -d "${ANDROID_HOME:-/nonexistent}"/build-tools/*/ 2>/dev/null | sort -V | tail -1 || true; }
BT="$(latest_bt)"
pick() { # pick <name> : prefer SDK build-tools, then PATH
  if [ -n "$BT" ] && [ -x "$BT/$1" ]; then echo "$BT/$1"; else command -v "$1" || true; fi
}
AAPT2="${AAPT2:-$(pick aapt2)}"
ZIPALIGN="${ZIPALIGN:-$(pick zipalign)}"
APKSIGNER="${APKSIGNER:-$(pick apksigner)}"
D8="${D8:-$(pick d8)}"
DX="$(command -v dalvik-exchange || true)"
if [ -z "${ANDROID_JAR:-}" ]; then
  ANDROID_JAR="$(ls "${ANDROID_HOME:-/nonexistent}"/platforms/android-*/android.jar /usr/lib/android-sdk/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "$AAPT2" ] || die "aapt2 not found"
[ -n "$ZIPALIGN" ] || die "zipalign not found"
[ -n "$APKSIGNER" ] || die "apksigner not found"
[ -n "$D8$DX" ] || die "d8 (or dalvik-exchange) not found"
[ -f "$ANDROID_JAR" ] || die "android.jar not found (install android-sdk-platform-23 or set ANDROID_HOME)"
command -v javac >/dev/null || die "javac not found (install a JDK)"
command -v zip >/dev/null || die "zip not found"

say "JamDay $VERSION (code $VERSION_CODE) · android.jar: $ANDROID_JAR"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/assets/www" "$DIST"

# ---------------------------------------------------------------- 1. web app → assets/www
say "Bundling the web app"
cp -r "$ROOT/app" "$OUT/assets/www/app"
cp -r "$ROOT/site" "$OUT/assets/www/site"
cp "$ROOT"/*.html "$OUT/assets/www/"
rm -f "$OUT/assets/www/app/sw.js"   # files ship inside the APK, so no service worker

# ---------------------------------------------------------------- 2. resources + manifest
say "Compiling resources"
"$AAPT2" compile --dir "$A/res" -o "$OUT/res.zip"
"$AAPT2" link -I "$ANDROID_JAR" \
  --manifest "$A/AndroidManifest.xml" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  --version-code "$VERSION_CODE" --version-name "$VERSION" \
  --min-sdk-version 23 --target-sdk-version 34 \
  -o "$OUT/base.apk" "$OUT/res.zip"

# ---------------------------------------------------------------- 3. Java → dex
say "Compiling Java"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find "$A/src" "$OUT/gen" -name '*.java')
if [ -n "$D8" ]; then
  "$D8" --release --min-api 23 --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
else
  "$DX" --dex --min-sdk-version=23 --output="$OUT/dex/classes.dex" "$OUT/classes"
fi

# ---------------------------------------------------------------- 4. package, align, sign
say "Packaging"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unsigned.apk" classes.dex)
"$ZIPALIGN" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

KEYSTORE="${KEYSTORE:-$A/keystore/jamday-release.jks}"
KEY_ALIAS="${KEY_ALIAS:-jamday}"
PROPS="$A/keystore/keystore.properties"
if [ -z "${KEYSTORE_PASS:-}" ] && [ -f "$PROPS" ]; then KEYSTORE_PASS="$(sed -n 's/^KEYSTORE_PASS=//p' "$PROPS")"; fi
if [ ! -f "$KEYSTORE" ]; then
  say "Creating a signing key at $KEYSTORE (keep it safe — updates must use the same key)"
  mkdir -p "$(dirname "$KEYSTORE")"
  KEYSTORE_PASS="${KEYSTORE_PASS:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)}"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$KEY_ALIAS" -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" -dname "CN=JamDay, O=JamDay" 2>/dev/null
  printf 'KEYSTORE_PASS=%s\nKEY_ALIAS=%s\n' "$KEYSTORE_PASS" "$KEY_ALIAS" > "$PROPS"
fi
[ -n "${KEYSTORE_PASS:-}" ] || die "Set KEYSTORE_PASS for $KEYSTORE"

APK="$DIST/jamday-$VERSION.apk"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --key-pass "pass:$KEYSTORE_PASS" --ks-key-alias "$KEY_ALIAS" --out "$APK" "$OUT/aligned.apk"
"$APKSIGNER" verify "$APK"
say "Built $APK ($(du -h "$APK" | cut -f1))"
