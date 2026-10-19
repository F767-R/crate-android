import assert from 'node:assert/strict';
import { createTranslationClient, translationScopeKey } from '../src/utils/translationClient.js';

function memoryStorage() {
  return {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
}

const baseContext = {
  endpoint: 'https://translation.example/translate',
  server: 'https://music.example',
  sourceLang: 'JA', targetLang: 'EN', glossaryId: 'music-labels',
};
const response = translations => ({ ok: true, json: async () => ({ translations: translations.map(text => ({ text })) }) });
const storage = memoryStorage();
let context = { ...baseContext };
let requests = 0;
let fail = true;
const client = createTranslationClient({
  getContext: () => context,
  storage,
  fetchImpl: async (_url, options) => {
    requests++;
    if (fail) return { ok: false, status: 500 };
    return response(JSON.parse(options.body).text.map(text => `English ${text}`));
  },
});

let result = await client.translateBatch([' Original ', 'Original', '']);
assert.equal(requests, 1);
assert.equal(result.complete, false);
assert.deepEqual(result.confirmed, [false, false, true]);
assert.equal(client.getCached('Original'), undefined, 'failed fallback originals must never enter the success cache');
assert.equal(storage.values.size, 0, 'failed fallback originals must not be persisted');
assert.equal(result.error.code, 'translation_http');
fail = false;
result = await client.translateBatch(['Original', '']);
assert.equal(requests, 2, 'retry must issue a new request after failure');
assert.deepEqual(result.values, ['English Original', '']);
assert.equal(result.complete, true);
await client.translateBatch(['Original']);
assert.equal(requests, 2, 'normal calls reuse confirmed successes');
await client.translateBatch(['Original'], { force: true });
assert.equal(requests, 3, 'force bypasses the success cache');

const reopened = createTranslationClient({
  getContext: () => context, storage,
  fetchImpl: () => { throw new Error('should not request persisted values'); },
});
result = await reopened.translateBatch(['Original']);
assert.equal(result.values[0], 'English Original');
assert.equal(result.complete, true, 'confirmed translations must survive client restart');

for (const field of ['endpoint', 'server', 'sourceLang', 'targetLang', 'glossaryId']) {
  context = { ...baseContext, [field]: `different-${field}` };
  assert.notEqual(translationScopeKey(context), translationScopeKey(baseContext));
  result = await client.translateBatch(['Original'], { cacheOnly: true, force: true });
  assert.equal(result.complete, false, `${field} changes must not reuse another scope's translations`);
}
context = baseContext;
const beforeCacheOnly = requests;
result = await client.translateBatch(['Original', 'Uncached'], { cacheOnly: true, force: true });
assert.equal(requests, beforeCacheOnly, 'saved-only mode must take precedence over force');
assert.deepEqual(result.confirmed, [true, false]);
assert.deepEqual(result.values, ['English Original', 'Uncached']);

const malformed = createTranslationClient({
  getContext: () => baseContext, storage: memoryStorage(),
  fetchImpl: async () => response(['Only one result']),
});
result = await malformed.translateBatch(['One', 'Two']);
assert.equal(result.error.code, 'translation_response');
assert.equal(malformed.getCached('One'), undefined, 'an incomplete response must not poison positional results');

const unchanged = createTranslationClient({
  getContext: () => baseContext, storage: memoryStorage(),
  fetchImpl: async () => response(['No change needed']),
});
result = await unchanged.translateBatch(['No change needed']);
assert.equal(result.complete, true, 'a confirmed unchanged translation is a legitimate success');

const fullStorageClient = createTranslationClient({
  getContext: () => baseContext,
  storage: { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } },
  fetchImpl: async () => response(['Still usable']),
});
result = await fullStorageClient.translateBatch(['Not saved']);
assert.equal(result.complete, true, 'a storage failure must not discard a successful translation');
assert.equal(result.values[0], 'Still usable');
assert.equal(result.error, null);
assert.equal(result.persistenceWarning.code, 'translation_storage');
assert.equal(result.persistenceWarning.retryable, false);
const unsavedOverride = await fullStorageClient.saveOverride('Not saved', 'Correction');
assert.equal(fullStorageClient.getCached('Not saved'), 'Correction');
assert.equal(unsavedOverride.persistenceWarning.code, 'translation_storage', 'manual edit callers must know device persistence failed');

let timeoutSignal;
const timeoutClient = createTranslationClient({
  getContext: () => baseContext, storage: memoryStorage(), timeoutMs: 10,
  fetchImpl: (_url, options) => { timeoutSignal = options.signal; return new Promise(() => {}); },
});
result = await timeoutClient.translateBatch(['Timeout']);
assert.equal(result.error.code, 'translation_timeout');
assert.equal(timeoutSignal.aborted, true);
assert.equal(timeoutClient.getCached('Timeout'), undefined);

let finishOldRequest;
const editStorage = memoryStorage();
const edited = createTranslationClient({
  getContext: () => baseContext, storage: editStorage,
  fetchImpl: async (url, options) => {
    if (url.endsWith('/override')) {
      assert.equal(JSON.parse(options.body).original, 'Song');
      return { ok: true };
    }
    return new Promise(resolve => { finishOldRequest = resolve; });
  },
});
const oldRequest = edited.translateBatch(['Song']);
await edited.saveOverride('Song', 'My correction');
finishOldRequest(response(['Older translation']));
await oldRequest;
assert.equal(edited.getCached('Song'), 'My correction', 'an older request must not overwrite a manual correction');
const reopenedEdit = createTranslationClient({ getContext: () => baseContext, storage: editStorage });
assert.equal(reopenedEdit.getCached('Song'), 'My correction', 'manual overrides must be persisted');

// Whole-library orchestration: preserve the first chunk, retry only failed work,
// and keep the completion/busy/error signals honest.
globalThis.localStorage = memoryStorage();
globalThis.window = { Capacitor: { Plugins: {} } };
const state = await import('../src/stores/state.js');
const { translateAllMetadata, setTranslationCacheOnly, applySavedTranslationEdits } = await import('../src/utils/translationControls.js');
const { getCachedTranslation, getTranslationContext, getTranslationScope, saveTranslationOverride } = await import('../src/config.js');
state.allAlbums.value = [];
state.allTracks.value = Array.from({ length: 26 }, (_, index) => ({ Id: `track-${index}`, Name: `Title ${index}`, Artists: ['Artist'] }));
state.allTracksFetched.value = true;
let libraryRequests = 0;
let failRequest = 2;
globalThis.fetch = async (_url, options) => {
  libraryRequests++;
  const texts = JSON.parse(options.body).text;
  assert.ok(texts.length <= 50);
  if (libraryRequests === failRequest) return { ok: false, status: 456 };
  return response(texts.map(text => `Translated ${text}`));
};
const running = translateAllMetadata();
assert.equal(state.translationBusy.value, true);
assert.equal(await running, false);
assert.equal(state.translationBusy.value, false);
assert.equal(state.translationComplete.value, false);
assert.equal(state.translationError.value.code, 'translation_quota');
assert.equal(getCachedTranslation('Title 0'), 'Translated Title 0');
assert.equal(getCachedTranslation('Title 25'), undefined);
assert.equal(state.trackTranslationCache.value['track-0'].title, 'Translated Title 0');
assert.equal(libraryRequests, 2);
assert.equal(await translateAllMetadata(), true);
assert.equal(libraryRequests, 3, 'normal retry sends only the failed chunk');
assert.equal(state.translationComplete.value, true);
assert.equal(state.translationError.value, null);
failRequest = 5;
assert.equal(await translateAllMetadata({ force: true }), false);
assert.equal(libraryRequests, 5);
assert.equal(state.translationComplete.value, false, 'a failed force refresh must not mark the run complete');
assert.equal(state.trackTranslationCache.value['track-0'].title, 'Translated Title 0', 'failed refresh preserves prior confirmed results');
assert.equal(await translateAllMetadata(), true);
assert.equal(libraryRequests, 6, 'Retry after a failed force refresh must request only its unfinished items, not accept stale cache or repeat successful chunks');
state.allTracks.value = [...state.allTracks.value, { Id: 'missing', Name: 'Not saved', Artists: [] }];
setTranslationCacheOnly(true);
assert.equal(localStorage.getItem('crateTranslationCacheOnly'), 'true');
assert.equal(await translateAllMetadata({ force: true }), false);
assert.equal(libraryRequests, 6);
assert.equal(state.translationError.value.code, 'translation_cache_only');
assert.equal(state.translationError.value.retryable, false);
assert.equal(state.translationComplete.value, false);

const originalTrack = state.allTracks.value[0];
const differentTrack = state.allTracks.value[1];
const editSession = { track: originalTrack, context: getTranslationContext(), scope: getTranslationScope() };
state.playbackCurrentTrack.value = originalTrack;
let finishOverride;
globalThis.fetch = () => new Promise(resolve => { finishOverride = resolve; });
const saving = saveTranslationOverride(originalTrack.Name, 'My title', { context: editSession.context });
state.playbackCurrentTrack.value = differentTrack;
finishOverride({ ok: true });
await saving;
assert.equal(applySavedTranslationEdits(editSession, [{ kind: 'title', translated: 'My title' }]), true);
assert.equal(state.trackTranslationCache.value[originalTrack.Id].title, 'My title');
assert.equal(state.trackTranslationCache.value[differentTrack.Id].title, 'Translated Title 1', 'changing tracks during an override must not edit the new song');
assert.equal(getCachedTranslation(originalTrack.Name), 'My title');
assert.equal(applySavedTranslationEdits({ ...editSession, scope: 'different-server' }, [{ kind: 'title', translated: 'Wrong scope' }]), false);
assert.equal(state.trackTranslationCache.value[originalTrack.Id].title, 'My title');

state.allAlbums.value = [{ Id: 'metadata-album', Name: 'Title 1', AlbumArtist: 'Artist' }];
assert.equal(state.albumTranslationCache.value['metadata-album'].title, 'Translated Title 1');
state.allAlbums.value = [{ Id: 'metadata-album', Name: 'New album name', AlbumArtist: 'New album artist' }];
assert.equal(state.albumTranslationCache.value['metadata-album'], undefined, 'changed album metadata must not retain unrelated translations under the old ID');
state.allTracks.value = state.allTracks.value.map(track => track.Id === originalTrack.Id
  ? { ...track, Name: 'Renamed track', Artists: ['New track artist'] } : track);
assert.equal(state.trackTranslationCache.value[originalTrack.Id], undefined, 'changed track metadata must not retain unrelated translations under the old ID');

localStorage.setItem = () => { throw new Error('quota exceeded'); };
setTranslationCacheOnly(false);
globalThis.fetch = async (_url, options) => response(JSON.parse(options.body).text.map(text => `New translation ${text}`));
assert.equal(await translateAllMetadata(), true);
assert.equal(state.translationComplete.value, true);
assert.equal(state.translationError.value.code, 'translation_storage', 'the UI must warn about device persistence even though translations succeeded');
assert.equal(state.translationError.value.retryable, false);

console.log('translation smoke test passed');
