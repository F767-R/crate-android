// Checked JavaScript contract tests. @ts-expect-error cases must keep failing;
// if a contract silently becomes permissive, tsc reports an unused directive.
import { isNativePlaybackSnapshot, trackFromNativeSnapshot } from '../../src/utils/nativePlaybackProtocol.js';
/** @typedef {import('../../src/types/contracts.js').Track} Track */
/** @typedef {import('../../src/types/contracts.js').AlbumDetails} AlbumDetails */
/** @typedef {import('../../src/types/contracts.js').QueueEntry} QueueEntry */
/** @typedef {import('../../src/types/contracts.js').NativePlaybackTrackInput} NativePlaybackTrackInput */
/** @typedef {import('../../src/types/contracts.js').NativePlaybackTrackSnapshot} NativePlaybackTrackSnapshot */
/** @typedef {import('../../src/types/contracts.js').NativePlaybackSnapshot} NativePlaybackSnapshot */
/** @typedef {import('../../src/types/contracts.js').NativeQueueMutation} NativeQueueMutation */
/** @typedef {import('../../src/types/contracts.js').NativeCacheStats} NativeCacheStats */

/** @type {Track} */
const track = { Id: 'track-1', Name: 'Title', ArtistItems: [{ Name: 'Artist' }], RunTimeTicks: 900000000 };
/** @type {AlbumDetails} */
const album = { Id: 'album-1', Name: 'Album', Items: [track] };
/** @type {QueueEntry[]} */
const queue = [{ track, albumId: album.Id }];

/** @type {Track} */
// @ts-expect-error Stable track identity is required.
const missingTrackId = { Name: 'No identity' };
/** @type {AlbumDetails} */
// @ts-expect-error Album details contain metadata and Items, not a bare track array.
const legacyAlbumCache = [track];
/** @type {QueueEntry} */
// @ts-expect-error Queue entries wrap their track.
const unwrappedQueueEntry = track;

/** @type {NativePlaybackTrackInput} */
const privateTrack = {
  id: 'track-1', title: 'Title', artist: 'Artist', albumId: 'album-1', durationMs: 90000,
  lowUrl: 'https://jellyfin.test.invalid/audio-low', highUrl: 'https://jellyfin.test.invalid/audio-high', artUrl: null,
};
/** @type {NativePlaybackTrackSnapshot} */
const publicTrack = { id: privateTrack.id, title: privateTrack.title, artist: privateTrack.artist, albumId: privateTrack.albumId, durationMs: privateTrack.durationMs };
/** @type {NativePlaybackTrackSnapshot} */
// @ts-expect-error A private descriptor cannot be assigned to a public snapshot.
const leakedTrack = privateTrack;

/** @type {NativePlaybackSnapshot} */
const snapshot = {
  supported: true, protocolVersion: 2, sessionId: 'test-session', revision: 1, eventRequestId: 1,
  currentTrack: publicTrack, positionMs: 0, durationMs: 90000, isPlaying: false, desiredPlaying: false,
  buffering: false, isLocal: false, quality: 'low', error: null, sourceTracks: [publicTrack], index: 0,
  queue: [], repeatMode: 'off', shuffleOn: false, sleep: { mode: null, endTimeMs: null, queueDrained: false },
};
// @ts-expect-error Protocol fields distinguish requested IDs from timestamps/strings.
snapshot.eventRequestId = '1';
// @ts-expect-error Only supported quality presets may cross the bridge.
snapshot.quality = 'lossless';

/** @type {NativeQueueMutation} */
const move = { action: 'move', index: 0, toIndex: 1, expectedRevision: 1 };
/** @type {NativeQueueMutation} */
// @ts-expect-error A move always identifies its destination.
const missingDestination = { action: 'move', index: 0 };
/** @type {NativeCacheStats} */
const cache = { audioBytes: 0, artworkBytes: 0, audioLimitBytes: 512 * 1024 * 1024, artworkLimitBytes: 64 * 1024 * 1024 };
// @ts-expect-error Native byte counts are numbers, never formatted labels.
cache.audioBytes = '512 MiB';

/** @type {unknown} */
const wireValue = {};
if (isNativePlaybackSnapshot(wireValue)) {
  /** @type {Track | null} */
  const restored = trackFromNativeSnapshot(wireValue.currentTrack);
  void restored;
}
void [queue, missingTrackId, legacyAlbumCache, unwrappedQueueEntry, leakedTrack, snapshot, move, missingDestination, cache];
