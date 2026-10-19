# Device verification — 2026-09-08

Device: Samsung SM-S918U1, Android 16. Installed `app-debug.apk` with
`adb install -r`, then exercised the real application against the personal library.
Version: 1.0 / versionCode 1; installation recorded by Android at 15:37:53.
Checks were performed in two sessions on the same day.

APK SHA-256: `BC6FDF674CD3A1B1B0F9F49B4457CB7ECCDC0A72CAF391358791FF465E2EC7A8`

Evidence comes from Android UI hierarchy, screenshots, activity state, and media
session state. Audio was not independently recorded or assessed by listening.

| Check | Result | Observed evidence |
| --- | --- | --- |
| Install and launch | Pass | APK installed successfully; the personal library and artwork loaded. Notification permission was granted through the system dialog. |
| Settings Back | Pass | Android Back dismissed Settings and kept the current album. |
| Screen navigation and backgrounding | Pass | Back returned from album to library, collapsed the player, then activated the Samsung launcher. The app's media session still reported PLAYING. |
| Keyboard before navigation | Pass | First Back kept the search results. In the translation editor, first Back retained the editor after keyboard dismissal; second Back closed it. |
| Search restoration | Pass | Entered “Ambitious”, opened an album result, then used Back. Search text and results returned. |
| Screen-off natural track advancement | Pass | Started the nine-second “アイキャッチ (B)” and sent the device to sleep. Android reported Dozing while the media session changed to the next track, “走るために”, with PLAYING state. |
| System media Pause / Play | Pass | Pause produced PAUSED at about 21.5 seconds; Play returned to PLAYING from that position. These were ADB media-key events, not physical Bluetooth-button tests. |
| Reopen after background playback | Pass | The app displayed the new track and advancing position after the screen-off transition. |
| Queue insertion and priority | Pass | Long-pressed “Ambitious World (PV Size)” in search and added it. Queue showed one entry. Next selected that queued track. |
| HD playback | Pass | Switched the queued track to HD. UI showed FLAC Lossless; Android reported PLAYING on the same track. |
| Paused seek and HD → LQ | Pass | Paused, sought to about 46 seconds, then switched to LQ. UI showed 0:46 / Opus 128k; Android reported PAUSED at 46,160 ms. |
| End-of-track sleep in background | Pass | Set End of track, sought near the end, started playback, and opened the launcher. At about 92.3 seconds the media session reported STOPPED on the same track, with no next-track advance. Reopening showed the track at its end. Screen remained on for this timer check. |
| Restore after process restart | Pass | Paused near 39 seconds with one queued entry and repeat-all. Force-stopped only C.R.A.T.E. and relaunched it; its process ID changed. Track, 0:39 position, queue entry, repeat-all, and LQ returned without autoplay. |
| First Play after restoration | Pass | First app Play press produced PLAYING at about 39.9 seconds on the restored track. |
| Translation editor entry | Pass | Settings opened the current track's title and artist. Back dismissed the editor without saving edits. |
| Saved-only protection | Pass | Enabled saved-only mode; Request fresh translations became disabled. Restored the prior setting and confirmed the button was enabled again. No translation-generation request was made. |
| Crash check | Pass for inspected processes | The crash buffer contained no entries for the app process IDs checked during the two test sessions. This is not a long-duration stability test. |

No application-code changes were needed during these checks.

Cleanup: removed the test queue entry and verified the queue was empty, restored
repeat off and saved-only mode off, retained LQ, and left C.R.A.T.E. open and
paused on “Ambitious World (PV Size)” at about 1:02. The end-of-track timer had
completed. No translation edits were saved and the translation server was unchanged.

Still unverified on hardware: Bluetooth connection/disconnection and physical
headset buttons, call/audio-focus interruptions, network failure and retry,
duration and end-of-queue sleep timers, sleep timing with the screen off,
repeat/shuffle over complete source/queue cycles, rapid input stress,
multiple consecutive screen-off track endings, and extended battery use.
Use [ANDROID-CHECKLIST.md](ANDROID-CHECKLIST.md) for those remaining checks.
