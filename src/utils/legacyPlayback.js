// Compatibility playback for bridges without the Android session protocol.
// Components use playbackControls.js; Android owns the queue and timeline on v2.
import {
  PLAY_HISTORY_MAX,
  albumGridFocusAlbumId,
  albumGridFollowPlayback,
  currentIndex,
  currentTracks,
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
import { fetchWithTimeout } from './request.js';
import { beginPlaybackCommand, isPlaybackCommandCurrent } from './playbackCommands.js';
import { isNativePlayback } from './nativePlayback.js';

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
    await fetchWithTimeout(`${config.SERVER}${path}?ApiKey=${encodeURIComponent(config.API_KEY)}`, {
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

async function startTrack(track, {
  startOffset = 0, syncIndex = true, cachedHint = false, bypassCache = false,
  command = beginPlaybackCommand(), quality = qualityPreset.value,
} = {}) {
  if (!track?.Id || !isPlaybackCommandCurrent(command)) return false;

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
  const url = getTrackStreamUrl(track.Id, quality, offset);

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
    quality,
    error: null,
  });
  audioShim.setSrc(url, enriched, { itemCached: cachedHint });
  try {
    const started = await audioShim.play({
      command,
      url,
      startPositionMs: Math.round(offset * 1000),
      cache: quality === 'low',
      bypassCache,
      cached: cachedHint,
    });
    if (!started || !isPlaybackCommandCurrent(command)) return false;
  } catch (_) {
    // The shim publishes the failure for RecoveryBanner. Avoid an unhandled
    // promise from tap/headset handlers and never report a failed start.
    return false;
  }
  reportPlayback('Start', enriched, offset, false);
  return true;
}

export async function retryPlayback() {
  const track = playbackCurrentTrack.value;
  if (!track?.Id) return false;
  const command = beginPlaybackCommand();
  const quality = qualityPreset.value;
  const position = playbackPosition.value;
  // A corrupt local copy must not trap Retry in the same decoder failure.
  const bypassCache = playbackIsLocal.value;
  const cachedHint = !bypassCache && quality === 'low' && await nativeIsCached(track.Id);
  if (!isPlaybackCommandCurrent(command)) return false;
  return startTrack(track, { startOffset: position, syncIndex: false, cachedHint, bypassCache, command, quality });
}

export async function playTrack(track) {
  if (!track?.Id) return false;
  const command = beginPlaybackCommand();
  resumeAfterQueue.value = null;
  playHistory.value = [];
  return startTrack(track, { command });
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

export async function playNextFromQueue(index = 0, command = beginPlaybackCommand()) {
  if (!queue.value.length || !isPlaybackCommandCurrent(command)) return false;
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
  await startTrack(item.track, { command });
  return true;
}

export async function playFromHere(tracks, startIndex, albumId = null) {
  if (!Array.isArray(tracks) || !tracks.length) return;
  const command = beginPlaybackCommand();
  const index = Math.max(0, Math.min(startIndex, tracks.length - 1));
  const track = tracks[index];


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
  return startTrack(track, { syncIndex: false, command });
}

export function handleNext() {
  return nextTrack(beginPlaybackCommand());
}

async function nextTrack(command) {
  // Reserve relative selections synchronously: two quick Next taps should
  // advance twice, not both inspect the same pre-await source index.
  if (queue.value.length) {
    await playNextFromQueue(0, command);
    return;
  }
  if (!isPlaybackCommandCurrent(command)) return;

  let tracks = currentTracks.value || [];
  let index = currentIndex.value;
  // A queued item temporarily becomes the source list. Restore the original
  // list before shuffle checks its size or chooses its next index.
  if (resumeAfterQueue.value) {
    const resume = resumeAfterQueue.value;
    resumeAfterQueue.value = null;
    tracks = resume.tracks || [];
    index = resume.index;
    currentTracks.value = tracks;
    currentIndex.value = index;
  }
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
    await startTrack(tracks[nextIndex], { command });
    return;
  }

  if (index < tracks.length - 1) {
    currentIndex.value = index + 1;
    await startTrack(tracks[index + 1], { command });
  } else if (repeatMode.value === 'all' && tracks.length) {
    currentIndex.value = 0;
    await startTrack(tracks[0], { command });
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
  const command = beginPlaybackCommand();
  if (sleepMode.value === 'track' || (sleepMode.value === 'queue' && sleepQueueDrained.value)) {
    clearSleepTimerState();
    setPlaybackState({ playing: false });
    await audioShim.pause({ command });
    return;
  }
  if (repeatMode.value === 'one' && playbackCurrentTrack.value) {
    await startTrack(playbackCurrentTrack.value, { startOffset: 0, syncIndex: false, command });
    return;
  }
  await nextTrack(command);
}

export async function handlePrev() {
  const tracks = currentTracks.value || [];
  if (!tracks.length || !playbackCurrentTrack.value) return;
  const command = beginPlaybackCommand();

  if (shuffleOn.value) {
    const history = [...playHistory.value];
    if (history.length) {
      const previousIndex = history.pop();
      playHistory.value = history;
      currentIndex.value = previousIndex;
      await startTrack(tracks[previousIndex], { command });
    } else {
      await seekTo(0, playbackPlaying.value, command);
    }
    return;
  }

  if (playbackPosition.value > 3) {
    await seekTo(0, playbackPlaying.value, command);
    return;
  }

  if (currentIndex.value > 0) {
    currentIndex.value--;
    await startTrack(tracks[currentIndex.value], { command });
  } else if (repeatMode.value === 'all') {
    currentIndex.value = tracks.length - 1;
    await startTrack(tracks[currentIndex.value], { command });
  } else {
    await seekTo(0, playbackPlaying.value, command);
  }
}

export async function seekTo(seconds, forcePlay = playbackPlaying.value, command = beginPlaybackCommand()) {
  const track = playbackCurrentTrack.value;
  if (!track || !isPlaybackCommandCurrent(command)) return false;
  const duration = playbackDuration.value || (track.RunTimeTicks || 0) / 10000000;
  const target = Math.max(0, Math.min(Number(seconds) || 0, duration || Infinity));

  if (playbackIsLocal.value || qualityPreset.value === 'high') {
    if (!await audioShim.seek(target, { command }) || !isPlaybackCommandCurrent(command)) return false;
    if (forcePlay && audioShim.paused && !await audioShim.resume({ command })) return false;
  } else {
    if (!await startTrack(track, { startOffset: target, syncIndex: false, command })) return false;
    if (!isPlaybackCommandCurrent(command)) return false;
    if (!forcePlay && !await audioShim.pause({ command })) return false;
  }
  if (!isPlaybackCommandCurrent(command)) return false;
  reportPlayback('Progress', track, target, !forcePlay);
  return true;
}

export async function changeQuality(nextQuality) {
  const command = beginPlaybackCommand();
  const track = playbackCurrentTrack.value;
  const position = playbackPosition.value;
  const wasPlaying = playbackPlaying.value;
  const cachedHint = nextQuality === 'low' && track
    ? (playbackItemCached.value || await nativeIsCached(track.Id))
    : false;
  if (!track || !isPlaybackCommandCurrent(command)) return false;
  if (!await startTrack(track, { startOffset: position, syncIndex: false, cachedHint, command, quality: nextQuality })) return false;
  if (!isPlaybackCommandCurrent(command)) return false;
  if (!wasPlaying) return audioShim.pause({ command });
  return true;
}

export async function togglePlayPause() {
  return setPlaying(!playbackPlaying.value);
}

export async function setPlaying(playing) {
  if (!playbackCurrentTrack.value) return;
  const command = beginPlaybackCommand();
  if (!playing) return audioShim.pause({ command });
  return audioShim.resume({ command });
}

export function removeQueuedTrack(index) {
  queue.value = queue.value.filter((_, itemIndex) => index !== itemIndex);
  saveQueue();
}

export function clearQueuedTracks() {
  queue.value = [];
  saveQueue();
}

export function moveQueuedTrack(index, toIndex) {
  const reordered = [...queue.value];
  const [item] = reordered.splice(index, 1);
  if (!item) return;
  reordered.splice(toIndex, 0, item);
  queue.value = reordered;
  saveQueue();
}

export function attachPlaybackReporting() {
  if (listenersAttached) return;
  listenersAttached = true;

  audioShim.addEventListener('error', () => { clearInterval(progressReportTimer); });
  audioShim.addEventListener('play', () => {
    if (isNativePlayback()) return;
    clearInterval(progressReportTimer);
    progressReportTimer = setInterval(() => {
      reportPlayback('Progress', playbackCurrentTrack.value, playbackPosition.value, false);
    }, 15000);
  });
  audioShim.addEventListener('pause', () => {
    if (isNativePlayback()) return;
    clearInterval(progressReportTimer);
    reportPlayback('Progress', playbackCurrentTrack.value, playbackPosition.value, true);
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      if (isNativePlayback()) return;
      reportPlayback('Stopped', playbackCurrentTrack.value, playbackPosition.value, true);
    });
  }
}
