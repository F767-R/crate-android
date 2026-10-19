# Personal device playback checks

Latest recorded run: [Samsung SM-S918U1 / Android 16 — 2026-09-08](DEVICE-VERIFICATION-2026-09-08.md).
The table below remains a blank checklist for each new build; the linked report
distinguishes completed checks from hardware scenarios that still need testing.

Run this before replacing your daily-use APK after changes to playback or navigation.
Record the date, APK version/build, phone model, Android version, and output device.
Mark each row Pass, Fail, or Not tested; include reproduction steps for any failure.

Use a familiar three-track album (A, B, C) and two tracks from another album (Q1, Q2).
Start with shuffle off, repeat off, and no sleep timer. Repeat playback checks in LQ
and HD where relevant. Use short tracks or seek close to their ends to save time.

| Check | Steps | Expected result | Result |
| --- | --- | --- | --- |
| Player controls | Play A; change quality; open lyrics; toggle translated labels; set then cancel a sleep timer. | Everyday controls remain reachable. Playback and displayed position agree. | Not tested |
| Translation tools | Open Settings with A selected. Open Edit current track translation, then cancel. | Editor shows A. No edit is saved on cancel. Server configuration is available in Settings. | Not tested |
| Saved-only mode | Enable Use saved translations only in Settings. | Request fresh translations is disabled. Holding the player's translation button never forces fresh requests. | Not tested |
| Explicit translation refresh | Only if you want to spend translation quota: disable saved-only mode and tap Request fresh translations. | Busy feedback appears; success clears errors, failure is visible. Requests preserve the existing retry/cache rules. | Not tested |
| Back through screens | Search for A, open its album, open an artist, then lyrics. Use Android Back repeatedly. | Lyrics returns to the artist, then album, then the latest search results and query, then library. Search keystrokes do not add Back steps. | Not tested |
| Back through panels | Open Queue, Sleep, Settings, and translation editor separately; press Back for each. | Visible panel closes first. Current screen, music, and queue do not change. | Not tested |
| Fast Back | Open an album and immediately press Back; type a search and immediately press Back. | A delayed transition or search does not reopen a dismissed screen. | Not tested |
| Keyboard | Focus search or a translation field; use Android Back. | First Back dismisses the keyboard; the next Back closes the panel or returns a screen. | Not tested |
| Background from library | Return to the library while A plays. Press Back to collapse the expanded player; press Back again. Reopen the app. | App backgrounds; audio continues. Returning shows the same session at its current position. | Not tested |
| Screen-off advancement | Play A and lock the phone through the ends of A and B. Reopen during C. | Audio advances once per track. Notification and app show C, the same position, and the same queue. | Not tested |
| Queue priority | While A plays, queue Q1 then Q2. Lock the phone through all three endings. | A → Q1 → Q2 → B. No repeated/skipped queue entry. | Not tested |
| Rapid controls | Tap Next twice rapidly; repeat using headset/notification controls. | Two advances; title, artwork, audio, and progress all belong to the final track. | Not tested |
| Seek and quality | Seek forward/back while playing and paused; change LQ ↔ HD; seek again. | Position stays on the absolute track timeline. Paused playback stays paused. Old commands cannot restore an earlier track. | Not tested |
| Repeat and shuffle | Test repeat-one at a track end, repeat-all at source end, then shuffle with Q1/Q2 inserted. | Repeat policy is honored. Inserted queue plays first and source resumes according to shuffle/repeat. | Not tested |
| Bluetooth and interruptions | Pause/resume/skip using a headset. Disconnect it while playing. Allow a call or another audio app to interrupt. | Controls affect one session. Disconnect does not unexpectedly play aloud. Interruption/resumption matches expected audio-focus behavior. | Not tested |
| Network failure | Stream uncached HD audio; disconnect the network until playback fails. Reconnect and Retry. | Visible failure; Retry resumes the chosen track near its prior position. No unrelated track or duplicate playback. | Not tested |
| Cached LQ recovery | Play cached LQ audio, disconnect network, then reopen the app and use playback controls. | Available cached playback remains controllable. Library failures are separate and retryable. Cache is not a promise of a fully offline library. | Not tested |
| Sleep with screen off | Separately test a short duration, end-of-track, and end-of-queue timer. | Playback pauses at the selected boundary and remains paused when reopening. | Not tested |
| Process recreation | Pause at about 45 seconds with Q1/Q2 queued. Remove the task; if needed, force-stop this app in Android Settings, then launch it. | Saved track, queue, and options restore paused; position is near the last checkpoint. Play explicitly resumes. A force-stop itself is expected to stop audio. | Not tested |

Automated checks complement this table; they do not mark device rows as passed:

```powershell
npm test
npm run typecheck
Set-Location android
.\gradlew.bat :app:testDebugUnitTest
```

For a simulated UI without personal configuration or server traffic:

```powershell
node scripts/preview-fixtures.mjs
```

Open the printed local fixture URL. This previews layout and simulated controls;
it cannot validate Android gestures, background services, Bluetooth, or real audio.
