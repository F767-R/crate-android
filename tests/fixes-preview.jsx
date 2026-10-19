// Isolated browser fixture: no request reaches Jellyfin, DeepL or a real device.
import { h, render } from 'preact';
import '../src/styles.css';
const album = { Id: 'fixture-album', Name: 'Fixture Album', AlbumArtist: 'Test Artist' };
const tracks = [1, 2, 3].map(index => ({
  Id: `fixture-track-${index}`, Name: `Fixture Track ${index}`, Artists: ['Test Artist'],
  AlbumId: album.Id, Album: album.Name, RunTimeTicks: 1800000000, IndexNumber: index,
}));
let failDetailOnce = new URL(location.href).searchParams.has('failDetail');
let libraryLoads = 0;
const nativeListeners = new Map();
window.Capacitor = { Plugins: { MediaBridge: {
  addListener(name, listener) { nativeListeners.set(name, listener); },
  async playStream() {}, async pause() {}, async resume() {}, async seek() {},
  async isCached() { return { cached: false }; },
  async updateNowPlaying() {}, async setVolume() {},
} } };
window.fetch = async input => {
  const url = new URL(input, location.href);
  let data = {};
  let status = 200;
  if (url.pathname === '/Users') data = [{ Id: 'fixture-user' }];
  else if (url.pathname.endsWith('/Views')) data = { Items: [{ Id: 'fixture-library', CollectionType: 'music' }] };
  else if (url.pathname.endsWith(`/Items/${album.Id}`)) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (failDetailOnce) { status = 503; failDetailOnce = false; }
    else data = album;
  } else if (url.pathname.endsWith('/Items')) {
    if (url.searchParams.get('IncludeItemTypes') === 'Audio') data = { Items: tracks };
    else { libraryLoads++; data = { Items: [{ ...album, Name: libraryLoads > 1 ? 'Fixture Album Refreshed' : album.Name }] }; }
  }
  return {
    ok: status === 200, status, json: async () => data,
    blob: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#212830"/></svg>'], { type: 'image/svg+xml' }),
  };
};
// Also keep browser-owned image requests local if an image fallback is used.
const { config } = await import('../src/config.js');
config.SERVER = location.origin;
config.API_KEY = 'fixture-only';
const { default: App } = await import('../src/components/App.jsx');
render(<App />, document.getElementById('app'));
