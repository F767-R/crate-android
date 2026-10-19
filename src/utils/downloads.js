import { computed, signal } from '@preact/signals';
import { allTracks, allAlbums, contextMenuTarget } from '../stores/state.js';
import { downloadedOnly } from '../stores/offline.js';
import { nativeGetDownloadedTracks, addNativeListener } from './nativeBridge.js';

export const downloadedIds = signal(new Set());
export const downloadsError = signal(false);
export const downloadsReady = signal(false);
let refreshing;
export function refreshDownloads() {
  if (refreshing) return refreshing;
  refreshing = nativeGetDownloadedTracks().then(result => {
    if (!Array.isArray(result?.itemIds)) throw new Error('invalid_downloads');
    downloadedIds.value = new Set(result.itemIds.filter(id => typeof id === 'string'));
    downloadsReady.value = true;
    downloadsError.value = false;
  }).catch(() => { downloadedIds.value = new Set(); downloadsError.value = true; downloadsReady.value = false; })
    .finally(() => { refreshing = null; });
  return refreshing;
}
export function attachDownloadListeners() {
  const handles = ['cacheReady', 'cacheChanged'].map(name => Promise.resolve(addNativeListener(name, refreshDownloads)).catch(() => null));
  const onVisible = () => { if (document.visibilityState !== 'hidden') refreshDownloads(); };
  window.addEventListener('pageshow', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  refreshDownloads();
  return () => {
    window.removeEventListener('pageshow', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
    for (const handle of handles) handle.then(listener => listener?.remove?.()).catch(() => {});
  };
}
export function filterDownloadedTracks(tracks) {
  return downloadedOnly.value ? tracks.filter(track => downloadedIds.value.has(track.Id)) : tracks;
}
export const visibleLibraryTracks = computed(() => filterDownloadedTracks(allTracks.value));
export const downloadedAlbumIds = computed(() => new Set(allTracks.value
  .filter(track => downloadedIds.value.has(track.Id)).map(track => track.AlbumId)));
export function filterDownloadedAlbums(albums) {
  return downloadedOnly.value ? albums.filter(album => downloadedAlbumIds.value.has(album.Id)) : albums;
}
export const visibleLibraryAlbums = computed(() => filterDownloadedAlbums(allAlbums.value));
export function setDownloadedOnly(value) {
  contextMenuTarget.value = null;
  downloadedOnly.value = value;
  refreshDownloads();
}
