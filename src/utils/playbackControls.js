import {
  PLAY_HISTORY_MAX,
  albumGridFocusAlbumId,
  albumGridFollowPlayback,
  currentIndex,
  currentTracks,
  currentViewState,
  playHistory,
  playbackCurrentTrack,
  playbackDuration,
  playbackItemCached,
  playbackIsLocal,
  playbackPlaying,
  playbackPosition,
  queue,
  repeatMode,
  resumeAfterQueue,
  saveQueue,
  setPlaybackState,
  shuffleOn,
  sleepDurationMinutes,
  sleepEndTime,
  sleepMode,
  sleepOriginalQueueLength,
  sleepQueueDrained,
  sleepRefreshIntervalId,
  sleepTimerId,
} from '../stores/state.js';
import { config, qualityPreset } from '../config.js';
import { getAlbumArtUrl, getTrackStreamUrl } from './api.js';
import { audioShim } from './playerShim.js';
import { trackAlbumId } from './navigation.js';
import { nativeIsCached } from './nativeBridge.js';

let listenersAttached = false;
let progressReportTimer = null;

function enrichTrack(track) {
  if (!track) return null;
  const ImageUrl = track.ImageUrl || (track.AlbumId ? getAlbumArtUrl(track.AlbumId, 300) : null);
  return { ...track, ImageUrl };
}

async function reportPlayback(kind, track = playbackCurrentTrack.value, position = playbackPosition.value, paused = false) {
  if (!track) return;
  const path = {
    Start: '/Sessions/Playing',
    Progress: '/Sessions/Playing/Progress',
    Stopped: '/Sessions/Playing/Stopped',
  }[kind];
  if (!path) return;

  try {
    await fetch(`${config.SERVER}${path}?api_key=${encodeURIComponent(config.API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ItemId: track.Id,
        PositionTicks: Math.floor(Math.max(0, position || 0) * 10000000),
        IsPaused: !!paused,
        PlayMethod: 'Transcode',
      }),
      keepalive: kind === 'Stopped',
    });
  } catch (_) {}
}

async function startTrack(track, { startOffset = 0, syncIndex = true, cachedHint = false } = {}) {
  if (!track?.Id) return;

  if (albumGridFollowPlayback.value) {
    albumGridFocusAlbumId.value = trackAlbumId(track);
  }

  const tracks = currentTracks.value || [];
  if (syncIndex) {
    const index = tracks.findIndex(item => item.Id === track.Id);
    if (index >= 0) currentIndex.value = index;
  }

  const enriched = enrichTrack(track);
  const duration = Math.max(0, (track.RunTimeTicks || 0) / 10000000);
  const offset = Math.max(0, Math.min(Number(startOffset) || 0, duration || Infinity));
  const url = getTrackStreamUrl(track.Id, qualityPreset.value, offset);

  setPlaybackState({
    trackId: track.Id,
    currentTrack: enriched,
    position: offset,
    duration,
    startOffset: offset,
    playing: false,
    isLocal: false,
    buffering: !cachedHint,
    itemCached: cachedHint,
    quality: qualityPreset.value,
    error: null,
  });
  audioShim.setSrc(url, enriched, { itemCached: cachedHint });
  await audioShim.play({
    url,
    startPositionMs: Math.round(offset * 1000),
    cache: qualityPreset.value === 'low',
    cached: cachedHint,
  });
  reportPlayback('Start', enriched, offset, false);
}

export async function playTrack(track) {
  const albumId = trackAlbumId(track);
  const view = currentViewState.value;
  const outsideTrackAlbum = view.type !== 'album' || !albumId || view.albumId !== albumId;
  albumGridFollowPlayback.value = outsideTrackAlbum;
  albumGridFocusAlbumId.value = outsideTrackAlbum ? albumId : null;
  resumeAfterQueue.value = null;
  playHistory.value = [];
  await startTrack(track);
}

export function addToQueue(track, albumId = null, position = 'last') {
  if (!track?.Id) return;
  const item = { track, albumId: albumId || track.AlbumId || null };
  queue.value = position === 'next'
    ? [item, ...queue.value]
    : [...queue.value, item];
  sleepQueueDrained.value = false;
  saveQueue();
}

export function playNextInQueue(track, albumId = null) {
  addToQueue(track, albumId, 'next');
}

export async function playNextFromQueue(index = 0) {
  if (!queue.value.length) return false;
  const nextQueue = [...queue.value];
  const safeIndex = Math.max(0, Math.min(index, nextQueue.length - 1));
  const [item] = nextQueue.splice(safeIndex, 1);
  if (!item?.track) return false;

  if (!resumeAfterQueue.value) {
    resumeAfterQueue.value = {
      tracks: currentTracks.value,
      index: currentIndex.value,
    };
  }

  queue.value = nextQueue;
  if (sleepMode.value === 'queue' && nextQueue.length === 0) {
    sleepQueueDrained.value = true;
  }
  saveQueue();
  currentTracks.value = [item.track];
  currentIndex.value = 0;
  albumGridFollowPlayback.value = true;
  albumGridFocusAlbumId.value = trackAlbumId(item.track);
  await startTrack(item.track);
  return true;
}

export async function playFromHere(tracks, startIndex, albumId = null) {
  if (!Array.isArray(tracks) || !tracks.length) return;
  const index = Math.max(0, Math.min(startIndex, tracks.length - 1));
  const track = tracks[index];

  const resolvedAlbumId = albumId || trackAlbumId(track);
  const view = currentViewState.value;
  const outsideTrackAlbum = view.type !== 'album' || !resolvedAlbumId || view.albumId !== resolvedAlbumId;
  albumGridFollowPlayback.value = outsideTrackAlbum;
  albumGridFocusAlbumId.value = outsideTrackAlbum ? resolvedAlbumId : null;

  currentTracks.value = tracks;
  // The visible queue owns the continuation. Park the source list at
  // its end so those tracks are not replayed after the queue drains.
  currentIndex.value = tracks.length - 1;
  resumeAfterQueue.value = null;
  playHistory.value = [];
  queue.value = tracks.slice(index + 1).map(item => ({
    track: item,
    albumId: albumId || item.AlbumId || track.AlbumId || null,
  }));
  sleepQueueDrained.value = sleepMode.value === 'queue' && queue.value.length === 0;
  saveQueue();
  await startTrack(track, { syncIndex: false });
}

export async function handleNext() {
  if (await playNextFromQueue()) return;

  let tracks = currentTracks.value || [];
  let index = currentIndex.value;
  if (!tracks.length) return;

  if (shuffleOn.value) {
    if (tracks.length <= 1) return;
    if (index >= 0) {
      const history = [...playHistory.value, index];
      playHistory.value = history.slice(-PLAY_HISTORY_MAX);
    }
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * tracks.length);
    } while (nextIndex === index);
    currentIndex.value = nextIndex;
    await startTrack(tracks[nextIndex]);
    return;
  }

  if (resumeAfterQueue.value) {
    const resume = resumeAfterQueue.value;
    resumeAfterQueue.value = null;
    tracks = resume.tracks || [];
    index = resume.index;
    currentTracks.value = tracks;
    currentIndex.value = index;
  }

  if (index < tracks.length - 1) {
    currentIndex.value = index + 1;
    await startTrack(tracks[index + 1]);
  } else if (repeatMode.value === 'all' && tracks.length) {
    currentIndex.value = 0;
    await startTrack(tracks[0]);
  }
}

function clearSleepTimerState() {
  if (sleepTimerId.value) clearTimeout(sleepTimerId.value);
  if (sleepRefreshIntervalId.value) clearInterval(sleepRefreshIntervalId.value);
  sleepTimerId.value = null;
  sleepRefreshIntervalId.value = null;
  sleepEndTime.value = null;
  sleepMode.value = null;
  sleepDurationMinutes.value = 0;
  sleepOriginalQueueLength.value = 0;
  sleepQueueDrained.value = false;
  try { localStorage.removeItem('crateSleepTimer'); } catch (_) {}
}

export async function handleTrackEnd() {
  if (sleepMode.value === 'track' || (sleepMode.value === 'queue' && sleepQueueDrained.value)) {
    clearSleepTimerState();
    setPlaybackState({ playing: false });
    await audioShim.pause();
    return;
  }
  if (repeatMode.value === 'one' && playbackCurrentTrack.value) {
    await startTrack(playbackCurrentTrack.value, { startOffset: 0, syncIndex: false });
    return;
  }
  await handleNext();
}

export async function handlePrev() {
  const tracks = currentTracks.value || [];
  if (!tracks.length || !playbackCurrentTrack.value) return;

  if (shuffleOn.value) {
    const history = [...playHistory.value];
    if (history.length) {
      const previousIndex = history.pop();
      playHistory.value = history;
      currentIndex.value = previousIndex;
      await startTrack(tracks[previousIndex]);
    } else {
      await seekTo(0);
    }
    return;
  }

  if (playbackPosition.value > 3) {
    await seekTo(0);
    return;
  }

  if (currentIndex.value > 0) {
    currentIndex.value--;
    await startTrack(tracks[currentIndex.value]);
  } else if (repeatMode.value === 'all') {
    currentIndex.value = tracks.length - 1;
    await startTrack(tracks[currentIndex.value]);
  } else {
    await seekTo(0);
  }
}

export async function seekTo(seconds, forcePlay = playbackPlaying.value) {
  const track = playbackCurrentTrack.value;
  if (!track) return;
  const duration = playbackDuration.value || (track.RunTimeTicks || 0) / 10000000;
  const target = Math.max(0, Math.min(Number(seconds) || 0, duration || Infinity));

  if (playbackIsLocal.value || qualityPreset.value === 'high') {
    await audioShim.seek(target);
    if (forcePlay && audioShim.paused) await audioShim.resume();
  } else {
    await startTrack(track, { startOffset: target, syncIndex: false });
    if (!forcePlay) await audioShim.pause();
  }
  reportPlayback('Progress', track, target, !forcePlay);
}

export async function toggleQuality() {
  const track = playbackCurrentTrack.value;
  const nextQuality = qualityPreset.value === 'high' ? 'low' : 'high';
  const position = playbackPosition.value;
  const cachedHint = nextQuality === 'low' && track
    ? (playbackItemCached.value || await nativeIsCached(track.Id))
    : false;
  qualityPreset.value = nextQuality;
  if (!track) return;
  const wasPlaying = playbackPlaying.value;
  await startTrack(track, { startOffset: position, syncIndex: false, cachedHint });
  if (!wasPlaying) await audioShim.pause();
}

export async function togglePlayPause() {
  if (!playbackCurrentTrack.value) return;
  if (playbackPlaying.value) await audioShim.pause();
  else await audioShim.resume();
}

function setupBrowserMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const handlers = {
    play: () => togglePlayPause(),
    pause: () => togglePlayPause(),
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

export function attachPlaybackControlListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  audioShim.addEventListener('ended', () => { handleTrackEnd(); });
  audioShim.addEventListener('next', () => { handleNext(); });
  audioShim.addEventListener('previous', () => { handlePrev(); });
  audioShim.addEventListener('sessionseek', event => { seekTo(event.position, true); });
  audioShim.addEventListener('play', () => {
    clearInterval(progressReportTimer);
    progressReportTimer = setInterval(() => {
      reportPlayback('Progress', playbackCurrentTrack.value, playbackPosition.value, false);
    }, 15000);
  });
  audioShim.addEventListener('pause', () => {
    clearInterval(progressReportTimer);
    reportPlayback('Progress', playbackCurrentTrack.value, playbackPosition.value, true);
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      reportPlayback('Stopped', playbackCurrentTrack.value, playbackPosition.value, true);
    });
  }
  setupBrowserMediaSession();
}
