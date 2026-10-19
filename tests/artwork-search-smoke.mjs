import assert from 'node:assert/strict';
import { artworkKey, createArtworkPool } from '../src/utils/artworkPool.js';
import { observeArtworkNearViewport } from '../src/utils/artworkVisibility.js';
import { createLibrarySearchSelector, searchLibrary } from '../src/utils/librarySearch.js';
import { buildRowOffsets, virtualKeyboardTarget, visibleWindow } from '../src/utils/visibleWindow.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const descriptor = (itemId, extras = {}) => ({ server: 'https://example.test', itemId, size: 'primary', imageTag: 'one', ...extras });
let created = 0;
let fetches = 0;
const revoked = new Set();
const pool = createArtworkPool({
  loadBlob: async () => { fetches++; return { size: 100 }; },
  createUrl: () => `blob:test-${++created}`,
  revokeUrl: url => revoked.add(url),
  maxDormant: 100,
});
const held = Array.from({ length: 150 }, (_, index) => pool.acquire(descriptor(`image-${index}`)));
const urls = await Promise.all(held.map(lease => lease.promise));
assert.equal(revoked.size, 0, 'more than 100 displayed/leased images must never revoke an active URL');
assert.equal(pool.stats().entries, 150);
held.slice(0, 125).forEach(lease => lease.release());
assert.equal(pool.stats().dormant, 100);
assert.equal(revoked.size, 25);
assert.ok(urls.slice(125).every(url => !revoked.has(url)), 'active leases survive dormant cache eviction');
const beforeReuse = fetches;
const reused = pool.acquire(descriptor('image-124'));
assert.equal(await reused.promise, urls[124]);
assert.equal(fetches, beforeReuse);
reused.release();
reused.release();
assert.equal(pool.stats().dormant, 100, 'release must be idempotent');
held.slice(125).forEach(lease => lease.release());
assert.equal(pool.stats().dormant, 100);

const byteLimited = createArtworkPool({
  loadBlob: async () => ({ size: 80 }), createUrl: () => `blob:bytes-${++created}`, revokeUrl: () => {},
  maxDormant: 100, maxDormantBytes: 100,
});
const byteLeases = [byteLimited.acquire(descriptor('one')), byteLimited.acquire(descriptor('two'))];
await Promise.all(byteLeases.map(lease => lease.promise));
byteLeases.forEach(lease => lease.release());
assert.equal(byteLimited.stats().dormant, 1, 'dormant images are bounded by bytes as well as count');

let concurrent = 0;
let peak = 0;
const started = [];
const pending = [];
const limited = createArtworkPool({
  loadBlob: (item, { signal }) => {
    concurrent++;
    peak = Math.max(peak, concurrent);
    started.push(item.itemId);
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const task = { resolve, reject, signal, done: false };
    pending.push(task);
    signal.addEventListener('abort', () => {
      task.done = true;
      reject(Object.assign(new Error('cancelled'), { code: 'aborted' }));
    }, { once: true });
    return promise.finally(() => { concurrent--; });
  },
  createUrl: () => `blob:limited-${++created}`, revokeUrl: () => {}, maxConcurrent: 4,
});
const queued = Array.from({ length: 8 }, (_, index) => limited.acquire(descriptor(`queued-${index}`)));
await tick();
assert.equal(started.length, 4);
assert.equal(limited.stats().running, 4);
queued[7].release();
queued[0].release();
await tick();
assert.equal(pending[0].signal.aborted, true, 'unused running work is cancelled');
assert.equal(started.includes('queued-7'), false, 'released queued work never starts');
for (let round = 0; round < 4; round++) {
  for (const task of pending) if (!task.done) { task.done = true; task.resolve({ size: 10 }); }
  await tick();
}
await Promise.allSettled(queued.map(lease => lease.promise));
assert.ok(peak <= 4, 'network concurrency must never exceed four');
assert.equal(limited.stats().running, 0);
queued.forEach(lease => lease.release());

let sharedSignal;
let resolveShared;
let sharedLoads = 0;
const sharedPool = createArtworkPool({
  loadBlob: (_item, { signal }) => {
    sharedLoads++;
    sharedSignal = signal;
    return new Promise(resolve => { resolveShared = resolve; });
  },
  createUrl: () => 'blob:shared', revokeUrl: () => {},
});
const left = sharedPool.acquire(descriptor('shared'));
const right = sharedPool.acquire(descriptor('shared'));
await tick();
left.release();
assert.equal(sharedLoads, 1);
assert.equal(sharedSignal.aborted, false, 'one released viewer cannot cancel another viewer');
resolveShared({ size: 5 });
assert.equal(await right.promise, 'blob:shared');
right.release();
for (const change of [{ server: 'https://other.test' }, { itemId: 'other' }, { size: 'detail' }, { imageTag: 'two' }]) {
  assert.notEqual(artworkKey(descriptor('key')), artworkKey(descriptor('key', change)));
}

const observers = [];
globalThis.IntersectionObserver = class {
  constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); observers.push(this); }
  observe(element) { this.targets.add(element); }
  unobserve(element) { this.targets.delete(element); }
  disconnect() { this.disconnected = true; }
};
const root = {};
const firstElement = { closest: () => root };
const secondElement = { closest: () => root };
const visibility = [];
const stopFirst = observeArtworkNearViewport(firstElement, value => visibility.push(value));
const stopSecond = observeArtworkNearViewport(secondElement, () => {});
assert.equal(observers.length, 1, 'artwork shares one observer per scroll container');
assert.equal(observers[0].options.rootMargin, '320px 0px');
assert.deepEqual(visibility, [], 'unobserved/offscreen artwork is not eagerly marked visible');
observers[0].callback([{ target: firstElement, isIntersecting: true }, { target: firstElement, isIntersecting: false }]);
assert.deepEqual(visibility, [true, false]);
stopFirst();
assert.equal(observers[0].disconnected, undefined);
stopSecond();
assert.equal(observers[0].disconnected, true);
delete globalThis.IntersectionObserver;

let titleReads = 0;
const tracks = Array.from({ length: 10000 }, (_, index) => ({ Id: `track-${index}`, get Name() { titleReads++; return `Song ${index}`; }, Artists: ['Artist'] }));
const albums = [{ Id: 'album', Name: 'Album', AlbumArtist: 'Singer' }];
const translatedAlbums = {};
const translatedTracks = { 'track-1': { title: 'Translated Title', artist: 'Translated Artist' } };
const select = createLibrarySearchSelector();
const results = select('s', albums, tracks, translatedAlbums, translatedTracks);
assert.equal(results.tracks.length, 10000, 'virtualization must not cap the actual search result set');
const readsAfterIndex = titleReads;
assert.strictEqual(select(' S ', albums, tracks, translatedAlbums, translatedTracks), results);
assert.equal(titleReads, readsAfterIndex, 'unrelated renders reuse normalized fields and results');
assert.deepEqual(select('translated', albums, tracks, translatedAlbums, translatedTracks).tracks.map(track => track.Id), ['track-1']);
assert.equal(titleReads, readsAfterIndex, 'query changes reuse the normalized index');
const newTranslations = { ...translatedTracks, 'track-2': { title: 'Another translated title' } };
assert.deepEqual(select('translated', albums, tracks, translatedAlbums, newTranslations).tracks.map(track => track.Id), ['track-1', 'track-2']);
assert.ok(titleReads > readsAfterIndex, 'new translation references invalidate the index');
assert.deepEqual(select(' ', albums, tracks, translatedAlbums, newTranslations), { albums: [], tracks: [] });
assert.deepEqual(searchLibrary('Song 99', albums, tracks, translatedAlbums, newTranslations).tracks,
  select('Song 99', albums, tracks, translatedAlbums, newTranslations).tracks);

const offsets = buildRowOffsets(10000, new Map([[0, 100], [3, 120]]), 60);
assert.equal(offsets[1], 100);
assert.equal(offsets[4], 340);
for (const position of [-500, 0, 60, 1500, offsets.at(-1) - 200, offsets.at(-1) + 500]) {
  const window = visibleWindow(offsets, position, 700, 5);
  assert.ok(window.start >= 0 && window.end <= 10000 && window.start < window.end);
  assert.ok(window.end - window.start < 30, 'a large result set mounts only a viewport-sized slice');
  assert.equal(window.top + offsets[window.end] - offsets[window.start] + window.bottom, offsets.at(-1));
}
assert.deepEqual(visibleWindow([0], 0, 700), { start: 0, end: 0, top: 0, bottom: 0 });
const keyboard = { key: 'Tab', shiftKey: false, rowIndex: 9, column: 0, columnCount: 4, itemCount: 20, start: 5, end: 10 };
assert.equal(virtualKeyboardTarget(keyboard), null, 'Tab must visit remaining album columns before crossing a row boundary');
assert.deepEqual(virtualKeyboardTarget({ ...keyboard, column: 3 }), { index: 10, column: 0 });
assert.equal(virtualKeyboardTarget({ ...keyboard, rowIndex: 8, column: 3 }), null, 'mounted next rows retain native Tab navigation');
assert.equal(virtualKeyboardTarget({ ...keyboard, shiftKey: true, rowIndex: 5, column: 3 }), null);
assert.deepEqual(virtualKeyboardTarget({ ...keyboard, shiftKey: true, rowIndex: 5, column: 0 }), { index: 4, column: Number.MAX_SAFE_INTEGER });
assert.equal(virtualKeyboardTarget({ ...keyboard, rowIndex: 19, column: 3 }), null, 'Tab may exit at the end of the full result set');
assert.deepEqual(virtualKeyboardTarget({ ...keyboard, key: 'ArrowDown', column: 2 }), { index: 10, column: 2 });
console.log('artwork and search performance smoke test passed');
