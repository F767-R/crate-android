import { config } from '../config.js';
import { userId } from '../stores/state.js';

const API_HEADERS = {
  'X-Emby-Authorization': `MediaBrowser Client="${config.CLIENT_NAME}", Device="${config.DEVICE_ID}", DeviceId="${config.DEVICE_ID}", Version="${config.CLIENT_VERSION}"`,
  'Content-Type': 'application/json',
};

async function apiRequest(endpoint, options = {}) {
  const url = new URL(`${config.SERVER}${endpoint}`);
  url.searchParams.set('api_key', config.API_KEY);
  const response = await fetch(url, {
    ...options,
    headers: { ...API_HEADERS, ...options.headers },
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${endpoint}`);
  }
  return response.json();
}

export async function getUserId() {
  const data = await apiRequest('/Users');
  return data[0]?.Id;
}

export async function getMusicLibraryId(userId) {
  const data = await apiRequest(`/Users/${userId}/Views`);
  const items = data.Items || data;
  return (Array.isArray(items) ? items : []).find(v => v.CollectionType === 'music')?.Id;
}

export async function getAlbums(userId, libraryId, parentId = null) {
  const params = new URLSearchParams({
    ParentId: parentId || libraryId,
    IncludeItemTypes: 'MusicAlbum',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Recursive: 'true',
    Fields: 'PrimaryImageAspectRatio,MediaSourceCount',
    Limit: '500',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`);
}

export async function getAlbumTracks(userId, albumId) {
  const params = new URLSearchParams({
    ParentId: albumId,
    IncludeItemTypes: 'Audio',
    SortBy: 'ParentIndexNumber,IndexNumber',
    SortOrder: 'Ascending',
    Fields: 'MediaSources,RunTimeTicks,ParentIndexNumber,ArtistItems',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`);
}

export async function getAllTracks(userId, libraryId) {
  const params = new URLSearchParams({
    ParentId: libraryId,
    IncludeItemTypes: 'Audio',
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'RunTimeTicks,Artists,ArtistItems,AlbumId,Album,ParentIndexNumber,IndexNumber',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`);
}

let _playSessionCounter = 0;
function newPlaySessionId() {
  return `${Date.now()}-${(_playSessionCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getTrackStreamUrl(trackId, quality = 'low', startOffsetSec = 0) {
  const preset = config.QUALITY_PRESETS[quality];
  const params = new URLSearchParams({
    UserId: userId.value || '',
    DeviceId: config.DEVICE_ID,
    PlaySessionId: newPlaySessionId(),
    Container: preset.container,
    AudioCodec: preset.codec,
    TranscodingContainer: preset.transContainer,
    TranscodingProtocol: 'http',
    MaxStreamingBitrate: String(preset.bitrate),
    api_key: config.API_KEY,
  });
  if (startOffsetSec > 0) {
    params.set('StartTimeTicks', String(Math.floor(startOffsetSec * 10000000)));
  }
  return `${config.SERVER}/Audio/${trackId}/universal?${params}`;
}

function imageUrl(itemId, maxWidth = 400) {
  return `${config.SERVER}/Items/${itemId}/Images/Primary?maxWidth=${maxWidth}&quality=90&api_key=${config.API_KEY}`;
}

function detailImageUrl(itemId) {
  return imageUrl(itemId, 800);
}

const imageBlobCache = new Map();
const IMAGE_CACHE_MAX = 100;
const _inFlightImageFetches = new Map();

export function cachedImageUrl(itemId, size = 'primary') {
  const cacheKey = `${itemId}:${size}`;
  const cached = imageBlobCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  if (_inFlightImageFetches.has(cacheKey)) return _inFlightImageFetches.get(cacheKey);

  const url = size === 'detail' ? detailImageUrl(itemId) : imageUrl(itemId);
  const promise = (async () => {
    try {
      const res = await fetch(url, { headers: API_HEADERS });
      if (!res.ok) return url;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      if (imageBlobCache.size >= IMAGE_CACHE_MAX) {
        const oldestKey = imageBlobCache.keys().next().value;
        const oldestUrl = imageBlobCache.get(oldestKey);
        URL.revokeObjectURL(oldestUrl);
        imageBlobCache.delete(oldestKey);
      }
      imageBlobCache.set(cacheKey, blobUrl);
      return blobUrl;
    } catch {
      return url;
    } finally {
      _inFlightImageFetches.delete(cacheKey);
    }
  })();
  _inFlightImageFetches.set(cacheKey, promise);
  return promise;
}

export function getAlbumArtUrl(albumId, maxWidth = 300) {
  return imageUrl(albumId, maxWidth);
}

export async function getArtistAlbums(userId, artistId) {
  const params = new URLSearchParams({
    ArtistIds: artistId,
    IncludeItemTypes: 'MusicAlbum',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'PrimaryImageAspectRatio',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`);
}

export async function searchItems(userId, query, limit = 50) {
  const params = new URLSearchParams({
    SearchTerm: query,
    IncludeItemTypes: 'MusicAlbum,MusicArtist,Audio',
    Limit: limit.toString(),
    Fields: 'PrimaryImageAspectRatio,MediaSourceCount,ArtistItems',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`);
}

export async function getItemInfo(userId, itemId) {
  return apiRequest(`/Users/${userId}/Items/${itemId}`);
}

export async function getLyrics(_userId, trackId) {
  try {
    const url = new URL(`${config.SERVER}/Items/${trackId}/Lyrics`);
    url.searchParams.set('api_key', config.API_KEY);
    const response = await fetch(url, { headers: API_HEADERS });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
      try { return JSON.parse(trimmed); } catch (_) {}
    }
    return text;
  } catch {
    return null;
  }
}

export function formatDuration(ticks) {
  if (!ticks) return '--:--';
  const seconds = Math.floor(ticks / 10000000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ticksToSec(ticks) { return ticks ? ticks / 10000000 : 0; }
