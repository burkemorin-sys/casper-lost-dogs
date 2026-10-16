#!/usr/bin/env bash
# Build the Android debug APK locally (same steps as ci/workflows/android-apk.yml).
# Needs: Node 22+, JDK 21, Android SDK (ANDROID_HOME). Output: dist/casper-lost-dogs-debug.apk
set -euo pipefail
cd "$(dirname "$0")/../capacitor"
VERSION_NAME="${VERSION_NAME:-$(node -p "require('../package.json').version")}"
VERSION_CODE="${VERSION_CODE:-1}"
npm install --no-audit --no-fund
npm run prepare-web
rm -rf android
npx cap add android
VERSION_NAME="$VERSION_NAME" VERSION_CODE="$VERSION_CODE" ./configure-android.sh
npx cap sync android
(cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon)
mkdir -p ../dist
cp android/app/build/outputs/apk/debug/app-debug.apk ../dist/casper-lost-dogs-debug.apk
echo "APK: $(cd ../dist && pwd)/casper-lost-dogs-debug.apk"
