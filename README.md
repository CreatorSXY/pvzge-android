# Gardendless Android — CreatorSXY fork

This fork fixes touch input ordering and defaults to full resolution on devices with more than 4 GiB RAM. Export saves before testing a new APK.

- Select a plant, then tap the lawn once; dragging is supported.
- Two-finger tap is right-click; two-finger swipe scrolls.
- Holding one finger no longer becomes right-click, so holding/dragging a plant does not unexpectedly activate the shovel.
- Back → Performance → Full resolution restores the full WebView viewport. Existing saved profile choices are retained. This removes wrapper downscaling, but cannot add detail missing from the original art or an engine-limited canvas.
- In-app updates point to this fork, not the original Android wrapper.

## Game updates

The old `Gzh0821/pvzge_web` endpoint currently returns 404. This fork follows the official `gaozih/pvzge:latest` Docker image linked by the official website instead. The daily workflow resolves an immutable Linux/amd64 image digest, compares it and the wrapper commit to the last release, extracts the web files without running the container, validates the game layout/engine bootstrap, runs checks, and builds an APK. Same-version game changes are detected by digest. Android releases use `GAME_VERSION.BUILD_NUMBER` so wrapper-only updates can also be offered in-app.

This follows the **official Docker publication**, whose timing may differ from the live website. Unknown game layouts or failed checks stop publishing. The workflow must be enabled in this fork's Actions tab. The APK contains the game resources for offline play.

## Build locally

Requires JDK 17, Android SDK 35 and Docker (for extracting the official game bundle).

```sh
python3 scripts/game-source.py > build-source.json
# Use the immutable image value in build-source.json:
docker pull gaozih/pvzge@sha256:...
container=$(docker create gaozih/pvzge@sha256:...)
mkdir -p ../pvzge_web/docs
docker cp "$container:/usr/share/nginx/html/." ../pvzge_web/docs/
docker rm "$container"
python3 scripts/game-source.py --validate ../pvzge_web/docs
./gradlew assembleDebug
```

## Validation

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Tests cover input order, button pairing, drag coordinates, two-finger gestures, cancellation, HTML controls, frame-rate control and resource validation. They do not establish real-device compatibility. Test planting, dragging, shovel, save import/export, pause/resume and image clarity on Samsung Tab S10+ before treating a release as device-verified.

## Upstream

Forked from [MrPurple666/pvzge-android](https://github.com/MrPurple666/pvzge-android), based on Caten Hu's Android port. Game by Gzh0821. Original notices are retained in source files. Android wrapper: GPL-3.0; game code and third-party assets retain their respective rights and licenses.
