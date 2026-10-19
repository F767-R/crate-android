import { effect, untracked } from '@preact/signals';
import {
  allAlbums, allTracks, albumTranslationCache, trackTranslationCache, playbackCurrentTrack,
  isTranslated, translationComplete, translationBusy, translationError, translationCacheOnly,
} from '../stores/state.js';
import { getCachedTranslation, getTranslationContext, getTranslationPersistenceWarning, getTranslationScope, hasCachedTranslation, translateBatch } from '../config.js';
import { ensureAllTracksLoaded, getLibraryGeneration } from './libraryData.js';
import { artistText } from './metadata.js';
import { audioShim } from './playerShim.js';
import { safeTranslationError } from './translationClient.js';

let activeRun = null;
let refreshRetry = { scope: null, itemKeys: new Set() };
const itemKey = item => `${item.type}:${item.id}`;

function libraryItems(albums, tracks) {
  return [
    ...Array.from(new Map(albums.map(album => [album.Id, album])).values()).map(album => ({
      id: album.Id, type: 'album', title: album.Name || '', artist: album.AlbumArtist || '',
    })),
    ...Array.from(new Map(tracks.map(track => [track.Id, track])).values()).map(track => ({
      id: track.Id, type: 'track', title: track.Name || '', artist: artistText(track, ''),
    })),
  ];
}

function applySavedItems(items, context) {
  const albums = { ...albumTranslationCache.value };
  const tracks = { ...trackTranslationCache.value };
  let albumsChanged = false;
  let tracksChanged = false;
  for (const item of items) {
    const title = getCachedTranslation(item.title, context);
    const artist = getCachedTranslation(item.artist, context);
    const target = item.type === 'album' ? albums : tracks;
    if (title === undefined && artist === undefined) {
      if (target[item.id]) {
        delete target[item.id];
        if (item.type === 'album') albumsChanged = true;
        else tracksChanged = true;
      }
      continue;
    }
    const next = { title: title ?? item.title, artist: artist ?? item.artist };
    if (target[item.id]?.title === next.title && target[item.id]?.artist === next.artist) continue;
    target[item.id] = next;
    if (item.type === 'album') albumsChanged = true;
    else tracksChanged = true;
  }
  if (albumsChanged) albumTranslationCache.value = albums;
  if (tracksChanged) trackTranslationCache.value = tracks;
}

// Hydrate the display/search caches as library data arrives, without any network work.
effect(() => {
  const albums = allAlbums.value;
  const tracks = allTracks.value;
  untracked(() => {
    try { applySavedItems(libraryItems(albums, tracks), getTranslationContext()); } catch (_) {}
  });
});

export function refreshSavedTranslations() {
  applySavedItems(libraryItems(allAlbums.value, allTracks.value), getTranslationContext());
}

export function applySavedTranslationEdits(session, saved) {
  if (!saved.length || session.scope !== getTranslationScope()) return false;
  const editedTrack = session.track;
  const next = {
    title: editedTrack.Name || '',
    artist: artistText(editedTrack, ''),
    ...(trackTranslationCache.value[editedTrack.Id] || {}),
  };
  for (const field of saved) next[field.kind] = field.translated;
  trackTranslationCache.value = { ...trackTranslationCache.value, [editedTrack.Id]: next };
  refreshSavedTranslations();
  isTranslated.value = true;
  if (playbackCurrentTrack.value?.Id === editedTrack.Id) audioShim.updateMetadata();
  return true;
}

export function setTranslationCacheOnly(enabled) {
  translationCacheOnly.value = Boolean(enabled);
  try { localStorage.setItem('crateTranslationCacheOnly', String(Boolean(enabled))); } catch (_) {}
  translationComplete.value = false;
  translationError.value = null;
  // Changing request policy cancels the remaining intent to force-refresh labels.
  refreshRetry.itemKeys.clear();
}

export function translateAllMetadata({ force = false, cacheOnly = translationCacheOnly.value } = {}) {
  if (activeRun) return activeRun;
  translationBusy.value = true;
  translationError.value = null;
  translationComplete.value = false;
  activeRun = runTranslation(force, cacheOnly).finally(() => {
    translationBusy.value = false;
    activeRun = null;
  });
  return activeRun;
}

async function runTranslation(force, cacheOnly) {
  const libraryVersion = getLibraryGeneration();
  try {
    const scope = getTranslationScope();
    const context = getTranslationContext();
    const tracks = await ensureAllTracksLoaded();
    if (scope !== getTranslationScope() || libraryVersion !== getLibraryGeneration()) return false;
    const items = libraryItems(allAlbums.value, tracks);
    if (refreshRetry.scope !== scope) refreshRetry = { scope, itemKeys: new Set() };
    const refreshState = refreshRetry;
    const validKeys = new Set(items.map(itemKey));
    for (const key of refreshState.itemKeys) if (!validKeys.has(key)) refreshState.itemKeys.delete(key);
    if (force && !cacheOnly && !translationCacheOnly.value) refreshState.itemKeys = new Set(items.map(itemKey));
    applySavedItems(items, context);
    isTranslated.value = true;
    const pending = items.filter(item => refreshState.itemKeys.has(itemKey(item)) || !hasCachedTranslation(item.title, context) || !hasCachedTranslation(item.artist, context));
    let failure = null;
    // DeepL accepts at most 50 text values: title + artist for up to 25 items.
    for (let index = 0; index < pending.length; index += 25) {
      if (scope !== getTranslationScope() || libraryVersion !== getLibraryGeneration()) return false;
      const chunk = pending.slice(index, index + 25);
      const savedOnly = cacheOnly || translationCacheOnly.value;
      const result = await translateBatch(chunk.flatMap(item => [item.title, item.artist]), {
        force: chunk.some(item => refreshState.itemKeys.has(itemKey(item))),
        cacheOnly: savedOnly,
        context,
      });
      if (scope !== getTranslationScope() || libraryVersion !== getLibraryGeneration()) return false;
      applySavedItems(chunk, context);
      if (result.error) {
        failure = result.error;
        break; // Preserve earlier chunks without hammering an unavailable proxy/quota.
      }
      if (!savedOnly) chunk.forEach(item => refreshState.itemKeys.delete(itemKey(item)));
    }
    const complete = !failure && items.every(item => hasCachedTranslation(item.title, context) && hasCachedTranslation(item.artist, context));
    translationComplete.value = complete;
    translationError.value = failure || (complete ? getTranslationPersistenceWarning(context) : {
      message: 'Saved translations are shown, but some labels are not saved on this device. Turn off saved-only mode in Settings to request missing translations.',
      code: 'translation_cache_only',
      retryable: false,
    });
    audioShim.updateMetadata();
    return complete;
  } catch (error) {
    if (libraryVersion !== getLibraryGeneration()) return false;
    translationComplete.value = false;
    translationError.value = safeTranslationError(error);
    return false;
  }
}
