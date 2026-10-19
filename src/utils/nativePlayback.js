import { batch, signal } from '@preact/signals';
import {
  currentTracks, currentIndex, queue, shuffleOn, repeatMode, resumeAfterQueue,
  playbackCurrentTrack, playbackPosition, playbackDuration, setPlaybackState,
  sleepMode, sleepEndTime, sleepQueueDrained, sleepTimerId, sleepRefreshIntervalId,
  sleepDurationMinutes, albumGridFollowPlayback, albumGridFocusAlbumId,
  isTranslated, trackTranslationCache,
} from '../stores/state.js';
import { config, qualityPreset } from '../config.js';
import { getNativeBridge, initNativeBridge, addNativeListener } from './nativeBridge.js';
import { getTrackStreamUrl, getAlbumArtUrl } from './api.js';
import { artistText, translatedTrackText } from './metadata.js';
import { beginPlaybackCommand } from './playbackCommands.js';
import { isNativePlaybackSnapshot, isNativePlaybackPositionEvent, trackFromNativeSnapshot } from './nativePlaybackProtocol.js';

export const nativePlaybackReady = signal(false);
export const nativeDesiredPlaying = signal(false);
let initialization = null;
let refreshing = null;
let serial = Promise.resolve();
let revision = -1;
let requestId = -1;
let sessionId = null;
const retiredSessions = new Set();
const metadata = new Map();
let listenersAttached = false;
let submission = 0;
const pendingOptions = new Map();

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
export const getNativePlaybackRevision = () => revision;
export const isNativePlayback = () => nativePlaybackReady.value;

/** Authenticated URLs are command inputs only; never persist these in web storage.
 * @param {import('../types/contracts.js').Track} track
 * @returns {import('../types/contracts.js').NativePlaybackTrackInput}
 */
export function toNativeTrack(track) {
  const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
  metadata.set(track.Id, track);
  if (metadata.size > 20000) metadata.delete(metadata.keys().next().value);
  return {
    id: track.Id, title: display.title, artist: display.artist,
    originalTitle: track.Name || '', originalArtist: artistText(track, ''),
    albumTitle: track.Album || '', originalAlbumTitle: track.Album || '',
    albumId: track.AlbumId || '', durationMs: Math.max(0, finite(track.RunTimeTicks) / 10000),
    trackNumber: track.IndexNumber || 0, discNumber: track.ParentIndexNumber || 0,
    lowUrl: getTrackStreamUrl(track.Id, 'low', 0),
    highUrl: getTrackStreamUrl(track.Id, 'high', 0),
    artUrl: track.AlbumId ? getAlbumArtUrl(track.AlbumId, 400) : '',
  };
}

/** @param {import('../types/contracts.js').NativePlaybackTrackSnapshot | null} wire */
function fromNativeTrack(wire) {
  if (!wire || typeof wire.id !== 'string' || !wire.id) return null;
  const known = metadata.get(wire.id);
  if (known) return known;
  const track = trackFromNativeSnapshot(wire);
  if (!track) return null;
  metadata.set(wire.id, track);
  if (metadata.size > 20000) metadata.delete(metadata.keys().next().value);
  return track;
}

/** Apply only monotonic events from the current service incarnation.
 * @param {import('../types/contracts.js').NativePlaybackSnapshot | import('../types/contracts.js').NativePlaybackPositionEvent} data
 */
export function applyNativePlaybackSnapshot(data, { full = true, authoritative = false } = {}) {
  if (!(full ? isNativePlaybackSnapshot(data) : isNativePlaybackPositionEvent(data)) || retiredSessions.has(data.sessionId)) return false;
  if (sessionId !== data.sessionId) {
    // Unsolicited events cannot switch service identity. Reconnect reads can.
    if (!authoritative || !full) return false;
    if (sessionId) retiredSessions.add(sessionId);
    sessionId = data.sessionId;
    revision = -1;
    requestId = -1;
  }
  if (data.revision < revision || data.eventRequestId < requestId) return false;
  if (!full && (data.revision !== revision || data.eventRequestId !== requestId)) return false;
  if (!full && data.currentTrackId !== (playbackCurrentTrack.value?.Id || null)) return false;
  revision = data.revision;
  requestId = data.eventRequestId;
  data = { ...data };
  for (const [field, pending] of pendingOptions) data[field] = pending.value;
  const duration = Math.max(0, finite(data.durationMs, playbackDuration.value * 1000)) / 1000;
  const position = Math.min(duration || Infinity, Math.max(0, finite(data.positionMs, playbackPosition.value * 1000)) / 1000);
  batch(() => {
    if (full) {
      const track = fromNativeTrack(data.currentTrack);
      currentTracks.value = data.sourceTracks.map(fromNativeTrack).filter(Boolean);
      currentIndex.value = Math.max(-1, Math.min(finite(data.index, -1), currentTracks.value.length - 1));
      queue.value = data.queue.map(fromNativeTrack).filter(Boolean).map(item => ({ track: item, albumId: item.AlbumId || null }));
      resumeAfterQueue.value = null;
      shuffleOn.value = data.shuffleOn === true;
      repeatMode.value = ['off', 'all', 'one'].includes(data.repeatMode) ? data.repeatMode : 'off';
      sleepMode.value = ['duration', 'track', 'queue'].includes(data.sleep?.mode) ? data.sleep.mode : null;
      sleepEndTime.value = data.sleep?.endTimeMs > 0 ? data.sleep.endTimeMs : null;
      sleepQueueDrained.value = data.sleep?.queueDrained === true;
      if (!sleepMode.value) sleepDurationMinutes.value = 0;
      setPlaybackState({ currentTrack: track, trackId: track?.Id || null });
      if (albumGridFollowPlayback.value && track) albumGridFocusAlbumId.value = track.AlbumId;
    }
    nativeDesiredPlaying.value = data.desiredPlaying === true;
    const quality = data.quality === 'high' ? 'high' : 'low';
    qualityPreset.value = quality;
    setPlaybackState({ position, duration, startOffset: 0, quality,
      playing: data.isPlaying === true, buffering: data.buffering === true && !data.isLocal,
      isLocal: data.isLocal === true,
      ...(full || data.isLocal === true || data.cached !== undefined ? { itemCached: data.isLocal === true || data.cached === true } : {}),
      // Native messages can contain platform details. Keep the user-facing surface fixed.
      ...(full || data.error !== undefined ? { error: data.error ? Object.assign(new Error('Playback stopped. Check the connection and retry.'), { code: 'native_playback' }) : null } : {}),
    });
  });
  return true;
}

export async function refreshNativePlayback() {
  if (!nativePlaybackReady.value) return false;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const snapshot = await getNativeBridge().getPlaybackSnapshot();
    if (!isNativePlaybackSnapshot(snapshot)) throw new Error('Android playback returned an incompatible state.');
    return applyNativePlaybackSnapshot(snapshot, { authoritative: true });
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function initNativePlayback() {
  if (initialization) return initialization;
  initialization = (async () => {
    const bridge = getNativeBridge() || initNativeBridge();
    if (typeof bridge?.getPlaybackSnapshot !== 'function') return false;
    // Capability negotiation is explicit. Transport failures must not switch an
    // active v2 service to the legacy JS queue owner.
    let initial;
    try { initial = await bridge.getPlaybackSnapshot(); }
    catch (error) {
      if (error?.code === 'UNIMPLEMENTED' || error?.code === 'UNAVAILABLE') return false;
      throw new Error('Could not reconnect to Android playback. Please retry.');
    }
    if (initial?.protocolVersion !== 2 || initial.supported !== true) return false;
    if (!listenersAttached) {
      const onSnapshot = data => {
        if (!nativePlaybackReady.value || retiredSessions.has(data?.sessionId)) return;
        if (data?.sessionId !== sessionId) {
          refreshNativePlayback().catch(() => {});
        } else applyNativePlaybackSnapshot(data);
      };
      await addNativeListener('playbackSnapshot', onSnapshot);
      await addNativeListener('playbackPosition', data => {
        if (!nativePlaybackReady.value || retiredSessions.has(data?.sessionId)) return;
        if (!applyNativePlaybackSnapshot(data, { full: false }) && isNativePlaybackPositionEvent(data)
          && (data.sessionId !== sessionId || data.revision > revision)) {
          refreshNativePlayback().catch(() => {});
        }
      });
      const reconnect = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refreshNativePlayback().catch(() => {});
      };
      globalThis.window?.addEventListener?.('pageshow', reconnect);
      globalThis.document?.addEventListener?.('visibilitychange', reconnect);
      listenersAttached = true;
    }
    const legacyQueue = [...queue.value];
    // Scope includes a one-way credential fingerprint: rotating credentials on
    // the same server must not resurrect a previously authenticated descriptor.
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.API_KEY));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    await bridge.configurePlayback({ scope: `${config.SERVER.replace(/\/+$/, '')}|${fingerprint}` });
    const snapshot = await bridge.getPlaybackSnapshot();
    if (!applyNativePlaybackSnapshot(snapshot, { authoritative: true })) throw new Error('Android playback returned an incompatible state.');
    if (snapshot.initialized === false && !snapshot.currentTrack && !snapshot.queue.length && !snapshot.sourceTracks.length && legacyQueue.length) {
      const migrated = await bridge.replaceQueue({ queue: legacyQueue.map(item => toNativeTrack({ ...item.track, AlbumId: item.albumId || item.track.AlbumId })), expectedRevision: revision });
      if (!applyNativePlaybackSnapshot(migrated, { authoritative: true })) throw new Error('Could not restore your saved queue.');
    }
    if (sleepTimerId.value) clearTimeout(sleepTimerId.value);
    if (sleepRefreshIntervalId.value) clearInterval(sleepRefreshIntervalId.value);
    sleepTimerId.value = null;
    sleepRefreshIntervalId.value = null;
    // Legacy web state is retired; native app-private state is now authoritative.
    try { localStorage.removeItem('crateSleepTimer'); localStorage.removeItem('crateQueue'); } catch (_) {}
    nativePlaybackReady.value = true;
    return true;
  })().catch(error => { initialization = null; throw error; });
  return initialization;
}

/** Serialize bridge submissions, not UI state guesses. Native events own state.
 * @param {string} method
 * @param {object} payload
 */
export function nativePlaybackCommand(method, payload = {}) {
  const submitted = ++submission;
  if (['playSelection', 'nextTrack', 'previousTrack', 'playQueueItem', 'seekAbsolute', 'retryPlayback', 'pause', 'resume'].includes(method)) beginPlaybackCommand();
  const optimistic = method === 'setPlaybackOptions' ? payload
    : method === 'pause' ? { desiredPlaying: false } : method === 'resume' ? { desiredPlaying: true } : {};
  for (const [field, value] of Object.entries(optimistic)) pendingOptions.set(field, { submitted, value });
  const clearPending = () => {
    for (const [field, pending] of pendingOptions) if (pending.submitted === submitted) pendingOptions.delete(field);
  };
  const run = async () => {
    try {
      const bridge = getNativeBridge();
      if (!nativePlaybackReady.value || typeof bridge?.[method] !== 'function') throw new Error('unavailable');
      const result = await bridge[method](payload);
      clearPending();
      if (result?.protocolVersion === 2) {
        if (!isNativePlaybackSnapshot(result)) throw new Error('Invalid playback acknowledgement');
        applyNativePlaybackSnapshot(result, { authoritative: true });
      }
      else await refreshNativePlayback();
      return true;
    } catch (_) {
      clearPending();
      // Recover the authoritative queue after rejected stale-index edits.
      try { await refreshNativePlayback(); } catch (_) {}
      if (submitted === submission) setPlaybackState({ error: Object.assign(new Error('The playback change could not be applied. Please try again.'), { code: 'native_command' }) });
      return false;
    }
  };
  const result = serial.then(run, run);
  serial = result.then(() => undefined);
  return result;
}

export function nativePlaySelection(tracks, index, queueMode = 'preserve') {
  return nativePlaybackCommand('playSelection', { tracks: tracks.map(toNativeTrack), index, queueMode });
}

export function nativeQueueChange(action, details = {}) {
  return nativePlaybackCommand('mutateQueue', {
    action, ...details,
    ...(action === 'add' ? {} : { expectedRevision: revision }),
  });
}
