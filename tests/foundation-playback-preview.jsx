// Local-only recovery fixture: all network and Android calls are simulated.
import { h, render } from 'preact';
import '../src/styles.css';
const listeners = new Map();
const album = { Id: 'fixture-album', Name: 'Recovered Album', AlbumArtist: 'Fixture Artist' };
const tracks = [1, 2, 3].map(index => ({ id: `recovered-${index}`, title: `Recovered Track ${index}`,
  originalTitle: `Recovered Track ${index}`, artist: 'Fixture Artist', originalArtist: 'Fixture Artist',
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
window.fetch = async input => {
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
      AlbumId: album.Id, Album: album.Name, RunTimeTicks: track.durationMs * 10000, IndexNumber: index + 1 }))
    : [album] };
  return { ok: status === 200, status, json: async () => data,
    blob: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#385264"/></svg>'], { type: 'image/svg+xml' }) };
};
const { config } = await import('../src/config.js');
config.SERVER = location.origin;
config.API_KEY = 'fixture-only';
const { default: App } = await import('../src/components/App.jsx');
render(<App />, document.getElementById('app'));

if (new URL(location.href).searchParams.has('backTest')) {
  const button = document.createElement('button');
  button.textContent = 'Simulate Android Back';
  button.style.cssText = 'position:fixed;right:12px;top:110px;z-index:3000;padding:10px';
  button.onclick = () => {
    const unhandled = window.dispatchEvent(new Event('crate:back', { cancelable: true }));
    button.textContent = unhandled ? 'Background requested — simulate Back' : 'Simulate Android Back';
  };
  document.body.appendChild(button);
}
