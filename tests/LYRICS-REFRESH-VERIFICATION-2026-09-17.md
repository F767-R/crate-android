# Lyrics selection and reliability checks — 2026-09-17

- All 15 JavaScript regression suites passed, including explicit repeated system Play/Pause, retained data during failed refresh, overlapping sync ownership, and exact/custom FLAC tag selection.
- `npm run typecheck` passed with library storage and FLAC parsing added to its checked scope.
- Production web build and Capacitor sync passed.
- Android `:app:testDebugUnitTest :app:assembleDebug --offline` succeeded. Native tests were unchanged and up to date.
- `git -c core.safecrlf=false diff --check` passed.
- Headless Edge fixture `lyrics-source-preview.html?test` passed actual component event/effect checks: Auto/Jellyfin → COMMENT → embedded auto → custom MY_TEXT → Jellyfin. The final lyrics changed correctly each time. Layout inspected with 390-pixel content width.
- No ADB device was connected. Real-library tag retrieval and installation remain unverified.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256: `6A944AD67429D4A094404D9E0A5848A6DA6F3FB303BB2F52A5F587DEDC5C5EA1`

The embedded parser supports native FLAC metadata within the first 128 KiB; it does not directly parse MP3/M4A tags. Source selection is remembered globally on this device, and explicit tags never fall back to another tag. The larger native playback architecture refactor is not part of this change.
