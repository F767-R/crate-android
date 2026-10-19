import assert from 'node:assert/strict';
import { createContextMenuActions } from '../src/utils/contextMenuActions.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tracks = [{ Id: 'first' }, { Id: 'second' }];
const detail = { Id: 'album', Items: tracks };
let target = null;
let view = { type: 'search' };
let generation = 0;
let playbackCommand = 0;
let albumLoader = async () => detail;
const commands = [];
const statuses = [];
const actions = createContextMenuActions({
  getTarget: () => target,
  getView: () => view,
  getGeneration: () => generation,
  loadAlbum: (...args) => albumLoader(...args),
  beginPlaybackCommand: () => ++playbackCommand,
  isPlaybackCommandCurrent: command => command === playbackCommand,
  playFromHere: (...args) => { playbackCommand++; commands.push(['play', ...args]); },
  playNext: (...args) => commands.push(['next', ...args]),
  addToQueue: (...args) => commands.push(['queue', ...args]),
  close: closed => { if (target === closed) target = null; },
  onState: status => statuses.push(status),
});

target = { kind: 'album', albumId: 'album' };
assert.equal(await actions.run('play'), true);
assert.deepEqual(commands.pop(), ['play', tracks, 0, 'album'], 'cached album play must receive Items, not the detail envelope');
assert.equal(target, null, 'a successfully dispatched play closes its own menu');
target = { kind: 'album', albumId: 'album' };
await actions.run('next');
assert.deepEqual(commands.pop(), ['next', tracks[0], 'album'], 'album play-next preserves the first-track behavior');
target = { kind: 'album', albumId: 'album' };
await actions.run('queue');
assert.deepEqual(commands.pop(), ['queue', tracks[0], 'album']);

let pending = deferred();
let loadCount = 0;
albumLoader = (_albumId, { signal }) => { loadCount++; assert.equal(signal.aborted, false); return pending.promise; };
target = { kind: 'album', albumId: 'uncached' };
const loading = actions.run('play');
const duplicate = actions.run('play');
assert.equal(statuses.at(-1).loading, true);
assert.equal(loadCount, 1);
pending.resolve({ Id: 'uncached', Items: tracks });
assert.equal(await loading, true);
await duplicate;
assert.equal(commands.length, 1, 'rapid duplicate taps dispatch one command');
commands.length = 0;

for (const invalidate of [() => { target = null; }, () => { target = { kind: 'album', albumId: 'replacement' }; }, () => { view = { type: 'grid' }; }, () => { generation++; }, () => { playbackCommand++; }]) {
  pending = deferred();
  target = { kind: 'album', albumId: 'old' };
  const obsolete = actions.run('play');
  invalidate();
  pending.resolve(detail);
  assert.equal(await obsolete, false);
  assert.equal(commands.length, 0, 'a dismissed/replaced/navigated/refreshed/superseded menu must not start old playback');
}

pending = deferred();
target = { kind: 'album', albumId: 'retry' };
const failing = actions.run('queue');
pending.reject(new Error('mock offline failure'));
assert.equal(await failing, false);
assert.equal(target.albumId, 'retry');
assert.equal(statuses.at(-1).loading, false);
assert.equal(statuses.at(-1).action, 'queue');
assert.ok(statuses.at(-1).error);
albumLoader = async () => detail;
assert.equal(await actions.run(statuses.at(-1).action), true);
assert.deepEqual(commands.pop(), ['queue', tracks[0], 'retry']);

target = { track: tracks[1], tracks, index: 1, albumId: 'album' };
albumLoader = () => { throw new Error('track actions must not fetch an album'); };
await actions.run('next');
assert.deepEqual(commands.pop(), ['next', tracks[1], 'album']);
target = { track: tracks[1], tracks, index: 1, albumId: 'album' };
await actions.run('play');
assert.deepEqual(commands.pop(), ['play', tracks, 1, 'album']);
target = { track: tracks[1], albumId: 'album' };
await actions.run('queue');
assert.deepEqual(commands.pop(), ['queue', tracks[1], 'album']);

target = { kind: 'album', albumId: 'empty' };
albumLoader = async () => ({ Items: [] });
assert.equal(await actions.run('play'), false);
assert.equal(statuses.at(-1).error.code, 'empty_album');
assert.equal(commands.length, 0);
console.log('context menu smoke test passed');
