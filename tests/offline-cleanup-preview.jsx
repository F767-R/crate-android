// Local-only recovery fixture: all network and Android calls are simulated.
import { h, render } from 'preact';
import '../src/styles.css';
const listeners = new Map();
const album = { Id: 'fixture-album', Name: 'Album with a long title for layout verification', ProductionYear: new URL(location.href).searchParams.has('missingyear') ? null : 2022, AlbumArtist: 'Long album artist name with several collaborating performers' };
const tracks = [1, 2, 3, 4, 5, 6].map(index => ({ id: `recovered-${index}`, title: `Track ${index}: A longer title with collaborating performers`,
  originalTitle: `Offline Track ${index}`, artist: 'Fixture Artist', originalArtist: 'Fixture Artist',
  albumId: album.Id, albumTitle: album.Name, durationMs: 180000 }));
let state = { supported: true, protocolVersion: 2, sessionId: 'fixture-service', revision: 0,
  eventRequestId: 0, initialized: true, restoredState: true, currentTrack: tracks[0], sourceTracks: tracks,
  queue: [tracks[2]], index: 0, positionMs: 42000, durationMs: 180000, isPlaying: false,
  desiredPlaying: false, isLocal: false, buffering: false, quality: 'low', repeatMode: 'off',
  shuffleOn: false, error: null, sleep: { mode: null, endTimeMs: 0, queueDrained: false } };
const snapshot = () => JSON.parse(JSON.stringify(state, (key, value) => ['lowUrl', 'highUrl', 'artUrl'].includes(key) ? undefined : value));
const changed = () => { state.revision++; const data = snapshot(); listeners.get('playbackSnapshot')?.(data); return data; };
let cache = { audioBytes: 92 * 1024 * 1024, artworkBytes: 4 * 1024 * 1024, audioLimitBytes: 512 * 1024 * 1024, artworkLimitBytes: 64 * 1024 * 1024 };
window.Capacitor = { Plugins: { MediaBridge: {
  async getDownloadedTracks() { return {itemIds:['recovered-2','recovered-5']}; },
  async playSelection({tracks: selected,index}) { state.sourceTracks=selected; state.index=index; state.currentTrack=selected[index]; state.positionMs=0; state.isPlaying=true; state.desiredPlaying=true; state.isLocal=true; state.eventRequestId++; return changed(); },
  async getCacheStats() { return { ...cache }; },
  async setCacheLimit({ audioLimitBytes }) { cache.audioLimitBytes = audioLimitBytes; return { ...cache }; },
  async clearCache() { cache.audioBytes = 0; cache.artworkBytes = 0; return { ...cache }; },
  addListener(name, listener) { listeners.set(name, listener); return { remove() {} }; },
  async configurePlayback() { return snapshot(); }, async getPlaybackSnapshot() { return snapshot(); },
  async pause() { state.isPlaying = false; state.desiredPlaying = false; return changed(); },
  async resume() { state.isPlaying = true; state.desiredPlaying = true; return changed(); },
  async nextTrack() { state.index = (state.index + 1) % tracks.length; state.currentTrack = tracks[state.index]; state.eventRequestId++; state.positionMs = 0; return changed(); },
  async previousTrack() { state.index = Math.max(0, state.index - 1); state.currentTrack = tracks[state.index]; state.eventRequestId++; state.positionMs = 0; return changed(); },
  async setPlaybackOptions(options) { Object.assign(state, options); return changed(); },
  async setSleepTimer(options) { state.sleep = { ...options, queueDrained: false }; return changed(); },
  async seekAbsolute({ positionMs, playWhenReady }) { state.positionMs = positionMs; if (playWhenReady !== undefined) state.isPlaying = state.desiredPlaying = playWhenReady; return changed(); },
  async mutateQueue(options) { if (options.action === 'clear') state.queue = []; else if (options.action === 'remove') state.queue.splice(options.index, 1); return changed(); },
  async updateNowPlaying() {}, async setVolume() {},
} } };
let simulatedOffline = false;
window.fetch = async input => {
  if (simulatedOffline) throw new TypeError("offline fixture");
  if (new URL(location.href).searchParams.has('offline')) throw new TypeError('Simulated offline connection');
  const url = new URL(input, location.href);
  let data = {};
  let status = 200;
  if (url.pathname === '/Users') {
    if (new URL(location.href).searchParams.has('offline')) status = 503;
    else data = [{ Id: 'fixture-user' }];
  } else if (url.pathname.endsWith('/Views')) data = { Items: [{ Id: 'fixture-library', CollectionType: 'music' }] };
  else if (url.pathname.endsWith(`/Items/${album.Id}`)) data = album;
  else if (url.pathname.endsWith('/Items')) data = { Items: url.searchParams.get('IncludeItemTypes') === 'Audio'
    ? tracks.map((track, index) => ({ Id: track.id, Name: track.title, Artists: [track.artist],
      AlbumId: album.Id, Album: album.Name, RunTimeTicks: track.durationMs * 10000, IndexNumber: index % 3 + 1, ParentIndexNumber: Math.floor(index / 3) + 1 }))
    : [album] };
  return { ok: status === 200, status, json: async () => data,
    blob: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#385264"/></svg>'], { type: 'image/svg+xml' }) };
};
const { config } = await import('../src/config.js');
config.SERVER = location.origin;
config.API_KEY = 'offline-fixture-only';
// Deterministic storage boundary for headless virtual-time testing.
const savedRecords = new Map();
Object.defineProperty(window, 'indexedDB', { value: { open() {
  const request = {};
  setTimeout(() => {
    request.result = { transaction() {
      const tx = {};
      const action = (key, value, write) => {
        const result = {};
        setTimeout(() => { if (write) savedRecords.set(key, structuredClone(value)); result.result = savedRecords.get(key); tx.oncomplete?.(); }, 0);
        return result;
      };
      tx.objectStore = () => ({ get: key => action(key), put: (value,key) => action(key,value,true) });
      return tx;
    }};
    request.onsuccess();
  }, 0);
  return request;
} } });
const { default: App } = await import('../src/components/App.jsx');
render(<App />, document.getElementById('app'));

const pause = () => new Promise(resolve => setTimeout(resolve, 70));
const waitFor = async predicate => { for (let i=0;i<100;i++) { if (predicate()) return; await pause(); } throw new Error('UI wait timed out'); };
const check = (condition, message) => { if (!condition) throw new Error(message); };
try {
  await waitFor(() => document.querySelector('.album-card'));
  await pause();
  check(!document.querySelector('.library-status'), 'online status must be absent');
  document.querySelector('.album-card').click();
  await waitFor(() => document.querySelector('.disc-header'));
  check(!document.querySelector('.track-header .meta').textContent.includes('tracks'), 'no track totals');
  check(new URL(location.href).searchParams.has('missingyear') ? !document.querySelector('.album-year') : document.querySelector('.album-year')?.textContent === '2022', 'year placement');
  check(document.querySelectorAll('.download-badge[aria-label="Downloaded, low quality"] svg').length === 2, 'accessible icons');
  check(document.querySelector('.download-badge').textContent.trim() === '', 'no visible download label');
  check(getComputedStyle(document.querySelector('.track-index')).borderTopWidth === '0px', 'plain track numbers');
  check(getComputedStyle(document.querySelector('.track-row.playing .idx')).display === 'none', 'playing indicator replaces number');
  const offline = await import('../src/stores/offline.js');
  const downloads = await import('../src/utils/downloads.js');
  const library = await import('../src/utils/libraryData.js');
  offline.libraryUsingSaved.value = true;
  await pause();
  check(!!document.querySelector('.download-filter'), 'offline filter visible');
  downloads.setDownloadedOnly(true);
  simulatedOffline = true;
  await library.refreshLibrary();
  await pause();
  check(offline.downloadedOnly.value && !!document.querySelector('.download-filter'), 'failed reconnect preserves offline filter');
  simulatedOffline = false;
  await library.refreshLibrary();
  await library.syncLibraryIndex();
  await waitFor(() => document.querySelectorAll('.track-row').length === 6);
  check(!offline.downloadedOnly.value && !document.querySelector('.library-status'), 'successful reconnect restores online view');
  downloads.downloadedIds.value = new Set();
  await pause();
  check(!document.querySelector('.download-badge'), 'evicted cache removes icons');
  downloads.downloadedIds.value = new Set(['recovered-2','recovered-5']);
  offline.librarySaveError.value = true;
  await pause();
  check(!!document.querySelector('.library-status [role="alert"]') && !document.querySelector('.download-filter'), 'online errors remain actionable');
  offline.librarySaveError.value = false;
  await pause();
  document.body.dataset.testResult = 'passed';
} catch (error) { document.body.dataset.testResult = `failed: ${error.message}`; }
