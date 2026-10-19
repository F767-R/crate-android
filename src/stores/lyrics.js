import { signal } from '@preact/signals';

function readPreference() {
  try {
    const value = JSON.parse(localStorage.getItem('crateLyricsSource') || 'null');
    if (['auto', 'jellyfin', 'embedded'].includes(value?.source) && typeof value.tag === 'string') return value;
  } catch (_) {}
  return { source: 'auto', tag: '' };
}

export const lyricsPreference = signal(readPreference());
export const cachedLyricsSource = signal('');
function readKaraokePreference() {
  try { return localStorage.getItem('crateKaraokeEnabled') === 'true'; } catch (_) { return false; }
}
export const karaokeEnabled = signal(readKaraokePreference());
export function setKaraokeEnabled(enabled) {
  karaokeEnabled.value = Boolean(enabled);
  try { localStorage.setItem('crateKaraokeEnabled', String(karaokeEnabled.value)); } catch (_) {}
}
export function setLyricsPreference(source, tag = '') {
  const value = { source, tag: tag.trim().toUpperCase().slice(0, 100) };
  lyricsPreference.value = value;
  try { localStorage.setItem('crateLyricsSource', JSON.stringify(value)); } catch (_) {}
}

function readBool(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch (_) { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) {}
}

// Text size multiplier for the lyrics body (1 = your stylesheet's base size).
export const LYRICS_SCALE_MIN = 0.7;
export const LYRICS_SCALE_MAX = 1.3;
function readScale() {
  try {
    const stored = localStorage.getItem('crateLyricsFontScale');
    const value = Number(stored);
    if (stored !== null && Number.isFinite(value) && value > 0) {
      return Math.round(Math.min(LYRICS_SCALE_MAX, Math.max(LYRICS_SCALE_MIN, value)) * 20) / 20;
    }
  } catch (_) {}
  return 1;
}
export const lyricsFontScale = signal(readScale());
export function setLyricsFontScale(scale) {
  const clamped = Math.min(LYRICS_SCALE_MAX, Math.max(LYRICS_SCALE_MIN, Number(scale) || 1));
  lyricsFontScale.value = Math.round(clamped * 20) / 20;
  saveSetting('crateLyricsFontScale', lyricsFontScale.value);
}

// Shared visibility for secondary romaji/translation lines during karaoke.
// Normal mode always displays them; retain the preference key across versions.
export const romajiEnabled = signal(readBool('crateRomajiEnabled', true));
export function setRomajiEnabled(enabled) {
  romajiEnabled.value = Boolean(enabled);
  saveSetting('crateRomajiEnabled', romajiEnabled.value);
}

// Karaoke fill/glow colour taken from the album art.
export const accentEnabled = signal(readBool('crateLyricsAccent', true));
export function setAccentEnabled(enabled) {
  accentEnabled.value = Boolean(enabled);
  saveSetting('crateLyricsAccent', accentEnabled.value);
}
