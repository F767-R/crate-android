/** @typedef {import('../types/contracts.js').Track} Track */
/** @typedef {import('../types/contracts.js').NativePlaybackTrackSnapshot} NativePlaybackTrackSnapshot */
/** @typedef {import('../types/contracts.js').NativePlaybackSnapshot} NativePlaybackSnapshot */
/** @typedef {import('../types/contracts.js').NativePlaybackPositionEvent} NativePlaybackPositionEvent */

export const MAX_NATIVE_PLAYBACK_ITEMS = 10000;
const privateTrackFields = ['lowUrl', 'highUrl', 'artUrl', 'url', 'ImageUrl'];
const optionalTextFields = ['originalTitle', 'originalArtist', 'albumTitle', 'originalAlbumTitle'];
const optionalIndexFields = ['trackNumber', 'discNumber'];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is number} */
function nonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** @param {unknown} value @returns {value is number} */
function counter(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** @param {unknown} value @returns {value is string} */
function identity(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** @param {Record<string, unknown>} value @param {string} key */
function optionalBoolean(value, key) {
  return value[key] === undefined || typeof value[key] === 'boolean';
}

/** @param {unknown} value */
function validError(value) {
  return value === null || typeof value === 'string'
    || (isRecord(value) && typeof value.message === 'string'
      && (value.code === undefined || typeof value.code === 'string'));
}

/** @param {unknown} value @returns {value is NativePlaybackTrackSnapshot} */
export function isNativePlaybackTrackSnapshot(value) {
  if (!isRecord(value) || !identity(value.id) || typeof value.title !== 'string'
      || typeof value.artist !== 'string'
      || (value.albumId !== null && typeof value.albumId !== 'string')
      || !nonNegative(value.durationMs)
      // Reconstruction converts milliseconds to Jellyfin ticks without overflow.
      || value.durationMs > Number.MAX_SAFE_INTEGER / 10000) return false;
  if (privateTrackFields.some(key => key in value)) return false;
  if (optionalTextFields.some(key => value[key] !== undefined && typeof value[key] !== 'string')) return false;
  return optionalIndexFields.every(key => value[key] === undefined || counter(value[key]));
}

/** @param {unknown} value @returns {value is NativePlaybackTrackSnapshot[]} */
function validTracks(value) {
  if (!Array.isArray(value) || value.length > MAX_NATIVE_PLAYBACK_ITEMS) return false;
  // for...of validates sparse entries too; Array.every would skip holes.
  for (const track of value) if (!isNativePlaybackTrackSnapshot(track)) return false;
  return true;
}

/** @param {Record<string, unknown>} value */
function validStatus(value) {
  return value.supported === true && value.protocolVersion === 2 && identity(value.sessionId)
    && counter(value.revision) && counter(value.eventRequestId)
    && nonNegative(value.positionMs) && nonNegative(value.durationMs)
    && typeof value.isPlaying === 'boolean' && typeof value.desiredPlaying === 'boolean'
    && typeof value.buffering === 'boolean' && typeof value.isLocal === 'boolean'
    && (value.quality === 'high' || value.quality === 'low') && optionalBoolean(value, 'cached');
}

/** Validate the complete v2 state before it changes any application signals.
 * @param {unknown} value
 * @returns {value is NativePlaybackSnapshot}
 */
export function isNativePlaybackSnapshot(value) {
  if (!isRecord(value) || !validStatus(value)
      || !optionalBoolean(value, 'initialized') || !optionalBoolean(value, 'restoredState')
      || (value.currentTrack !== null && !isNativePlaybackTrackSnapshot(value.currentTrack))
      || !validTracks(value.sourceTracks) || !validTracks(value.queue)
      || typeof value.index !== 'number' || !Number.isInteger(value.index)
      || value.index < -1 || value.index >= value.sourceTracks.length
      || typeof value.repeatMode !== 'string' || !['off', 'one', 'all'].includes(value.repeatMode)
      || typeof value.shuffleOn !== 'boolean'
      || !validError(value.error) || !isRecord(value.sleep)) return false;
  const sleep = value.sleep;
  return (sleep.mode === null || sleep.mode === 'duration' || sleep.mode === 'track' || sleep.mode === 'queue')
    && (sleep.endTimeMs === null || nonNegative(sleep.endTimeMs))
    && typeof sleep.queueDrained === 'boolean';
}

/** Validate a compact position event without requiring full queue/track arrays.
 * @param {unknown} value
 * @returns {value is NativePlaybackPositionEvent}
 */
export function isNativePlaybackPositionEvent(value) {
  return isRecord(value) && validStatus(value)
    && (value.currentTrackId === null || identity(value.currentTrackId))
    && (value.error === undefined || validError(value.error));
}

/** Reconstruct only original metadata, never private playback URLs.
 * Explicitly empty originals are preserved instead of being replaced by translations.
 * @param {unknown} value
 * @returns {Track | null}
 */
export function trackFromNativeSnapshot(value) {
  if (!isNativePlaybackTrackSnapshot(value)) return null;
  const originalArtist = value.originalArtist ?? value.artist;
  return {
    Id: value.id,
    Name: value.originalTitle ?? value.title,
    Artists: originalArtist ? [originalArtist] : [],
    AlbumId: value.albumId || null,
    Album: value.originalAlbumTitle ?? value.albumTitle ?? '',
    RunTimeTicks: value.durationMs * 10000,
    IndexNumber: value.trackNumber ?? 0,
    ParentIndexNumber: value.discNumber ?? 0,
  };
}
