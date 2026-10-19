import assert from 'node:assert/strict';

const calls = [];
const reports = [];
const listeners = new Map();
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let playBehavior = async () => {};
let seekBehavior = async () => {};
let pauseBehavior = async () => {};
let resumeBehavior = async () => {};
let cacheBehavior = async () => ({ cached: false });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async (url, options) => {
  reports.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
  return { ok: true };
};
globalThis.window = { Capacitor: { Plugins: { MediaBridge: {
  addListener(name, callback) { listeners.set(name, callback); },
  async playStream(payload) { calls.push(['play', payload]); return playBehavior(payload); },
  async pause() { calls.push(['pause']); return pauseBehavior(); },
  async resume() { calls.push(['resume']); return resumeBehavior(); },
  async seek(payload) { calls.push(['seek', payload]); return seekBehavior(payload); },
  async isCached(payload) { calls.push(['cached', payload]); return cacheBehavior(payload); },
} } } };

const state = await import('../src/stores/state.js');
const controls = await import('../src/utils/playbackControls.js');
const { audioShim, initPlayerShim } = await import('../src/utils/playerShim.js');
const { qualityPreset } = await import('../src/config.js');
initPlayerShim();
const tracks = ['A', 'B', 'C'].map(Id => ({ Id, Name: Id, RunTimeTicks: 1800000000 }));
const queued = ['Q1', 'Q2'].map(Id => ({ Id, Name: Id, RunTimeTicks: 1800000000 }));
const played = () => calls.filter(([name]) => name === 'play').map(([, payload]) => payload.title);

async function reset(quality = 'high') {
  playBehavior = async () => {};
  seekBehavior = async () => {};
  pauseBehavior = async () => {};
  resumeBehavior = async () => {};
  cacheBehavior = async () => ({ cached: false });
  state.currentTracks.value = tracks;
  state.queue.value = [];
  state.shuffleOn.value = false;
  state.repeatMode.value = 'off';
  state.sleepMode.value = null;
  state.sleepQueueDrained.value = false;
  qualityPreset.value = quality;
  await controls.playTrack(tracks[0]);
  calls.length = 0;
  reports.length = 0;
}

// A slow HD -> LQ lookup cannot reselect A after the user picks B.
await reset();
const qualityLookup = deferred();
cacheBehavior = () => qualityLookup.promise;
const changingQuality = controls.toggleQuality();
assert.equal(qualityPreset.value, 'low');
await controls.playTrack(tracks[1]);
qualityLookup.resolve({ cached: false });
assert.equal(await changingQuality, false);
assert.equal(state.playbackCurrentTrack.value.Id, 'B');
assert.deepEqual(played(), ['B']);

// Two rapid toggles are two intents, even with the first lookup pending.
await reset();
const slowToggle = deferred();
cacheBehavior = () => slowToggle.promise;
const firstToggle = controls.toggleQuality();
await controls.toggleQuality();
slowToggle.resolve({ cached: false });
await firstToggle;
assert.equal(qualityPreset.value, 'high');
assert.equal(state.playbackQuality.value, 'high');
assert.equal(played().length, 1);

// Preferred quality may change before it is active; native positions still
// belong to the old stream's quality until the replacement is started.
await reset();
state.playbackStartOffset.value = 30;
const qualityPosition = deferred();
cacheBehavior = () => qualityPosition.promise;
const waitingQuality = controls.toggleQuality();
listeners.get('stateChanged')({ position: 10000, isPlaying: true, isLocal: false });
assert.equal(state.playbackPosition.value, 10);
await controls.playTrack(tracks[1]);
qualityPosition.resolve({ cached: false });
await waitingQuality;

// A paused transcode seek must not pause a newer selected song on completion.
await reset('low');
await audioShim.pause();
const slowSeekStart = deferred();
playBehavior = payload => payload.title === 'A' ? slowSeekStart.promise : Promise.resolve();
const pausedSeek = controls.seekTo(20, false);
await controls.playTrack(tracks[1]);
const pauseCount = calls.filter(([name]) => name === 'pause').length;
slowSeekStart.resolve();
assert.equal(await pausedSeek, false);
assert.equal(state.playbackCurrentTrack.value.Id, 'B');
assert.equal(state.playbackPlaying.value, true);
assert.equal(calls.filter(([name]) => name === 'pause').length, pauseCount);
assert.deepEqual(reports.filter(r => r.path === '/Sessions/Playing').map(r => r.body.ItemId), ['B']);

// A pending seek must not undo a later explicit Pause (including sleep).
await reset();
const nativeSeek = deferred();
seekBehavior = () => nativeSeek.promise;
const seeking = controls.seekTo(45, true);
await audioShim.pause();
nativeSeek.resolve();
assert.equal(await seeking, false);
assert.equal(state.playbackPlaying.value, false);
assert.equal(calls.filter(([name]) => name === 'resume').length, 0);

// Track identity alone is insufficient: Retry must yield to a newer seek on A.
await reset('low');
const retryLookup = deferred();
cacheBehavior = () => retryLookup.promise;
const retrying = controls.retryPlayback();
await controls.seekTo(60, true);
retryLookup.resolve({ cached: false });
assert.equal(await retrying, false);
assert.equal(state.playbackPosition.value, 60);
assert.equal(played().length, 1);

// Old rejected native starts must not publish an error against newer playback.
await reset();
const rejectedStart = deferred();
playBehavior = payload => payload.title === 'A' ? rejectedStart.promise : Promise.resolve();
const startingA = controls.playTrack(tracks[0]);
await controls.playTrack(tracks[1]);
rejectedStart.reject(new Error('old start failed'));
assert.equal(await startingA, false);
assert.equal(state.playbackCurrentTrack.value.Id, 'B');
assert.equal(state.playbackPlaying.value, true);
assert.equal(state.playbackError.value, null);

// Relative commands reserve their selections before awaiting native work.
await reset();
await controls.handleNext({ type: 'click' });
assert.equal(state.playbackCurrentTrack.value.Id, 'B', 'UI events are not command tokens');
await reset();
const delayedB = deferred();
playBehavior = payload => payload.title === 'B' ? delayedB.promise : Promise.resolve();
const nextOne = controls.handleNext();
const nextTwo = controls.handleNext();
delayedB.resolve();
await Promise.all([nextOne, nextTwo]);
assert.deepEqual(played(), ['B', 'C']);
assert.equal(state.currentIndex.value, 2);

await reset();
queued.forEach(track => controls.addToQueue(track));
const delayedQueue = deferred();
playBehavior = payload => payload.title === 'Q1' ? delayedQueue.promise : Promise.resolve();
const queueNextOne = controls.handleNext();
const queueNextTwo = controls.handleNext();
delayedQueue.resolve();
await Promise.all([queueNextOne, queueNextTwo]);
assert.deepEqual(played(), ['Q1', 'Q2']);
assert.equal(state.queue.value.length, 0);
assert.equal(state.resumeAfterQueue.value.index, 0);

// Shuffle must use the restored source list after the inserted queue drains.
state.shuffleOn.value = true;
const originalRandom = Math.random;
try {
  Math.random = () => 0.5;
  await controls.handleNext();
} finally { Math.random = originalRandom; }
assert.equal(state.currentTracks.value, tracks);
assert.equal(state.playbackCurrentTrack.value.Id, 'B');
assert.equal(state.resumeAfterQueue.value, null);
assert.deepEqual(state.playHistory.value, [0]);
await controls.handlePrev();
assert.equal(state.playbackCurrentTrack.value.Id, 'A');

// A queued start failure is handled, not a reason to skip to another track.
await reset();
controls.addToQueue(queued[0]);
playBehavior = async () => { throw new Error('queued start failed'); };
await controls.handleNext();
assert.deepEqual(played(), ['Q1']);
assert.equal(state.playbackCurrentTrack.value.Id, 'Q1');
assert.ok(state.playbackError.value);

// A direct sleep pause also invalidates pending quality/retry continuations.
await reset();
const sleepLookup = deferred();
cacheBehavior = () => sleepLookup.promise;
const beforeSleep = controls.toggleQuality();
await audioShim.pause();
sleepLookup.resolve({ cached: false });
assert.equal(await beforeSleep, false);
assert.equal(state.playbackPlaying.value, false);
assert.deepEqual(played(), []);

// Queue-end sleep still takes precedence over restoring/shuffling the source.
await reset();
state.shuffleOn.value = true;
state.sleepMode.value = 'queue';
controls.addToQueue(queued[0]);
await controls.handleNext();
const beforeEnd = played().length;
await controls.handleTrackEnd();
assert.equal(played().length, beforeEnd);
assert.equal(state.playbackPlaying.value, false);
assert.equal(state.sleepMode.value, null);

// Every transport rejection is contained, and late failures cannot affect B.
for (const method of ['pause', 'resume', 'seek']) {
  await reset();
  if (method === 'resume') await audioShim.pause();
  const late = deferred();
  if (method === 'pause') pauseBehavior = () => late.promise;
  if (method === 'resume') resumeBehavior = () => late.promise;
  if (method === 'seek') seekBehavior = () => late.promise;
  const old = method === 'seek' ? audioShim.seek(25) : audioShim[method]();
  await controls.playTrack(tracks[1]);
  late.reject(new Error(`old ${method} failed`));
  assert.equal(await old, false);
  assert.equal(state.playbackCurrentTrack.value.Id, 'B');
  assert.equal(state.playbackPlaying.value, true);
  assert.equal(state.playbackError.value, null);

  await reset();
  if (method === 'resume') await audioShim.pause();
  const failure = async () => { throw new Error(`current ${method} failed`); };
  if (method === 'pause') pauseBehavior = failure;
  if (method === 'resume') resumeBehavior = failure;
  if (method === 'seek') seekBehavior = failure;
  assert.equal(await (method === 'seek' ? audioShim.seek(25) : audioShim[method]()), false);
  assert.ok(state.playbackError.value);
}

await reset();
const sameTrackStart = deferred();
let attempt = 0;
playBehavior = () => ++attempt === 1 ? sameTrackStart.promise : Promise.resolve();
const firstA = controls.playTrack(tracks[0]);
await controls.playTrack(tracks[0]);
sameTrackStart.reject(new Error('older instance of A failed'));
assert.equal(await firstA, false);
assert.equal(state.playbackPlaying.value, true);
assert.equal(state.playbackError.value, null);

await reset('low');
await audioShim.pause();
const pausedQualityStart = deferred();
playBehavior = payload => payload.title === 'A' ? pausedQualityStart.promise : Promise.resolve();
const pausedQuality = controls.toggleQuality();
await controls.playTrack(tracks[1]);
pausedQualityStart.resolve();
assert.equal(await pausedQuality, false);
assert.equal(state.playbackPlaying.value, true);
assert.equal(state.playbackCurrentTrack.value.Id, 'B');

await reset();
queued.forEach(track => controls.addToQueue(track));
const heldQueueStarts = deferred();
playBehavior = payload => payload.title.startsWith('Q') ? heldQueueStarts.promise : Promise.resolve();
const threeNext = [controls.handleNext(), controls.handleNext(), controls.handleNext()];
heldQueueStarts.resolve();
await Promise.all(threeNext);
assert.deepEqual(played(), ['Q1', 'Q2', 'B']);
assert.equal(state.currentTracks.value, tracks);
assert.equal(state.resumeAfterQueue.value, null);

console.log('playback ordering and queue regression tests passed');
