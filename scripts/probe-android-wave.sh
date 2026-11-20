#!/usr/bin/env bash
set -euo pipefail
sdk_root="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
export PATH="$sdk_root/platform-tools:$sdk_root/emulator:$PATH"
base="$RUNNER_TEMP/pvzge-wave"
mkdir -p "$base/classes" "$base/dex" work/wave-results
build_tools="$sdk_root/build-tools/35.0.0"
android_jar="$sdk_root/platforms/android-35/android.jar"
javac --release 8 -cp "$android_jar" -d "$base/classes" tests/android-wave/WaveProbe.java
"$build_tools/d8" --lib "$android_jar" --min-api 27 --output "$base/dex" "$base/classes"/com/pvzge/waveprobe/*.class
"$build_tools/aapt" package -f -M tests/android-wave/AndroidManifest.xml -I "$android_jar" -F "$base/probe.apk"
(cd "$base/dex" && "$build_tools/aapt" add "$base/probe.apk" classes.dex)
"$build_tools/apksigner" sign --ks keystore.jks --ks-key-alias pvzge --ks-pass pass:pvzge123 --key-pass pass:pvzge123 "$base/probe.apk"
gh release download "$APK_TAG" --repo "$GITHUB_REPOSITORY" -p app-release.apk -D "$base"
export ANDROID_USER_HOME="$base/android-user" ANDROID_EMULATOR_HOME="$base/android-user" ANDROID_AVD_HOME="$base/android-user/avd"
mkdir -p "$ANDROID_AVD_HOME"
"$sdk_root/cmdline-tools/latest/bin/sdkmanager" 'system-images;android-35;google_apis;x86_64' >/dev/null
printf 'no\n' | "$sdk_root/cmdline-tools/latest/bin/avdmanager" create avd --force --name wave --path "$ANDROID_AVD_HOME/wave.avd" --package 'system-images;android-35;google_apis;x86_64' --device pixel_6
sudo chown "$(id -u):$(id -g)" /dev/kvm
emulator -avd wave -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -memory 4096 -partition-size 6144 >work/wave-results/emulator.log 2>&1 &
probe_emulator=$!
cleanup(){
 timeout 20 adb pull /sdcard/Android/data/com.pvzge.gardendless/files/wave-evidence/. work/wave-results/ >/dev/null 2>&1 || true
 timeout 10 adb logcat -d >work/wave-results/logcat.txt 2>/dev/null || true
 timeout 10 adb exec-out screencap -p >work/wave-results/final.png 2>/dev/null || true
 timeout 10 adb emu kill || true
 kill "$probe_emulator" 2>/dev/null || true
}
trap cleanup EXIT
timeout 240 adb wait-for-device
for i in $(seq 1 120); do if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then break; fi; sleep 2; done
[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]
adb shell input keyevent 82
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb install "$base/app-release.apk"
adb install "$base/probe.apk"
adb shell am instrument -w -e baseline "$PROBE_BASELINE" com.pvzge.waveprobe/com.pvzge.waveprobe.WaveProbe | tee work/wave-results/result.txt
grep -F 'PASS:wave:' work/wave-results/result.txt
