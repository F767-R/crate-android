import { h } from 'preact';
import {
  LYRICS_SCALE_MAX,
  LYRICS_SCALE_MIN,
  accentEnabled,
  lyricsFontScale,
  setAccentEnabled,
  setLyricsFontScale,
} from '../stores/lyrics.js';

export default function LyricsAppearance() {
  const scale = lyricsFontScale.value;
  const percent = `${Math.round(scale * 100)}%`;
  return <div class="lyrics-appearance">
    <label class="setting-row">Lyrics text size: {percent}
      <input
        type="range"
        min={LYRICS_SCALE_MIN}
        max={LYRICS_SCALE_MAX}
        step="0.05"
        value={scale}
        aria-valuetext={percent}
        onInput={event => setLyricsFontScale(event.currentTarget.value)}
      />
    </label>
    <label class="setting-checkbox">
      <input
        type="checkbox"
        checked={accentEnabled.value}
        onChange={event => setAccentEnabled(event.currentTarget.checked)}
      /> Accent colour from album art
    </label>
    <p class="settings-hint">Colour applies to karaoke highlighting and glow. Tap a timed word to jump to it. Choices are saved automatically.</p>
  </div>;
}
