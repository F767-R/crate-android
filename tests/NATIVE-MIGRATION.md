# Gradual native migration

## Stage 1: native album browsing and playback

Settings → **Try native interface** opens a Kotlin/Jetpack Compose activity in the same app. The current Preact interface remains the launcher and is available through **Current interface** or Back from the native album grid.

Native preview includes:

- Online album grid, album/artist-name filtering, album details, and paged library requests.
- Large artwork, release year beneath the title, highlighted disc headings, and plain track numbers.
- Current track, absolute seek, previous/next, explicit play/pause, quality switching, and retry.
- The existing Java/Media3 coordinator, cache, inserted queue, sleep timer, session persistence, and Jellyfin reporting. No second playback engine or independent queue is introduced.

The native screen configures the exact same server/credential fingerprint as the web interface, keeps inserted queue entries when choosing a track, and reads a compact URL-free player projection only while visible. Network loading is owned by a ViewModel and cancelled when navigation supersedes it. Returning to the current interface restores the service's authoritative playback state through the existing bridge.

Lyrics/source selection, translation, offline library browsing, downloaded filtering, queue editing, and sleep/settings UI remain in the current interface. Native album filtering searches only album titles and artists in this stage. The native preview uses original metadata and does not migrate web IndexedDB/localStorage.

## Build and verification

The existing private `secrets.txt` supplies both web configuration and native BuildConfig. Do not share personal APKs. No credentials are written to tracked source. Kotlin 1.9.25 / Compose compiler 1.5.15 and UI 1.6.8 were chosen to fit the existing AGP 8.2.1 / SDK 34 baseline; upgrade the toolchain separately.

- Run the existing JavaScript suites and type checking.
- Run `gradlew.bat :app:testDebugUnitTest` for queue/cache and native metadata/descriptor compatibility tests.
- With an Android emulator running, run `gradlew.bat :app:connectedDebugAndroidTest -PnativeFixture`. This explicit test build uses a loopback-only mock server and dummy credentials. Its debug resource overlay permits loopback HTTP only for this fixture build. The test exercises real Compose UI and Media3 playback with a generated silent WAV.
- Rebuild **without** `-PnativeFixture` after instrumentation to produce the personal APK. Sync the web build before packaging so Settings includes the entry point.

## Next stages

1. Native queue editing, sleep/settings UI, and broader device/lifecycle testing.
2. Native lyrics/source selection and translation, including saved preferences.
3. Native offline metadata persistence, downloads UI, and explicit migration of existing web data.
4. Make native the default only after feature parity and phone verification; then remove the WebView bridge/fallbacks. Converting stable Java playback code to Kotlin is optional and separate.

## Verification — 2026-09-22

- All 15 JavaScript regression suites, type checking, and production web build passed.
- All 43 Android unit tests passed, including four native metadata/descriptor compatibility tests.
- Pixel 8 / API 34 emulator instrumentation passed: authenticated album loading, multi-disc selection, real Media3 playback from a fixture WAV, inserted-queue preservation, explicit pause/resume, activity recreation without autoplay, library failure/retry, search, and closing the native activity.
- Inspected `native-album.png`: large artwork, title/year/artist order and playback controls fit the phone viewport. Fixture artwork intentionally uses the missing-art placeholder.
- Synced web assets and rebuilt the debug APK without the fixture flag. Verified the packaged Settings entry exists and the fixture credential is absent. Secret scanning and whitespace checks passed.
- APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 14.1 MiB. SHA-256: `8408c356ad5af58ee579828c1ae93d7b6a8ba2359dcc6f987e350ebd721b38b3`.

Physical-phone testing, live Jellyfin playback/artwork, and end-to-end playback handoff through the WebView Settings button remain to be verified. The emulator test launches the native activity directly; it validates the shared engine and native activity exit, not the complete WebView round trip.
