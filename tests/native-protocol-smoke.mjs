import assert from 'node:assert/strict';
import {
  MAX_NATIVE_PLAYBACK_ITEMS, isNativePlaybackTrackSnapshot, isNativePlaybackSnapshot,
  isNativePlaybackPositionEvent, trackFromNativeSnapshot,
} from '../src/utils/nativePlaybackProtocol.js';

const track = {
  id: 'track', title: 'Translated title', artist: 'Translated artist', albumId: 'album', durationMs: 90000,
  originalTitle: 'Original title', originalArtist: 'Original artist', albumTitle: 'Translated album',
  originalAlbumTitle: 'Original album', trackNumber: 2, discNumber: 1,
};
const status = {
  supported: true, protocolVersion: 2, sessionId: 'test-session', revision: 1, eventRequestId: 2,
  positionMs: 1234.5, durationMs: 90000, isPlaying: false, desiredPlaying: true,
  buffering: true, isLocal: false, quality: 'low',
};
const snapshot = {
  ...status, currentTrack: track, sourceTracks: [track], index: 0, queue: [],
  repeatMode: 'off', shuffleOn: false, error: null,
  sleep: { mode: null, endTimeMs: null, queueDrained: false },
};
assert.equal(isNativePlaybackSnapshot(snapshot), true);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, initialized: false, restoredState: true, cached: false }), true);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, currentTrack: null, sourceTracks: [], index: -1 }), true);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, error: { message: 'Safe error', code: 'test' } }), true);

for (const patch of [
  { supported: false }, { protocolVersion: 1 }, { sessionId: '' }, { revision: -1 }, { revision: 1.5 },
  { eventRequestId: '2' }, { eventRequestId: NaN }, { positionMs: Infinity }, { durationMs: -1 },
  { isPlaying: 1 }, { desiredPlaying: undefined }, { buffering: 'false' }, { isLocal: null },
  { quality: 'medium' }, { cached: 'yes' }, { initialized: null }, { restoredState: 'yes' },
  { sourceTracks: null }, { queue: {} }, { index: 1 }, { index: -2 }, { index: 0.5 },
  { repeatMode: 'random' }, { shuffleOn: 0 }, { error: {} }, { sleep: null },
  { sleep: { mode: 'forever', endTimeMs: 0, queueDrained: false } },
  { sleep: { mode: 'duration', endTimeMs: NaN, queueDrained: false } },
]) assert.equal(isNativePlaybackSnapshot({ ...snapshot, ...patch }), false);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, sourceTracks: [], index: 0 }), false);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, queue: Array(MAX_NATIVE_PLAYBACK_ITEMS + 1).fill(track) }), false);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, sourceTracks: Array(MAX_NATIVE_PLAYBACK_ITEMS + 1).fill(track) }), false);
assert.equal(isNativePlaybackSnapshot({ ...snapshot, queue: new Array(1) }), false, 'Sparse arrays contain invalid entries.');

for (const patch of [
  { id: '' }, { title: undefined }, { artist: null }, { albumId: undefined }, { durationMs: Infinity },
  { durationMs: Number.MAX_VALUE }, { originalTitle: 42 }, { trackNumber: -1 }, { discNumber: 1.5 },
  { lowUrl: 'https://test.invalid/private' }, { highUrl: '' }, { artUrl: null }, { url: 'private' },
]) assert.equal(isNativePlaybackTrackSnapshot({ ...track, ...patch }), false);
assert.equal(isNativePlaybackTrackSnapshot({ ...track, albumId: null }), true);

const position = { ...status, currentTrackId: 'track' };
assert.equal(isNativePlaybackPositionEvent(position), true);
assert.equal(isNativePlaybackPositionEvent({ ...position, currentTrackId: null, error: null, cached: true }), true);
assert.equal(isNativePlaybackPositionEvent({ ...position, protocolVersion: 1 }), false);
assert.equal(isNativePlaybackPositionEvent({ ...position, supported: false }), false);
assert.equal(isNativePlaybackPositionEvent({ ...position, currentTrackId: undefined }), false);
assert.equal(isNativePlaybackPositionEvent({ ...position, error: { message: 12 } }), false);

assert.deepEqual(trackFromNativeSnapshot(track), {
  Id: 'track', Name: 'Original title', Artists: ['Original artist'], AlbumId: 'album', Album: 'Original album',
  RunTimeTicks: 900000000, IndexNumber: 2, ParentIndexNumber: 1,
});
const emptyOriginals = trackFromNativeSnapshot({ ...track, originalTitle: '', originalArtist: '', originalAlbumTitle: '' });
assert.equal(emptyOriginals.Name, '');
assert.deepEqual(emptyOriginals.Artists, []);
assert.equal(emptyOriginals.Album, '');
assert.equal(trackFromNativeSnapshot(null), null);
assert.equal(trackFromNativeSnapshot({ ...track, lowUrl: 'private' }), null);
console.log('Native protocol validation and original-metadata reconstruction checks passed');
