# Immersive lyrics and karaoke verification

The phone lyrics view now uses artwork behind a dark overlay, a compact title/settings header, a universal persistent Karaoke toggle, its own scrolling viewport, and the existing transport/seek dock in compact form. Returning to the library preserves the normal player state. Lyrics source remains in Settings.

Enhanced LRC uses `[mm:ss]<mm:ss>word<mm:ss>word` with no colon separator. Inline timing is retained from raw LRC and Jellyfin line Text. Japanese text, spacing, repeated line stamps and offsets are supported. Plain timed and untimed lyrics retain normal behavior. Missing or invalid word timing never generates an approximate word map.

The user's subsequent improvements are preserved: word lift/glow, depth effects, instrumental dots, smaller stacked romaji/translation text, and a bounded final-word animation tail. The tail is a visual estimate for a missing final end marker (0.3–1.2 seconds, default 0.5 seconds, clipped at the next timed group); explicit end markers remain authoritative.

## Validation

- All 18 isolated JavaScript suites passed, including enhanced LRC, tail limits, grouped translations, pauses, buffering, backward seeks and reduced-motion timing. Type checking, web production build, Android debug assembly, whitespace validation and secret scanning passed. The packaged web asset was byte-checked against the current production output.
- The local rendered-component fixture passed at 384 × 790: word fill/state transitions, toggle persistence, normal/plain fallback, translated-line visibility, smaller secondary text, five-second resumption after the last interaction, paused lyric seeking, and separation of lyrics from the playback dock.
- Added and verified regressions for a future word retaining its glow after a backward seek, and a long timed segment overflowing horizontally. Both are corrected without removing the user's visual effects.
- Landscape fixture at 790 × 354: lyric viewport bottom 302.4 px matches dock top 302.4 px. Playback controls and Karaoke toggle fit inside the viewport.
- Preview screenshot: lyrics-karaoke-preview.png (synthetic lyrics and artwork colors, no live credentials). The fixture can be run with `node scripts/preview-fixtures.mjs`, then `/tests/karaoke-preview.html?test`; inspect body data-test-result.

## Physical phone and remaining checks

An earlier build (index-CxY6NTZL.js) was installed on the Samsung SM-S918U1 before the user's later improvements. The live library track loaded 86 lyric groups. Portrait lyric viewport bottom was 680.13 px, above player top 681.07 px. Turning Karaoke on retained line highlighting and showed Line timing only. Playback stayed paused.

The phone disconnected before final device validation. The final combined APK is packaged but has not been installed or checked on the phone. The user's specific enhanced-LRC track, physical Back/rotation behavior, 200% text and TalkBack on this final lyrics design remain unverified.

Device state when it disconnected: Karaoke was enabled during the fallback test. Font scale remained at its original 1.0. A landscape test requested user_rotation=1; restoration to the original portrait lock (user_rotation=0, accelerometer_rotation=0) could not be verified after disconnection and should be done on reconnection.


## Uploaded rewrite integration

Integrated the six supplied files into the existing implementation, preserving the earlier seek, wrapping, pause-painting and accessibility fixes.

- Persisted lyric size (80–160%, 5% steps) and album-art accent setting under Settings > Lyrics.
- Album accent samples shared cached artwork, cancels stale work, and falls back to white for missing or unsuitable artwork. Existing palette cache is bounded.
- Romaji / translations controls secondary grouped lines only in karaoke mode. Normal mode always displays them; no language-guessing heuristic is used.
- Timed words are keyboard-accessible buttons which seek to their own timestamp without triggering the surrounding line seek. Glow uses drop-shadow.

Validation:
- All 19 smoke suites passed, including new appearance/color/preference tests.
- Type checking and production build passed.
- Browser fixture reported passed for cached artwork reuse, accent toggle, missing-art fallback, secondary-line visibility, font scaling, word seeking, paused updates, backward seeking, following, line-only/untimed fallback and long-word wrapping.
- Enter on a timed word sought to 0:02, with playback remaining paused.
- Visually checked 384 x 790 portrait and 790 x 354 landscape, including 160% text; no horizontal overflow and the playback dock remained separate.
- Diff whitespace and working-tree secret checks passed.
- Capacitor sync and Android assembleDebug passed. APK assets were compared byte-for-byte against production output (index-S36ei_kk.js); APK size 14,757,093 bytes.
- Screenshot: lyrics-appearance-preview.png (synthetic fixture, not a phone capture).
- ADB reported no connected devices. This build has not been installed or validated on the phone. Restoration of the prior device test's user_rotation=0 remains pending until reconnection.
