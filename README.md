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
settings. The file is required by the development and production build
commands. It is ignored by Git and converted to an ignored generated module at
build time, so personal values are never committed.

```bash
npm install
npm test
npm run typecheck
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

## Native interface preview

Settings → **Try native interface** opens the first Kotlin/Compose migration stage: online album browsing and playback using the existing audio engine. **Current interface** returns to the full web UI. Lyrics, translations, offline browsing, and queue editing remain there for now. See [migration notes](tests/NATIVE-MIGRATION.md) for scope and validation.

## Reliability and storage

The header's Settings button opens storage and translation controls:

- Audio cache defaults to 512 MiB; choose 128, 256, 512 MiB or 1 GiB. Notification artwork has a separate 64 MiB limit. Older cached files are removed first, while the currently playing file remains protected.
- Clear cache removes downloaded copies, not music on your server. Active playback files and finishing cancelled downloads can temporarily remain. Individual cache downloads are capped at 128 MiB for audio and 5 MiB for artwork; larger files can still stream.
- Successful translations are saved on this device, scoped to the server, proxy, languages and glossary. Failed requests do not mark original labels as translated. Retry preserves successful chunks; Force requests fresh translations.
- **Use saved translations only** prevents translation generation requests, including Force. It uses this device's saved labels, not unseen entries in the PC proxy's database. Explicit manual edits can still be sent to the proxy. This mode does not restore exhausted DeepL quota.
- Library, album, artist, search, lyrics and playback failures have visible retry controls. Ordinary data/translation requests time out after 15 seconds. Lyrics may try three sources in sequence. Playback Retry preserves position; after a local-file failure it streams a fresh network copy for that attempt.
- Native playback logs and media-session IDs no longer contain authenticated stream URLs. Credentials are still embedded in private build artifacts as described above.

Run additional native cache tests with `gradlew.bat :app:testDebugUnitTest` from `android/`. Check unstaged and new publishable files with `node scripts/check-tracked-secrets.mjs --worktree`; the default secret check inspects the staged Git snapshot.

## Playback and refresh regression coverage

- Playback commands carry an intent revision through asynchronous work. A delayed quality lookup, seek completion or rejected start cannot restore an older selection or pause a newer one. Rapid Next commands reserve distinct selections immediately.
- Shuffle restores the original source list when an inserted queue drains. Queue-end sleep still takes precedence.
- Album actions in search load the album's tracks on demand, with loading/error feedback and Retry; dismissed or replaced menu actions cannot run afterward.
- Refresh invalidates pending library requests and album details together. Responses from an older library generation cannot repopulate the new snapshot. Search remains client-side; only library metadata is fetched.
- Android owns the source list, inserted queue, shuffle history, repeat mode and sleep timer. Natural track changes and lock-screen controls continue without the WebView. Play From Here places the remainder in the explicit queue and resumes the source only according to the selected repeat/shuffle policy.
- Playback snapshots restore the current track, absolute position, queue, options and sleep timer when the screen reconnects. A recreated service restores paused; Play explicitly resumes it. Original metadata is retained separately from translated notification labels.
- Network LQ segments, HD streams and local cached files share an absolute timeline. Event identities reject stale track/service updates. Queue edits reject stale indices if playback advances during an edit.
- Android reports playback starts, progress and stops to Jellyfin while the WebView is suspended. Reporting is best-effort, bounded and never blocks playback.

Playback state is saved atomically in Android's private, backup-excluded storage,
with position checkpoints approximately every ten seconds while playing. Its
stream descriptors contain access credentials; snapshots sent to the screen
omit all URLs. Changing the server or build credential fingerprint resets the
saved session. A source list or queue may contain up to 10,000 tracks, subject
to a combined 16 MiB saved-state limit; oversized selections are rejected.

## Large libraries and developer checks

The lyrics screen and popup include a **Lyric source** selector. Auto tries
Jellyfin, original FLAC tags, then the existing converted-FLAC fallback.
Choose Jellyfin to use only its lyrics endpoint, or select an embedded FLAC
tag: LYRICS, UNSYNCEDLYRICS, UNSYNCED LYRICS, COMMENT, DESCRIPTION, or a custom
name. Explicit tag selection never silently substitutes a different tag.
The preference is remembered on this device for all tracks; changing it reloads
the current lyrics and keeps cached results separate by source. The original
file request uses `Static=true` to avoid transcoding away its metadata.
Embedded parsing currently reads the first 128 KiB of native FLAC files;
MP3/M4A tags and FLAC tags beyond that prefix are not supported by this parser.

With **Karaoke** on and word-timed lyrics available, each word fills left to
right, lifts and glows as it is sung, and lines recede with distance from the
active one. Instrumental gaps show three dots that fill in sequence. Lyrics
without word timing keep the plain line highlight and say so.

Library refresh preserves displayed album/track arrays while fetching replacements.
Old indexing attempts cannot clear a newer attempt's progress/error status.
System Play and Pause commands are explicit, so repeated Pause never toggles playback on.
Type checks now also cover offline metadata sanitization/storage and the FLAC parser.

Artwork loads only near the visible area, with four concurrent requests and
shared image ownership. Images still in use remain valid; the unused cache is
limited to 100 images / 32 MiB. Search normalizes its local index when library
or translation data changes, reuses matching results, and renders a visible
window for large album/track results. All matching results remain accessible.

`npm test` discovers regression suites automatically and substitutes dummy
configuration in memory. It neither reads nor creates personal configuration.
`npm run test:clean` verifies this in an isolated checkout without `secrets.txt`
or generated configuration. `npm run typecheck` checks the shared contracts,
native snapshot validation and playback revision helpers; the remaining app
is incrementally typed JavaScript. GitHub source checks run tests and type
checks without credentials or APK uploads.

`npm test` includes playback ordering, shared-library ownership and menu-action regressions. Android unit tests also cover deferred playback request ordering.

## Manual checks

Use [the device playback checklist](tests/ANDROID-CHECKLIST.md) for a repeatable
pass before replacing your daily-use APK. It includes Android Back, screen-off
playback, Bluetooth, recovery, and sleep timers, with space to record results.

Translation editing, server configuration, and **Request fresh translations**
are in Settings. The player's translation button toggles labels; holding it
does not force a refresh. Fresh requests are disabled in saved-only mode.

Android Back closes the top panel, returns through visited screens, collapses
the player at the library, then backgrounds the task without stopping playback.
Returning explicitly to the library clears the screen history.

- Start with no current track: the library should load without a player crash.
- Play, pause, seek, and change quality in both LQ and HD modes.
- Test next/previous and queue priority from the app and lock screen.
- Verify end-of-track, repeat-one, repeat-all, and sleep-at-end behavior.
- Open timestamped and plain-text lyrics and tap a timed line to seek.
- Toggle translated metadata and confirm the lock-screen title also updates.
- Background the app across multiple track endings, then reopen it and verify the track, queue and progress match the notification.
- Set a short duration timer and end-of-track/end-of-queue timers; verify each pauses while the screen is off.
- Reopen after Android has stopped the service: saved playback should be paused and resume on the first Play tap.

## Offline library browsing

Open C.R.A.T.E. while connected once and let it finish saving the library. Album
and track metadata is stored on the phone, so the library, search, artist albums,
and album track lists remain browsable after reopening without Jellyfin.
The saved-library notice includes Reconnect; Refresh reloads the index. A failed
connection refresh keeps the saved index available. Incomplete indexing or a
storage-write failure appears in the library status area.

While browsing offline, use **Downloaded only** to filter albums and search to tracks whose complete audio
files are actually in Android's cache. Small muted download icons identify those tracks.
The routine status row is hidden online; successful reconnection clears the filter.
Failed reconnects preserve it, and each new offline session starts unfiltered.
Save/sync errors remain visible online. Album headers show the year beneath the title
without track/disc totals; track numbers use plain styling while disc headings remain highlighted.
Playing a downloaded selection uses LQ, even if HD was selected earlier. The filter
preserves original track/disc numbers and limits the selected source list to downloaded
tracks. An existing manual queue is preserved.

The library index does not download every song or cover image. Audio is saved by
the existing LQ cache while listening; it may be removed when the cache fills or
when cache controls remove it. Uncached audio, lyrics, and artwork still require a
connection. The metadata index excludes stream URLs and credentials and is scoped
to the configured server/credential fingerprint plus the saved user/library IDs.
