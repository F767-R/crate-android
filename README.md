# C.R.A.T.E. Android

Preact + Capacitor music client with native Android/Media3 playback,
background audio, lock-screen controls, queueing, lyrics, translation, and
Jellyfin playback reporting.

## Install and verify

Create the local build configuration before running the app:

```powershell
Copy-Item secrets.example.txt secrets.txt
```

Open `secrets.txt` and replace the example values with your Jellyfin and DeepL
settings. The file is required by the development, test, and production build
commands. It is ignored by Git and converted to an ignored generated module at
build time, so personal values are never committed.

```bash
npm install
npm test
npm run build
npx cap sync android
npm run check:secrets
```

The generated web app is written to `www/`, then copied into
`android/app/src/main/assets/public/` by Capacitor.

> Build-time configuration keeps credentials out of source control, but the
> resulting web bundle and APK still contain the values needed by the client.
> Use limited, revocable credentials and do not publish built artifacts that
> contain personal server access.

## Run on Android

Open the existing `android/` directory in Android Studio, or build from a
Windows terminal:

```bat
cd android
gradlew.bat assembleDebug
```

The debug APK is created at
`android/app/build/outputs/apk/debug/app-debug.apk`.

The native implementation in `android/app/src/main/java/com/yourname/crate/`
is the canonical bridge. The separate `android-native/` directory is retained
only as legacy reference material; do not copy it over the current Android
sources.

## Useful checks

- Start with no current track: the library should load without a player crash.
- Play, pause, seek, and change quality in both LQ and HD modes.
- Test next/previous and queue priority from the app and lock screen.
- Verify end-of-track, repeat-one, repeat-all, and sleep-at-end behavior.
- Open timestamped and plain-text lyrics and tap a timed line to seek.
- Toggle translated metadata and confirm the lock-screen title also updates.
