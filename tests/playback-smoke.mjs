import assert from 'node:assert/strict';

const nativeListeners = new Map();
const calls = [];

function emit(name, data = {}) {
  for (const listener of nativeListeners.get(name) || []) listener(data);
}

globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
};
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
globalThis.window = {
  addEventListener() {},
  Capacitor: {
    Plugins: {
      MediaBridge: {
        addListener(name, listener) {
          nativeListeners.set(name, [...(nativeListeners.get(name) || []), listener]);
        },
        async playStream(payload) {
          calls.push(['playStream', payload]);
          emit('stateChanged', {
            isPlaying: true,
            position: 0,
            duration: payload.durationMs,
            isLocal: false,
            buffering: false,
          });
        },
        async pause() { calls.push(['pause']); },
        async resume() { calls.push(['resume']); },
        async seek(payload) { calls.push(['seek', payload]); },
        async isCached(payload) {
          calls.push(['isCached', payload]);
          return { cached: payload.itemId === 'two' };
        },
        async setVolume(payload) { calls.push(['setVolume', payload]); },
        async updateNowPlaying(payload) { calls.push(['updateNowPlaying', payload]); },
      },
    },
  },
};

const state = await import('../src/stores/state.js');
const { initNativeBridge } = await import('../src/utils/nativeBridge.js');
const { initPlayerShim } = await import('../src/utils/playerShim.js');
const controls = await import('../src/utils/playbackControls.js');
const { qualityPreset } = await import('../src/config.js');
const { parseLRC } = await import('../src/utils/lrcParser.js');
const { hideLyricsView, showAlbumGrid, showLyricsView, showNowPlayingTrack } = await import('../src/utils/navigation.js');

initNativeBridge();
initPlayerShim();
controls.attachPlaybackControlListeners();

const tracks = [
  { Id: 'one', Name: 'One', Artists: ['Artist One'], AlbumId: 'album', RunTimeTicks: 1200000000 },
  { Id: 'two', Name: 'Two', ArtistItems: [{ Name: 'Artist Two' }], AlbumId: 'album', RunTimeTicks: 900000000 },
];
const queued = { Id: 'queued', Name: 'Queued', ArtistNames: ['Queue Artist'], RunTimeTicks: 600000000 };

state.currentTracks.value = tracks;
await controls.playTrack(tracks[0]);
assert.equal(state.playbackCurrentTrack.value.Id, 'one');
assert.equal(calls.at(-1)[1].artist, 'Artist One');
assert.equal(state.playbackItemCached.value, false);
emit('cacheReady', { itemId: 'one' });
assert.equal(state.playbackItemCached.value, true);

assert.equal(showNowPlayingTrack(tracks[0]), true);
assert.equal(state.currentViewState.value.type, 'album');
assert.equal(state.currentViewState.value.albumId, 'album');
assert.equal(state.currentViewState.value.centerTrackId, 'one');
const firstCenterRequest = state.currentViewState.value.centerRequestId;
showNowPlayingTrack(tracks[0]);
assert.ok(state.currentViewState.value.centerRequestId > firstCenterRequest);

controls.addToQueue(queued);
await controls.handleNext();
assert.equal(state.playbackCurrentTrack.value.Id, 'queued');
assert.equal(state.queue.value.length, 0);

emit('trackEnded');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(state.playbackCurrentTrack.value.Id, 'two');
assert.equal(calls.filter(([name]) => name === 'playStream').at(-1)[1].artist, 'Artist Two');

state.repeatMode.value = 'one';
const playCountBeforeRepeat = calls.filter(([name]) => name === 'playStream').length;
emit('trackEnded');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(state.playbackCurrentTrack.value.Id, 'two');
assert.equal(calls.filter(([name]) => name === 'playStream').length, playCountBeforeRepeat + 1);
state.repeatMode.value = 'off';

emit('sessionSeek', { positionMs: 42000 });
await new Promise(resolve => setTimeout(resolve, 0));
const seekRestart = calls.filter(([name]) => name === 'playStream').at(-1)[1];
assert.equal(seekRestart.startPositionMs, 42000);
assert.match(seekRestart.url, /StartTimeTicks=420000000/);

await controls.togglePlayPause();
assert.equal(calls.at(-1)[0], 'pause');
await controls.togglePlayPause();
assert.equal(calls.at(-1)[0], 'resume');

const timedLyrics = parseLRC('[00:01.50]First line\n[00:03.00][00:05.00]Again');
assert.deepEqual(timedLyrics.lines.map(line => line.text), ['First line', 'Again', 'Again']);
assert.deepEqual(parseLRC('Plain lyric').lines, [{ time: -1, text: 'Plain lyric' }]);

state.currentViewState.value = { type: 'search', query: 'One' };
state.albumGridFocusAlbumId.value = 'album';
state.albumGridFollowPlayback.value = true;
assert.equal(showNowPlayingTrack(tracks[0]), true);
assert.equal(state.currentViewState.value.gridReturnMode, 'center');
showAlbumGrid({ centerAlbumId: state.currentViewState.value.gridReturnAlbumId });
assert.equal(state.currentViewState.value.type, 'grid');
assert.equal(state.currentViewState.value.centerAlbumId, 'album');
assert.equal(state.albumGridFocusAlbumId.value, null);
assert.equal(state.albumGridFollowPlayback.value, false);

const previousView = {
  type: 'search',
  query: 'Singer',
  gridReturnMode: 'restore',
  gridReturnAlbumId: 'album',
};
state.currentViewState.value = previousView;
showLyricsView();
assert.equal(state.currentViewState.value.type, 'lyrics');
assert.strictEqual(state.previousViewState.value, previousView);
hideLyricsView();
assert.strictEqual(state.currentViewState.value, previousView);
assert.equal(state.previousViewState.value, null);

qualityPreset.value = 'high';
await controls.toggleQuality();
assert.equal(qualityPreset.value, 'low');
assert.deepEqual(calls.findLast(([name]) => name === 'isCached'), ['isCached', { itemId: 'two' }]);
assert.equal(calls.filter(([name]) => name === 'playStream').at(-1)[1].cache, true);
assert.equal(state.playbackItemCached.value, true);

console.log('playback smoke test passed');
process.exit(0);
