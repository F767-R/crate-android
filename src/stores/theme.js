import { signal } from '@preact/signals';
import { nativeSetSystemBars } from '../utils/nativeBridge.js';

export const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'amoled', label: 'AMOLED' },
  { value: 'light', label: 'Light' },
];

const STORAGE_KEY = 'crateTheme';
// Keep in sync with --bg in styles.css; the native bars cannot read CSS variables.
const SYSTEM_BAR_COLORS = { dark: '#12161a', amoled: '#000000', light: '#f6f3ec' };
const values = THEME_OPTIONS.map(option => option.value);

function readPreference() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (values.includes(value)) return value;
  } catch (_) {}
  return 'dark';
}

export const themePreference = signal(readPreference());

function systemPrefersLight() {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch (_) { return false; }
}

export function resolveTheme(preference = themePreference.value) {
  return preference === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : preference;
}

function applyTheme() {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'light' ? 'light' : 'dark');
  nativeSetSystemBars(SYSTEM_BAR_COLORS[theme], theme === 'light');
}

export function setThemePreference(value) {
  if (!values.includes(value)) return;
  themePreference.value = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
  applyTheme();
}

// Applies the saved theme and follows OS changes while "System" is selected.
export function initTheme() {
  applyTheme();
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (themePreference.value === 'system') applyTheme();
    });
  } catch (_) {}
}
