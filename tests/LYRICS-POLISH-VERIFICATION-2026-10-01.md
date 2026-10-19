# Lyrics polish — 2026-10-01

- Removed per-word lift and scale; words retain their baseline and size.
- Removed per-state word opacity jumps. Retained precise color fill.
- Reduced sustained-word glow to 0.12em with a smooth start/end envelope; words lasting 250ms or less have no glow.
- Lyric clock no longer rewinds the painted position when a newer, forward playback sample lags extrapolation. Backward samples, pause and buffering still reset immediately; extrapolation remains capped.
- Text-size range is 70–130% in 5% steps. Existing larger saved preferences clamp to 130%.
- Slider has a dedicated full-width row, so label length cannot move or shrink it.

Validation:
- 19/19 smoke suites, TypeScript checking, production build and Android assembleDebug passed.
- New timing regressions cover delayed forward samples, small backward seeks, forward seeks, pause, buffering, stale-sample cap and fast-word glow suppression.
- Full browser fixture passed after a clean load, including 12 syllables spaced 80ms apart, no word transforms, one active word at a time, no rapid glow, preserved translations and seek behavior.
- At 384 x 790, slider width was 307.20px at both 70% and 130%, at identical vertical positions; automatic checks also covered 80% and 95%.
- Screenshot lyrics-size-fix-preview.png is the synthetic browser fixture.
- Production asset index-MWYnaVIb.js matched the packaged APK byte-for-byte.
- ADB install -r succeeded on R5CW50EWBHE; the app was launched. Real-track rapid passages have not been visually verified on-device for this build.
- Phone rotation and accelerometer settings were already 0; no restoration was needed.


## Follow-up: 105% enlargement on all timed words

User requested scaling for fast syllables too. Added a symmetric progress-driven 100%–105%–100% scale with no translation or layout reflow. The short-syllable glow suppression is unchanged. Reduced-motion mode disables the scale.

All 19 suites, typecheck, production build, and Android build passed. Browser fixture verified 105% scaling and zero translation for twelve 80ms syllables. Saved synthetic screenshot: lyrics-105-preview.png. Packaged asset index-D0eumUAy.js matched production bytes. ADB installation succeeded and the app was launched on R5CW50EWBHE. Real-track visual validation remains for the user.
