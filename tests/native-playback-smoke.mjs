import assert from 'node:assert/strict';

const listeners = new Map();
const calls = [];
const stored = new Map();
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key),
};
const wire = id => ({ id, title: `Translated ${id}`, originalTitle: `Original ${id}`,
  artist: 'Translated artist', originalArtist: 'Original artist', albumId: 'album',
  albumTitle: 'Album', durationMs: 180000, trackNumber: 2, discNumber: 1 });
let snapshot = {
  supported: true, protocolVersion: 2, sessionId: 'first-service', revision: 4,
  eventRequestId: 8, initialized: true, restoredState: true,
  currentTrack: wire('A'), sourceTracks: [wire('A'), wire('B'), wire('C')], index: 0,
  queue: [wire('Q')], quality: 'low', repeatMode: 'off', shuffleOn: false,
  sleep: { mode: 'track', endTimeMs: 0, queueDrained: false },
  positionMs: 42000, durationMs: 180000, isPlaying: false, desiredPlaying: false,
  buffering: false, isLocal: false, error: null,
};
let hold = null;
const clone = () => JSON.parse(JSON.stringify(snapshot, (key, value) => ['lowUrl', 'highUrl', 'artUrl'].includes(key) ? undefined : value));
function bump() { snapshot.revision++; listeners.get('playbackSnapshot')?.(clone()); return clone(); }
const bridge = {
  addListener(name, callback) { listeners.set(name, callback); return { remove() {} }; },
  async getPlaybackSnapshot() { return clone(); },
  async configurePlayback(payload) { calls.push(['configure', payload]); return clone(); },
  async playSelection(payload) {
    calls.push(['selection', payload]);
    snapshot.currentTrack = payload.tracks[payload.index];
    snapshot.sourceTracks = payload.tracks;
    snapshot.index = payload.index;
    snapshot.eventRequestId++;
    snapshot.positionMs = 0;
    snapshot.desiredPlaying = true;
    return bump();
  },
  async nextTrack() {
    calls.push(['next']); snapshot.index++;
    snapshot.currentTrack = snapshot.sourceTracks[snapshot.index];
    snapshot.eventRequestId++; snapshot.positionMs = 0;
    return bump();
  },
  async setPlaybackOptions(payload) {
    calls.push(['options', payload]);
    if (hold) { const wait = hold; hold = null; await wait; }
    Object.assign(snapshot, payload); return bump();
  },
  async pause() { calls.push(['pause']); snapshot.desiredPlaying = false; snapshot.isPlaying = false; return bump(); },
  async resume() { calls.push(['resume']); snapshot.desiredPlaying = true; return bump(); },
  async seekAbsolute(payload) {
    calls.push(['seek', payload]); snapshot.positionMs = payload.positionMs;
    if (payload.playWhenReady !== undefined) snapshot.desiredPlaying = payload.playWhenReady;
    snapshot.eventRequestId++; return bump();
  },
  async mutateQueue(payload) {
    calls.push(['queue', payload]);
    if (payload.expectedRevision !== undefined && payload.expectedRevision !== snapshot.revision) throw new Error('stale');
    if (payload.action === 'add') snapshot.queue.push(payload.track);
    if (payload.action === 'remove') snapshot.queue.splice(payload.index, 1);
    if (payload.action === 'clear') snapshot.queue = [];
    return bump();
  },
  async setSleepTimer(payload) { calls.push(['sleep', payload]); snapshot.sleep = { ...payload, queueDrained: false }; return bump(); },
};
globalThis.window = { Capacitor: { Plugins: { MediaBridge: bridge } }, addEventListener() {} };
globalThis.fetch = async () => { throw new Error('Native controls must not invoke web playback/reporting'); };

const state = await import('../src/stores/state.js');
const native = await import('../src/utils/nativePlayback.js');
const controls = await import('../src/utils/playbackControls.js');
const mediaHandlers = new Map();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaSession: { setActionHandler: (name, handler) => mediaHandlers.set(name, handler) },
} });
controls.attachPlaybackControlListeners();
const { config, qualityPreset } = await import('../src/config.js');
const { initPlayerShim } = await import('../src/utils/playerShim.js');
assert.equal(await native.initNativePlayback(), true);
await mediaHandlers.get('pause')();
await mediaHandlers.get('pause')();
assert.equal(snapshot.desiredPlaying, false, 'repeated system Pause must never resume');
await mediaHandlers.get('play')();
await mediaHandlers.get('play')();
assert.equal(snapshot.desiredPlaying, true, 'repeated system Play must never pause');
await mediaHandlers.get('pause')();
calls.splice(1); // Keep the configuration call; isolate subsequent control assertions.
initPlayerShim();
assert.equal(state.playbackCurrentTrack.value.Name, 'Original A');
assert.equal(state.playbackCurrentTrack.value.Artists[0], 'Original artist');
assert.equal(state.playbackPosition.value, 42);
assert.equal(state.playbackPlaying.value, false, 'restored playback never claims autoplay');
assert.equal(state.sleepMode.value, 'track');
assert.equal(state.queue.value[0].track.Id, 'Q');
assert(!calls[0][1].scope.includes(config.API_KEY), 'scope must contain no raw API key');

const old = clone();
const compact = { ...clone(), currentTrackId: 'A', positionMs: 51000 };
assert.equal(native.applyNativePlaybackSnapshot(compact, { full: false }), true);
assert.equal(state.playbackPosition.value, 51, 'native milliseconds are already absolute');
listeners.get('stateChanged')({ position: 999000, isPlaying: true });
listeners.get('trackEnded')();
listeners.get('error')({ message: 'unsafe diagnostic' });
assert.equal(state.playbackPosition.value, 51, 'legacy events cannot overwrite v2 state');
assert.equal(state.playbackError.value, null);

await Promise.all([controls.handleNext({ type: 'click' }), controls.handleNext({ type: 'click' })]);
assert.equal(state.playbackCurrentTrack.value.Id, 'C', 'rapid next delegates distinct ordered native commands');
assert.equal(native.applyNativePlaybackSnapshot(old), false);
assert.equal(native.applyNativePlaybackSnapshot(compact, { full: false }), false);
assert.equal(state.playbackCurrentTrack.value.Id, 'C');
assert.equal(native.applyNativePlaybackSnapshot({ ...clone(), eventRequestId: NaN }), false);

await controls.seekTo(93, false);
assert.deepEqual(calls.find(([name]) => name === 'seek')[1], { positionMs: 93000, playWhenReady: false });
assert.equal(state.playbackPosition.value, 93);
assert.equal(native.nativeDesiredPlaying.value, false);

let release;
hold = new Promise(resolve => { release = resolve; });
const qualityOne = controls.toggleQuality();
await Promise.resolve();
const qualityTwo = controls.toggleQuality();
assert.equal(qualityPreset.value, 'low');
release();
await Promise.all([qualityOne, qualityTwo]);
assert.deepEqual(calls.filter(([name]) => name === 'options').map(([, options]) => options.quality), ['high', 'low']);
assert.equal(qualityPreset.value, 'low');
await Promise.all([controls.togglePlayPause(), controls.togglePlayPause()]);
assert.deepEqual(calls.filter(([name]) => ['pause', 'resume'].includes(name)).map(([name]) => name), ['resume', 'pause']);
assert.equal(native.nativeDesiredPlaying.value, false);

const beforeDrag = native.getNativePlaybackRevision();
await controls.addToQueue({ Id: 'added', Name: 'Added', AlbumId: 'album' });
await controls.removeQueuedTrack(0, beforeDrag);
assert.deepEqual(state.queue.value.map(item => item.track.Id), ['Q', 'added'], 'stale queue edits are rejected, not applied to another entry');
assert.equal(state.playbackError.value.code, 'native_command');
await native.nativePlaybackCommand('setSleepTimer', { mode: 'duration', endTimeMs: Date.now() + 60000 });
assert.equal(state.sleepMode.value, 'duration');

const descriptor = native.toNativeTrack({ Id: 'original', Name: '元', Artists: ['作者'], AlbumId: 'album' });
assert.equal(descriptor.originalTitle, '元');
assert.equal(new URL(descriptor.lowUrl).searchParams.get('StartTimeTicks'), null);
assert.equal(new URL(descriptor.highUrl).searchParams.get('StartTimeTicks'), null);
assert(!stored.has('crateQueue'), 'authenticated descriptors never go into web storage');

const retired = clone();
snapshot = { ...clone(), sessionId: 'second-service', revision: 0, eventRequestId: 0, positionMs: 7000 };
assert.equal(native.applyNativePlaybackSnapshot(snapshot), false, 'unknown service events need an authoritative read');
await native.refreshNativePlayback();
assert.equal(state.playbackPosition.value, 7);
assert.equal(native.applyNativePlaybackSnapshot(retired, { authoritative: true }), false, 'retired service replies cannot resurrect old playback');
// Public controls must route every Android action through the native protocol.
const selection = ['S1', 'S2', 'S3'].map(Id => ({ Id, Name: Id, AlbumId: 'source' }));
state.currentTracks.value = selection;
state.currentViewState.value = { type: 'album', albumId: 'source' };
await controls.playTrack(selection[1]);
assert.equal(snapshot.currentTrack.id, 'S2');
assert.equal(snapshot.sourceTracks.length, 3);
assert.equal(state.albumGridFollowPlayback.value, false);
state.currentViewState.value = { type: 'search' };
await controls.playFromHere(selection, 1, 'override');
const lastSelection = calls.filter(([name]) => name === 'selection').at(-1)[1];
assert.equal(lastSelection.queueMode, 'replace-tail');
assert.equal(lastSelection.index, 1);
assert(lastSelection.tracks.every(track => track.albumId === 'override'));
assert.equal(state.albumGridFocusAlbumId.value, 'override');
assert.equal(state.albumGridFollowPlayback.value, true);
for (const method of ['previousTrack', 'retryPlayback', 'playQueueItem']) {
  bridge[method] = async payload => { calls.push([method, payload]); return bump(); };
}
await controls.handlePrev();
assert.equal(calls.at(-1)[0], 'previousTrack');
await controls.retryPlayback();
assert.equal(calls.at(-1)[0], 'retryPlayback');
const queueRevision = native.getNativePlaybackRevision();
await controls.playNextFromQueue(1);
assert.deepEqual(calls.at(-1), ['playQueueItem', { index: 1, expectedRevision: queueRevision }]);
await controls.playNextInQueue({ Id: 'front' }, 'album');
assert.equal(calls.at(-1)[1].position, 'next');
const moveRevision = native.getNativePlaybackRevision();
await controls.moveQueuedTrack(0, 1, moveRevision);
assert.deepEqual(calls.at(-1), ['queue', { action: 'move', index: 0, toIndex: 1, expectedRevision: moveRevision }]);
await controls.clearQueuedTracks();
assert.deepEqual(state.queue.value, []);
await controls.toggleShuffle();
assert.equal(calls.at(-1)[1].shuffleOn, true);
await controls.toggleRepeat();
assert.equal(calls.at(-1)[1].repeatMode, 'all');
await controls.seekTo(12);
assert.equal(calls.at(-1)[1].playWhenReady, native.nativeDesiredPlaying.value);
const beforeEnd = calls.length;
await controls.handleTrackEnd();
assert.equal(calls.length, beforeEnd, 'Android alone handles end-of-track advancement');

const { downloadedIds } = await import('../src/utils/downloads.js');
const { downloadedOnly } = await import('../src/stores/offline.js');
downloadedIds.value = new Set(['S2']);
downloadedOnly.value = true;
qualityPreset.value = 'high';
state.currentTracks.value = selection;
await controls.playTrack(selection[1]);
assert.equal(qualityPreset.value, 'low', 'downloaded playback selects LQ even if HD was previously active');
assert.equal(snapshot.quality, 'low');
assert.deepEqual(snapshot.sourceTracks.map(track => track.id), ['S2'], 'downloaded selection cannot continue into unavailable tracks');
await controls.playFromHere(selection, 0);
assert.deepEqual(snapshot.sourceTracks.map(track => track.id), ['S2']);
downloadedOnly.value = false;
console.log('Native playback contract smoke passed: restore, absolute timeline, event identities, command order, queue conflicts, timer, URL boundaries.');
