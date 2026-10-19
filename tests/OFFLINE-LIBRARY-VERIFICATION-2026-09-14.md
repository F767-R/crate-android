# Offline library verification — 2026-09-14

Implemented saved library metadata, offline album/track/search browsing, a downloaded-only filter backed by completed native audio cache files, and prominent track badges/disc headings. The existing large album artwork layout is preserved.

## Automated checks

- `npm test`: all 15 suites passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx cap sync android`: passed.
- `./gradlew.bat :app:testDebugUnitTest :app:assembleDebug --offline`: passed; 39 Android tests, zero failures/errors.
- `git -c core.safecrlf=false diff --check`: passed.
- Packaged JavaScript entry matches the final web build.

Coverage includes sanitized metadata storage, account/credential isolation, saved-index recovery, unvisited album details, failed refresh, authentication errors, cache eviction/partial-file exclusion, downloaded filtering, and switching downloaded playback from HD to LQ.

## Browser fixture

Verified at 390 × 844 using `tests/offline-library-preview.html`, real IndexedDB, and mocked server/native responses. After saving online, a fresh launch with every server request failing restored albums and tracks. Downloaded-only album and search results contained only the two cached tracks, preserved their original numbers across both discs, and remained available after a failed refresh. Selecting a downloaded track from HD switched to LQ. The number badges/disc headings were visually checked; no horizontal overflow was observed. This fixture does not validate physical audio playback.

## APK and device status

- APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256: `604868DAF83D695C0AD9AC2AD0602F8B06DF92097066ED92DC4E7F7ED6037AB1`
- ADB listed no connected device at completion. This APK has not been installed or tested on the phone.

Open the updated app online once and allow the library index to finish saving before offline use. Offline audio is limited to completed LQ cache files, which can be evicted when the cache fills. Artwork and lyrics that are not cached still require a connection.
