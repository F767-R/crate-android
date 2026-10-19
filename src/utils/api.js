import { config } from '../config.js';
import { userId } from '../stores/state.js';
import { fetchLyricsFromMultipleSources } from './lyricsSources.js';
import { fetchWithTimeout, httpError } from './request.js';
import { createArtworkPool } from './artworkPool.js';

const API_HEADERS = {
  'Authorization': `MediaBrowser Client="${config.CLIENT_NAME}", Device="${config.DEVICE_ID}", DeviceId="${config.DEVICE_ID}", Version="${config.CLIENT_VERSION}"`,
  'Content-Type': 'application/json',
};

async function apiRequest(endpoint, options = {}) {
  const url = new URL(`${config.SERVER}${endpoint}`);
  url.searchParams.set('ApiKey', config.API_KEY);
  return fetchWithTimeout(url, {
    ...options,
    headers: { ...API_HEADERS, ...options.headers },
  }, {
    consume: response => {
      if (!response.ok) throw httpError(response.status);
      return response.json();
    },
  });
}

export async function getUserId(options = {}) {
  const data = await apiRequest('/Users', options);
  return data[0]?.Id;
}

export async function getMusicLibraryId(userId, options = {}) {
  const data = await apiRequest(`/Users/${userId}/Views`, options);
  const items = data.Items || data;
  return (Array.isArray(items) ? items : []).find(v => v.CollectionType === 'music')?.Id;
}

export async function getAlbums(userId, libraryId, parentId = null, options = {}) {
  const params = new URLSearchParams({
    ParentId: parentId || libraryId,
    IncludeItemTypes: 'MusicAlbum',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Recursive: 'true',
    Fields: 'PrimaryImageAspectRatio,MediaSourceCount',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`, options);
}

export async function getAlbumTracks(userId, albumId, options = {}) {
  const params = new URLSearchParams({
    ParentId: albumId,
    IncludeItemTypes: 'Audio',
    SortBy: 'ParentIndexNumber,IndexNumber',
    SortOrder: 'Ascending',
    Fields: 'MediaSources,RunTimeTicks,ParentIndexNumber,ArtistItems',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`, options);
}

export async function getAllTracks(userId, libraryId, options = {}) {
  const params = new URLSearchParams({
    ParentId: libraryId,
    IncludeItemTypes: 'Audio',
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'RunTimeTicks,Artists,ArtistItems,AlbumId,Album,ParentIndexNumber,IndexNumber',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`, options);
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
    ApiKey: config.API_KEY,
  });
  if (startOffsetSec > 0) {
    params.set('StartTimeTicks', String(Math.floor(startOffsetSec * 10000000)));
  }
  return `${config.SERVER}/Audio/${trackId}/universal?${params}`;
}

function imageUrl(itemId, maxWidth = 400) {
  return `${config.SERVER}/Items/${itemId}/Images/Primary?maxWidth=${maxWidth}&quality=90&ApiKey=${config.API_KEY}`;
}

const artworkPool = createArtworkPool({
  loadBlob: (descriptor, { signal }) => {
    const url = new URL(`${descriptor.server}/Items/${encodeURIComponent(descriptor.itemId)}/Images/Primary`);
    url.searchParams.set('maxWidth', descriptor.size === 'detail' ? '800' : '400');
    url.searchParams.set('quality', '90');
    url.searchParams.set('ApiKey', config.API_KEY);
    if (descriptor.imageTag) url.searchParams.set('tag', descriptor.imageTag);
    return fetchWithTimeout(url, { headers: API_HEADERS, signal }, {
      consume: response => {
        if (!response.ok) throw httpError(response.status);
        return response.blob();
      },
    });
  },
});

export function acquireArtwork(itemId, size = 'primary', imageTag = '') {
  return artworkPool.acquire({ server: config.SERVER, itemId, size, imageTag });
}

export function getAlbumArtUrl(albumId, maxWidth = 300) {
  return imageUrl(albumId, maxWidth);
}

export async function getArtistAlbums(userId, artistId, options = {}) {
  const params = new URLSearchParams({
    ArtistIds: artistId,
    IncludeItemTypes: 'MusicAlbum',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'PrimaryImageAspectRatio',
  });
  return apiRequest(`/Users/${userId}/Items?${params}`, options);
}

export async function getItemInfo(userId, itemId, options = {}) {
  return apiRequest(`/Users/${userId}/Items/${itemId}`, options);
}

function authenticatedUrl(path, params = {}) {
  const url = new URL(`${config.SERVER}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('ApiKey', config.API_KEY);
  return url.toString();
}

export async function getLyrics(requestUserId, trackId, { signal, source = 'auto', tag = '' } = {}) {
  const activeUserId = requestUserId || userId.value || '';
  return fetchLyricsFromMultipleSources({
    endpointUrl: authenticatedUrl(`/Audio/${trackId}/Lyrics`),
    originalAudioUrl: authenticatedUrl(`/Audio/${trackId}/stream`, {
      UserId: activeUserId,
      Static: true,
    }),
    transcodedFlacUrl: authenticatedUrl(`/Audio/${trackId}/universal`, {
      UserId: activeUserId,
      DeviceId: config.DEVICE_ID,
      Container: 'flac',
      AudioCodec: 'flac',
      TranscodingContainer: 'flac',
      TranscodingProtocol: 'http',
      MaxStreamingBitrate: 140000000,
    }),
    headers: API_HEADERS,
    signal,
    source,
    tag,
  });
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
