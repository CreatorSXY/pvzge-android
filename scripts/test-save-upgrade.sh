#!/usr/bin/env bash
set -euo pipefail
mkdir -p work/save-upgrade
sdk_root="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
"$sdk_root/cmdline-tools/latest/bin/sdkmanager" 'system-images;android-35;google_apis;x86_64' >/dev/null
printf 'no\n' | "$sdk_root/cmdline-tools/latest/bin/avdmanager" create avd --force --name pvzge-save --package 'system-images;android-35;google_apis;x86_64' --device pixel_6 >/dev/null
sudo chown "$(id -u):$(id -g)" /dev/kvm
"$sdk_root/emulator/emulator" -avd pvzge-save -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -memory 3072 -partition-size 4096 >work/save-upgrade/emulator.log 2>&1 &
emulator_pid=$!
trap 'adb logcat -d > work/save-upgrade/logcat.txt 2>/dev/null || true; adb emu kill 2>/dev/null || true; kill "$emulator_pid" 2>/dev/null || true' EXIT
adb wait-for-device
for i in $(seq 1 120); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then break; fi
  sleep 2
done
[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]
adb shell input keyevent 82
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
old_apk=work/save-upgrade/old-20004.apk
curl --fail --location --retry 3 'https://github.com/CreatorSXY/pvzge-android/releases/download/v0.16.24.20004/app-release.apk' -o "$old_apk"
new_apk=app/build/outputs/apk/release/app-release.apk
test_apk=app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
signer="$sdk_root/build-tools/35.0.0/apksigner"
"$signer" verify --print-certs "$old_apk" >work/save-upgrade/old-signature.txt
"$signer" verify --print-certs "$new_apk" >work/save-upgrade/new-signature.txt
old_certificate=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' work/save-upgrade/old-signature.txt)
new_certificate=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' work/save-upgrade/new-signature.txt)
[ -n "$old_certificate" ] && [ "$old_certificate" = "$new_certificate" ]
adb install -r "$old_apk"
adb install -r "$test_apk"
adb shell am instrument -w -e phase seed com.pvzge.gardendless.test/com.pvzge.gardendless.SaveProtectionInstrumentation | tee work/save-upgrade/seed.txt
rg 'PASS:seed' work/save-upgrade/seed.txt
adb shell am force-stop com.pvzge.gardendless
adb install -r "$new_apk"
adb shell am instrument -w -e phase verify com.pvzge.gardendless.test/com.pvzge.gardendless.SaveProtectionInstrumentation | tee work/save-upgrade/verify.txt
rg 'PASS:verify' work/save-upgrade/verify.txt
adb exec-out screencap -p >work/save-upgrade/verified.png
