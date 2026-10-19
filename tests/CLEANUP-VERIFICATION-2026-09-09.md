# Cleanup and text interaction verification — 2026-09-09

This report covers the code cleanup and selection fix. The earlier device report
applies to its earlier APK, not this build.

Changes:

- Public playback controls route Android session commands separately from the
  older bridge fallback in `src/utils/legacyPlayback.js`. Native command ordering
  and queue revision checks remain in the existing native protocol module.
- Album and search rows share gesture handling. Holds open custom menus; movement,
  scrolling, pointer cancellation, and view cleanup cancel pending holds. Releasing
  a hold does not play a track; subsequent taps and keyboard activation still work.
- App labels and artwork suppress browser selection/callouts. Search and translation
  inputs retain selection and editing. Artwork does not start browser image dragging.
- Removed unused playback/gesture state and reused queue serialization and duration
  formatting instead of keeping duplicate implementations.

Verification:

- `npm test`: 13/13 suites passed, including gesture cancellation and expanded
  native playback routing coverage.
- `npm run typecheck`: passed (the existing incremental checked-JavaScript scope).
- `npm run build`: passed.
- `npx cap sync android`: passed.
- `gradlew.bat :app:testDebugUnitTest :app:assembleDebug --offline`: passed.
  Android unit results: 38 tests, zero failures/errors; unchanged native test tasks
  were up to date.
- `git diff --check`: passed.
- Browser fixtures: album title double-click selects no text; label computed selection
  is `none`; album/search custom track menus open; Add to queue and Play from here
  work; search Select All selects its text; translation selection/replacement produces
  the expected edited text. Fixture translation edits were cancelled without saving.
- APK asset hash matches the rebuilt `www/assets/index-DZEZQgJ0.js`.
- Device check: the phone reconnected after the initial build checks. The same APK
  was installed and verified; see the device results below.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256: `580D88F4EBEF01D480B8A7D54D1B79C23EE5BA4119D6599549F0699920D46D59`

## Device results after reconnecting — 2026-09-09

Samsung SM-S918U1, Android 16. Installed the APK above with adb install -r.
Evidence: Android UI hierarchy, screenshots, activity focus, and media session state.

| Check | Result | Evidence |
| --- | --- | --- |
| Install and restore | Pass | Install succeeded; library loaded, previous track and 1:02 position appeared without autoplay. |
| Album title hold | Pass | A one-second stationary hold did not open selection actions. |
| Track hold | Pass | Album and search rows opened Play from here / Play next / Add to queue. Screenshot showed the custom menu without text selection handles. Current track and paused position stayed unchanged after release. |
| Movement cancellation | Pass | A 900 ms moving gesture starting on a row opened no menu and did not start playback. |
| Tap after hold | Pass | A subsequent tap started the selected PV track; Android reported PLAYING. |
| Context-menu Back | Pass | Back dismissed the menu and retained the current album/search screen. |
| Translation editing | Pass | Input text visibly selected; typing CleanupTest replaced the selected title. First Back dismissed the keyboard; subsequent Back closed the editor. No edit was saved. |
| Search and Back | Pass | Entering Ambitious produced results. Opening an album then Back restored the query and results. |
| Root Back | Pass | Back collapsed the player; the next Back focused the Samsung launcher. Reopening restored the app. |
| Paused seek | Pass | Seek returned the PV track to 62,183 ms with Android still reporting PAUSED. |

Cleanup: discarded the translation edit, cleared search, reopened the app, expanded
its player, and left the original PV track paused at about 1:02 in LQ. Queue,
translation server and cache settings were not changed. No additional source changes
were needed. These checks do not replace the longer playback/Bluetooth/network
checks listed in ANDROID-CHECKLIST.md.
