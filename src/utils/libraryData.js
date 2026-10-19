import { batch, effect, signal, untracked } from '@preact/signals';
import {
  allAlbums, allTracks, allTracksFetched, albumDetailCache, contextMenuTarget,
  musicLibraryId, userId, translationComplete,
} from '../stores/state.js';
import { config } from '../config.js';
import { getAlbums, getAllTracks, getAlbumTracks, getItemInfo } from './api.js';
import { createLibraryRequestOwner } from './libraryRequestOwner.js';
import { RequestError } from './request.js';
import { createLibraryStorage, libraryStorageKey, librarySnapshot, albumFromSnapshot } from './libraryStorage.js';
import { libraryUsingSaved, librarySavedAt, librarySaveError, libraryIndexing, libraryIndexError } from '../stores/offline.js';

const storage = createLibraryStorage();
let storageKey = null;
let storageConfig = null;
let saved = null;
let writes = Promise.resolve();
let restoration = 0;
let indexAttempt = 0;
const savedMatches = () => saved && storageConfig === JSON.stringify([config.SERVER, config.API_KEY])
  && saved.userId === userId.value && saved.libraryId === musicLibraryId.value;

function saveSnapshot() {
  if (!storageKey || storageConfig !== JSON.stringify([config.SERVER, config.API_KEY])) return;
  const previous = savedMatches() ? saved : null;
  saved = librarySnapshot({ version: 1, userId: userId.value, libraryId: musicLibraryId.value,
    albums: albumsFetched.value ? allAlbums.value : previous?.albums || [],
    tracks: allTracksFetched.value ? allTracks.value : previous?.tracks || [],
    tracksComplete: allTracksFetched.value || previous?.tracksComplete || false, savedAt: Date.now() });
  if (!saved) return;
  const snapshot = saved;
  const key = storageKey;
  writes = writes.catch(() => {}).then(() => storage.write(key, snapshot)).then(() => {
    if (saved === snapshot) { librarySavedAt.value = snapshot.savedAt; librarySaveError.value = false; }
  }).catch(() => { if (saved === snapshot) librarySaveError.value = true; });
}

async function withSaved(load, fallback, request, forceNetwork = false) {
  if (request.signal.aborted) throw new RequestError('aborted');
  if (!forceNetwork && libraryUsingSaved.value) {
    const value = savedMatches() ? fallback(saved) : null;
    if (value !== null) return { value, fromSaved: true };
  }
  try { return { value: await load(), fromSaved: false }; }
  catch (error) {
    if (request.signal.aborted || error?.code === 'aborted') throw error;
    // Authentication failures are shown, never disguised as a connection failure.
    if (error?.status === 401 || error?.status === 403) throw error;
    const value = savedMatches() ? fallback(saved) : null;
    if (value === null) throw error;
    return { value, fromSaved: true };
  }
}

function recordSource(fromSaved) {
  if (fromSaved) libraryUsingSaved.value = true;
  else saveSnapshot();
}

export const libraryGeneration = signal(0);
const albumsFetched = signal(false);

const owner = createLibraryRequestOwner({
  getContext: () => ({ server: config.SERVER, credential: config.API_KEY, userId: userId.value, libraryId: musicLibraryId.value }),
  onInvalidate: (generation, preserveData) => batch(() => {
    indexAttempt++;
    libraryIndexing.value = false;
    if (!preserveData) {
      allAlbums.value = [];
      allTracks.value = [];
    }
    allTracksFetched.value = false;
    albumsFetched.value = false;
    albumDetailCache.value = new Map();
    translationComplete.value = false;
    contextMenuTarget.value = null;
    libraryGeneration.value = generation;
  }),
});

// Account/library changes invalidate outstanding work as well as cached data.
effect(() => {
  userId.value;
  musicLibraryId.value;
  untracked(() => owner.syncScope());
});

function itemsFrom(data) {
  if (!Array.isArray(data?.Items)) throw new RequestError('invalid_response');
  return data.Items;
}

function cached(value, signal) {
  return signal?.aborted ? Promise.reject(new RequestError('aborted')) : Promise.resolve(value);
}

export function ensureAlbumsLoaded(options = {}) {
  owner.syncScope();
  if (albumsFetched.value) return cached(allAlbums.value, options.signal);
  return owner.run('albums', (context, request) => withSaved(
    async () => itemsFrom(await getAlbums(context.userId, context.libraryId, null, request)),
    snapshot => snapshot.albums, request, options.forceNetwork), result => {
    if (!result.fromSaved) libraryUsingSaved.value = false;
    allAlbums.value = result.value;
    albumsFetched.value = true;
    recordSource(result.fromSaved);
  }, options).then(result => result.value);
}

export function ensureAllTracksLoaded(options = {}) {
  owner.syncScope();
  if (allTracksFetched.value) return cached(allTracks.value, options.signal);
  return owner.run('tracks', (context, request) => withSaved(
    async () => itemsFrom(await getAllTracks(context.userId, context.libraryId, request)),
    snapshot => snapshot.tracksComplete ? snapshot.tracks : null, request, options.forceNetwork), result => {
    allTracks.value = result.value;
    allTracksFetched.value = true;
    recordSource(result.fromSaved);
  }, options).then(result => result.value);
}

export function ensureAlbumDetailLoaded(albumId, options = {}) {
  owner.syncScope();
  const detail = albumDetailCache.value.get(albumId);
  if (detail) return cached(detail, options.signal);
  return owner.run(`album:${albumId}`, (context, request) => withSaved(async () => {
    const [album, tracks] = await Promise.all([
      getItemInfo(context.userId, albumId, request), getAlbumTracks(context.userId, albumId, request),
    ]);
    if (!album?.Id || album.Id !== albumId) throw new RequestError('invalid_response');
    return { ...album, Items: itemsFrom(tracks) };
  }, snapshot => albumFromSnapshot(snapshot, albumId), request), result => {
    albumDetailCache.value = new Map(albumDetailCache.value).set(albumId, result.value);
    if (result.fromSaved) libraryUsingSaved.value = true;
  }, options).then(result => result.value);
}

export async function restoreSavedLibrary({ signal } = {}) {
  const attempt = ++restoration;
  const context = JSON.stringify([config.SERVER, config.API_KEY]);
  const current = () => !signal?.aborted && attempt === restoration
    && context === JSON.stringify([config.SERVER, config.API_KEY]);
  try {
    const key = await libraryStorageKey(config.SERVER, config.API_KEY);
    if (!current()) return false;
    if (storageConfig !== context) {
      saved = null;
      libraryUsingSaved.value = false;
      librarySavedAt.value = null;
    }
    storageConfig = context;
    storageKey = key;
    const snapshot = await storage.read(key);
    if (!current() || !snapshot) return false;
    saved = snapshot;
    batch(() => { userId.value = snapshot.userId; musicLibraryId.value = snapshot.libraryId; });
    owner.syncScope();
    batch(() => {
      allAlbums.value = snapshot.albums;
      allTracks.value = snapshot.tracks;
      albumsFetched.value = true;
      allTracksFetched.value = snapshot.tracksComplete;
      libraryUsingSaved.value = true;
      librarySavedAt.value = snapshot.savedAt;
      libraryIndexError.value = !snapshot.tracksComplete;
      librarySaveError.value = false;
    });
    return true;
  } catch (_) { if (current()) librarySaveError.value = true; return false; }
}

export async function syncLibraryIndex(options = {}) {
  owner.syncScope();
  const attempt = ++indexAttempt;
  libraryIndexing.value = true;
  try { await ensureAllTracksLoaded(options); if (attempt === indexAttempt) libraryIndexError.value = false; }
  catch (error) { if (attempt === indexAttempt && error?.code !== 'aborted') libraryIndexError.value = true; throw error; }
  finally { if (attempt === indexAttempt) libraryIndexing.value = false; }
}

export function savedArtistAlbums(artistId) {
  if (!savedMatches() || !saved.tracksComplete) return null;
  const ids = new Set(saved.tracks.filter(track => track.ArtistItems?.some(artist => artist.Id === artistId)).map(track => track.AlbumId));
  return saved.albums.filter(album => ids.has(album.Id) || album.AlbumArtists?.some(artist => artist.Id === artistId));
}

export function invalidateLibrary() {
  owner.syncScope();
  return owner.invalidate();
}

export function refreshLibrary(options = {}) {
  owner.syncScope();
  owner.invalidate(true);
  return ensureAlbumsLoaded({ ...options, forceNetwork: true });
}

export const getLibraryGeneration = () => owner.getGeneration();
