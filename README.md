# Gardendless Android — CreatorSXY fork

This fork directly connects touch planting to the game APIs and defaults to full resolution on devices with more than 4 GiB RAM.

Save protection updates preserve installed game resources. Before constructing the first WebView after an upgrade, the app makes and verifies a private snapshot of existing WebView data, preferences and databases. An isolated page at the original origin reads the all-player save without running the game. The app requires a JSON export to a location outside its own storage and verifies that document by reading it back before allowing the game to start. Back → Export all players also provides a native export path. The original game's Blob export is bridged to Android's document picker.

This protection starts **after** the signed update is installed. It cannot provide a backup before that first installation or guarantee a particular device's outcome. Do not uninstall the old app or clear its data. Private snapshots remain inside app data and are lost on uninstall; keep the verified JSON somewhere independent, such as Downloads. Private snapshot ZIPs are diagnostic copies, not in-game JSON import files.

The all-player JSON is the complete stored player list. The original game's player import accepts one player object at a time. Open `tools/save-backup.html` in a browser without uploading your save anywhere, select the all-player backup, and download each player's individual JSON for the original player import. The page works offline and preserves unknown player properties. The repaired in-game export button already produces the original single-player format.

APK 0.16.24.20012 passed an API 35 emulator test installing the actual 20004 release, seeding real WebView storage, performing a same-signature update, and verifying the snapshot and externally exported JSON before any game scripts ran. This validates a seeded upgrade scenario, not the contents or backup state of a user's physical device.

- Tap a card to select it, then tap a lawn cell once to plant. Or drag a card to a cell and release to plant.
- Card selection calls the original `UIInGame.tryChangingIndex`. The current finger position is converted through Cocos, the lawn cell/preview updates immediately, and release calls the original `LnC.PlaceUIPlant` once. Planting emits no synthetic DOM mouse presses. Original sun, cooldown, terrain and occupancy rules remain in effect.
- Other menus/tools still use the existing mouse adapter; this is a WebView app with game-level planting adaptation, not an Android-native game engine rebuild.
- Two-finger tap is right-click; two-finger swipe scrolls.
- Holding one finger no longer becomes right-click, so holding/dragging a plant does not unexpectedly activate the shovel.
- Back → Performance → Full resolution restores the full WebView viewport. Existing saved profile choices are retained. This removes wrapper downscaling, but cannot add detail missing from the original art or an engine-limited canvas.
- In-app updates point to this fork, not the original Android wrapper.

## Game updates

The old `Gzh0821/pvzge_web` endpoint currently returns 404. This fork follows the official `gaozih/pvzge:latest` Docker image linked by the official website instead. The daily workflow resolves an immutable Linux/amd64 image digest, compares it and the wrapper commit to the last release, extracts the web files without running the container, validates the game layout/engine bootstrap, runs checks, and builds an APK for review. Public releases require manually selecting the Publish option; scheduled runs do not publish. Same-version game changes are detected by digest. Android releases use `GAME_VERSION.BUILD_NUMBER` so wrapper-only updates can also be offered in-app.

This follows the **official Docker publication**, whose timing may differ from the live website. Unknown game layouts or failed checks stop publishing. The workflow must be enabled in this fork's Actions tab. The APK contains the game resources for offline play.

In this save-protection release, existing installations deliberately retain their extracted game resources; rebuilding the APK with newer bundled resources does not automatically replace those installed files. Fresh installations use the bundle in the APK. Resource upgrades for existing installations need a separate backup-aware update path.

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

Tests cover direct planting, first-tap coordinates, drag/release, original cost rules, cancellation, fallback mouse controls, two-finger gestures, frame-rate control and resource validation. The release workflow also boots the official game in a touch-capable browser, verifies actual plant creation and sun deduction for tap and drag scenarios, and saves screenshots/state. They do not establish real-device compatibility. Test planting, dragging, shovel, save import/export, pause/resume and image clarity on Samsung Tab S10+ before treating a release as device-verified.

## Upstream

Forked from [MrPurple666/pvzge-android](https://github.com/MrPurple666/pvzge-android), based on Caten Hu's Android port. Game by Gzh0821. Original notices are retained in source files. Android wrapper: GPL-3.0; game code and third-party assets retain their respective rights and licenses.
