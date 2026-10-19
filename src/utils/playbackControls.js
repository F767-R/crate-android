import {
  albumGridFocusAlbumId, albumGridFollowPlayback, currentTracks, currentViewState,
  playbackCurrentTrack, playbackPosition, repeatMode, shuffleOn,
} from '../stores/state.js';
import { qualityPreset } from '../config.js';
import { trackAlbumId } from './navigation.js';
import { audioShim } from './playerShim.js';
import {
  isNativePlayback, nativePlaybackCommand, nativePlaySelection, nativeQueueChange,
  toNativeTrack, nativeDesiredPlaying, getNativePlaybackRevision,
} from './nativePlayback.js';
import { downloadedOnly, libraryUsingSaved } from '../stores/offline.js';
import { downloadedIds, filterDownloadedTracks } from './downloads.js';
import * as legacy from './legacyPlayback.js';

// Choose at command time: Android may become ready after the UI mounts.
// The fallback owns its async ordering; nativePlayback owns bridge ordering.
function followAlbum(albumId) {
  const view = currentViewState.value;
  const follow = view.type !== 'album' || !albumId || view.albumId !== albumId;
  albumGridFollowPlayback.value = follow;
  albumGridFocusAlbumId.value = follow ? albumId : null;
}

function useDownloadedQuality(track) {
  if ((downloadedOnly.value || libraryUsingSaved.value) && downloadedIds.value.has(track?.Id) && qualityPreset.value !== 'low') {
    qualityPreset.value = 'low';
    if (isNativePlayback()) nativePlaybackCommand('setPlaybackOptions', { quality: 'low' });
  }
}

export async function playTrack(track) {
  if (!track?.Id) return false;
  useDownloadedQuality(track);
  currentTracks.value = filterDownloadedTracks(currentTracks.value);
  followAlbum(trackAlbumId(track));
  if (!isNativePlayback()) return legacy.playTrack(track);
  const tracks = currentTracks.value.some(item => item.Id === track.Id) ? currentTracks.value : [track];
  return nativePlaySelection(tracks, tracks.findIndex(item => item.Id === track.Id));
}

export async function playFromHere(tracks, startIndex, albumId = null) {
  if (!Array.isArray(tracks) || !tracks.length) return;
  if (downloadedOnly.value) { tracks = filterDownloadedTracks(tracks.slice(Math.max(0, startIndex))); startIndex = 0; }
  if (!tracks.length) return;
  const index = Math.max(0, Math.min(startIndex, tracks.length - 1));
  useDownloadedQuality(tracks[index]);
  followAlbum(albumId || trackAlbumId(tracks[index]));
  if (!isNativePlayback()) return legacy.playFromHere(tracks, index, albumId);
  return nativePlaySelection(tracks.map(item => ({
    ...item, AlbumId: albumId || item.AlbumId || tracks[index].AlbumId,
  })), index, 'replace-tail');
}

export function addToQueue(track, albumId = null, position = 'last') {
  if (!track?.Id) return;
  return isNativePlayback()
    ? nativeQueueChange('add', { track: toNativeTrack({ ...track, AlbumId: albumId || track.AlbumId }), position })
    : legacy.addToQueue(track, albumId, position);
}

export function playNextInQueue(track, albumId = null) {
  return addToQueue(track, albumId, 'next');
}

export async function playNextFromQueue(index = 0) {
  return isNativePlayback()
    ? nativePlaybackCommand('playQueueItem', { index, expectedRevision: getNativePlaybackRevision() })
    : legacy.playNextFromQueue(index);
}

export function handleNext() {
  return isNativePlayback() ? nativePlaybackCommand('nextTrack') : legacy.handleNext();
}

export async function handlePrev() {
  return isNativePlayback() ? nativePlaybackCommand('previousTrack') : legacy.handlePrev();
}

export async function handleTrackEnd() {
  if (!isNativePlayback()) return legacy.handleTrackEnd(); // Android advances without the WebView.
}

export async function retryPlayback() {
  return isNativePlayback() ? nativePlaybackCommand('retryPlayback') : legacy.retryPlayback();
}

export async function seekTo(seconds, forcePlay) {
  return isNativePlayback()
    ? nativePlaybackCommand('seekAbsolute', {
      positionMs: Math.round(Math.max(0, Number(seconds) || 0) * 1000),
      playWhenReady: forcePlay ?? nativeDesiredPlaying.value,
    })
    : legacy.seekTo(seconds, forcePlay);
}

export async function toggleQuality() {
  // Publish the preference before a pending cache lookup or another tap.
  const quality = qualityPreset.value === 'high' ? 'low' : 'high';
  qualityPreset.value = quality;
  return isNativePlayback()
    ? nativePlaybackCommand('setPlaybackOptions', { quality })
    : legacy.changeQuality(quality);
}

export async function togglePlayPause() {
  if (!playbackCurrentTrack.value) return;
  if (!isNativePlayback()) return legacy.togglePlayPause();
  nativeDesiredPlaying.value = !nativeDesiredPlaying.value;
  return nativePlaybackCommand(nativeDesiredPlaying.value ? 'resume' : 'pause');
}

export async function setPlaying(playing) {
  if (!playbackCurrentTrack.value) return;
  if (!isNativePlayback()) return legacy.setPlaying(playing);
  nativeDesiredPlaying.value = playing;
  return nativePlaybackCommand(playing ? 'resume' : 'pause');
}

export function toggleShuffle() {
  shuffleOn.value = !shuffleOn.value;
  if (isNativePlayback()) return nativePlaybackCommand('setPlaybackOptions', { shuffleOn: shuffleOn.value });
}

export function toggleRepeat() {
  const modes = ['off', 'all', 'one'];
  repeatMode.value = modes[(modes.indexOf(repeatMode.value) + 1) % modes.length];
  if (isNativePlayback()) return nativePlaybackCommand('setPlaybackOptions', { repeatMode: repeatMode.value });
}

export function removeQueuedTrack(index, expectedRevision = getNativePlaybackRevision()) {
  return isNativePlayback()
    ? nativePlaybackCommand('mutateQueue', { action: 'remove', index, expectedRevision })
    : legacy.removeQueuedTrack(index);
}

export function clearQueuedTracks() {
  return isNativePlayback() ? nativeQueueChange('clear') : legacy.clearQueuedTracks();
}

export function moveQueuedTrack(index, toIndex, expectedRevision = getNativePlaybackRevision()) {
  return isNativePlayback()
    ? nativePlaybackCommand('mutateQueue', { action: 'move', index, toIndex, expectedRevision })
    : legacy.moveQueuedTrack(index, toIndex);
}

let listenersAttached = false;
export function attachPlaybackControlListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  audioShim.addEventListener('ended', () => { handleTrackEnd(); });
  audioShim.addEventListener('next', () => { handleNext(); });
  audioShim.addEventListener('previous', () => { handlePrev(); });
  audioShim.addEventListener('sessionseek', event => { seekTo(event.position, true); });
  legacy.attachPlaybackReporting();

  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const handlers = {
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    previoustrack: () => handlePrev(),
    nexttrack: () => handleNext(),
    seekbackward: details => seekTo(playbackPosition.value - (details.seekOffset || 10)),
    seekforward: details => seekTo(playbackPosition.value + (details.seekOffset || 10)),
    seekto: details => details.seekTime != null && seekTo(details.seekTime),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
  }
}
