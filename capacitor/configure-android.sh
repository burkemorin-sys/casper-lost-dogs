#!/usr/bin/env bash
# Run after `npx cap add android`: app icons, location permission, version from the git tag.
set -euo pipefail
cd "$(dirname "$0")"
RES=android/app/src/main/res
cp -r android-res/* "$RES"/
MANIFEST=android/app/src/main/AndroidManifest.xml
if ! grep -q ACCESS_FINE_LOCATION "$MANIFEST"; then
  sed -i 's#</manifest>#    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>#' "$MANIFEST"
fi
# Version: VERSION_NAME like 1.0.0 (from tag v1.0.0), VERSION_CODE = run number
VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"
GRADLE=android/app/build.gradle
sed -i -E "s/versionCode [0-9]+/versionCode ${VERSION_CODE}/; s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME}\"/" "$GRADLE"
# Sign debug builds with the repo's shared DEBUG key so new APKs install over old ones
if [ -f debug.keystore ]; then
  mkdir -p ~/.android && cp debug.keystore ~/.android/debug.keystore
fi
grep -E "versionCode|versionName" "$GRADLE"
