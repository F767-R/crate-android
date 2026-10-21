import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };

const theme = await import('../src/stores/theme.js');
assert.equal(theme.themePreference.value, 'dark', 'dark is the default theme');
assert.deepEqual(theme.THEME_OPTIONS.map(option => option.value), ['system', 'dark', 'amoled', 'light']);

theme.setThemePreference('light');
assert.equal(theme.themePreference.value, 'light');
theme.setThemePreference('neon');
assert.equal(theme.themePreference.value, 'light', 'unknown themes are ignored');
assert.equal(storage.get('crateTheme'), 'light', 'only valid themes are saved');

assert.equal(theme.resolveTheme('amoled'), 'amoled');
assert.equal(theme.resolveTheme('system'), 'dark', 'System falls back to dark without a media query');
globalThis.window = { matchMedia: () => ({ matches: true }) };
assert.equal(theme.resolveTheme('system'), 'light', 'System follows a light OS setting');
delete globalThis.window;

assert.deepEqual(theme.systemBarsFor('light', false), { color: '#f6f3ec', lightBackground: true });
assert.deepEqual(theme.systemBarsFor('amoled', false), { color: '#000000', lightBackground: false });
assert.deepEqual(theme.systemBarsFor('light', true), { color: '#12161a', lightBackground: false },
  'immersive lyrics keep the dark system bars in every theme');

const restored = await import('../src/stores/theme.js?restored');
assert.equal(restored.themePreference.value, 'light', 'the saved theme is restored');
storage.set('crateTheme', 'bogus');
const invalid = await import('../src/stores/theme.js?invalid');
assert.equal(invalid.themePreference.value, 'dark', 'an invalid saved theme falls back to dark');

console.log('theme smoke test passed');
