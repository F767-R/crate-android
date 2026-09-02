import { signal, computed } from '@preact/signals';

export const userId = signal(null);
export const musicLibraryId = signal(null);
export const currentTracks = signal([]);
export const currentIndex = signal(-1);
export const shuffleOn = signal(false);
export const repeatMode = signal('off');
export const playHistory = signal([]);
export const PLAY_HISTORY_MAX = 200;

export const parsedLyrics = signal(null);
export const currentLyricsTrackId = signal(null);
export const lyricsContainer = signal(null);
export const previousViewState = signal(null);
export const activeTime = signal(-1);

export const trackTranslationCache = signal({});
export const albumTranslationCache = signal({});
export const isTranslated = signal(false);
export const translationComplete = signal(false);

export const albumDetailCache = signal(new Map());
export const currentViewState = signal({ type: 'grid' });
export const albumGridDOM = signal(null);
export const albumGridScrollTop = signal(0);
export const albumGridFocusAlbumId = signal(null);
export const albumGridFollowPlayback = signal(false);

export const allAlbums = signal([]);
export const allTracks = signal([]);
export const allTracksFetched = signal(false);

export const queue = signal([]);

function loadQueue() {
  try {
    const saved = localStorage.getItem('crateQueue');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        queue.value = parsed.filter(item => item && item.track && item.track.Id).map(item => ({
          track: {
            Id: item.track.Id,
            Name: item.track.Name,
            Artists: item.track.Artists,
            ArtistNames: item.track.ArtistNames,
            ArtistItems: item.track.ArtistItems,
            RunTimeTicks: item.track.RunTimeTicks,
            AlbumId: item.track.AlbumId,
            AlbumArtist: item.track.AlbumArtist,
            Album: item.track.Album,
            ImageUrl: item.track.ImageUrl,
            IndexNumber: item.track.IndexNumber,
            ParentIndexNumber: item.track.ParentIndexNumber
          },
          albumId: item.albumId
        }));
      }
    }
  } catch (_) {}
}

function saveQueue() {
  try {
    const toSave = queue.value.map(item => ({
      track: item.track ? {
        Id: item.track.Id,
        Name: item.track.Name,
        Artists: item.track.Artists,
        ArtistNames: item.track.ArtistNames,
        ArtistItems: item.track.ArtistItems,
        RunTimeTicks: item.track.RunTimeTicks,
        AlbumId: item.track.AlbumId,
        AlbumArtist: item.track.AlbumArtist,
        Album: item.track.Album,
        ImageUrl: item.track.ImageUrl,
        IndexNumber: item.track.IndexNumber,
        ParentIndexNumber: item.track.ParentIndexNumber
      } : null,
      albumId: item.albumId
    }));
    localStorage.setItem('crateQueue', JSON.stringify(toSave));
  } catch (_) {}
}

loadQueue();

export { saveQueue };
export const queueVisible = signal(false);
export const resumeAfterQueue = signal(null);
export const contextMenuTarget = signal(null);
export const longPressTimer = signal(null);
export const longPressTarget = signal(null);
export const LONG_PRESS_DURATION = 500;

// Panel visibility signals (driven by buttons in PlayerBar / MiniPlayer)
export const playerBarExpanded = signal(true);
export const lyricsVisible = signal(false);
export const sleepPanelVisible = signal(false);
export const translationEditVisible = signal(false);

export const sleepTimerId = signal(null);
export const sleepRefreshIntervalId = signal(null);
export const sleepEndTime = signal(null);
export const sleepMode = signal(null);
export const sleepDurationMinutes = signal(0);
export const sleepOriginalQueueLength = signal(0);
export const sleepQueueDrained = signal(false);

// Playback state - using separate signals to avoid mutation hazards
export const playbackMode = signal('stream');
export const playbackPosition = signal(0);
export const playbackDuration = signal(0);
export const playbackStartOffset = signal(0);
export const playbackTrackId = signal(null);
export const playbackCurrentTrack = signal(null);
export const playbackPlaying = signal(false);
export const playbackToken = signal(0);
export const playbackQuality = signal('low');
export const playbackIsLocal = signal(false);
export const playbackBuffering = signal(false);
export const playbackItemCached = signal(false);
export const playbackError = signal(null);

export const playbackBlob = signal({
  position: 0,
  startTime: 0,
  sourceNode: null,
  buffer: null,
  fetchPromise: null,
});

export const playbackRafId = signal(null);
export const playbackCrossfadeTimeoutId = signal(null);

// Computed playback object for compatibility
export const playback = computed(() => ({
  mode: playbackMode.value,
  position: playbackPosition.value,
  duration: playbackDuration.value,
  startOffset: playbackStartOffset.value,
  trackId: playbackTrackId.value,
  currentTrack: playbackCurrentTrack.value,
  playing: playbackPlaying.value,
  token: playbackToken.value,
  blob: playbackBlob.value,
  rafId: playbackRafId.value,
  crossfadeTimeoutId: playbackCrossfadeTimeoutId.value,
  quality: playbackQuality.value,
  isLocal: playbackIsLocal.value,
  buffering: playbackBuffering.value,
  itemCached: playbackItemCached.value,
  error: playbackError.value,
}));

export const currentTrack = computed(() => {
  return playbackCurrentTrack.value;
});

// Helper to update playback state immutably
export function setPlaybackState(updates) {
  if (updates.mode !== undefined) playbackMode.value = updates.mode;
  if (updates.position !== undefined) playbackPosition.value = updates.position;
  if (updates.duration !== undefined) playbackDuration.value = updates.duration;
  if (updates.startOffset !== undefined) playbackStartOffset.value = updates.startOffset;
  if (updates.trackId !== undefined) playbackTrackId.value = updates.trackId;
  if (updates.currentTrack !== undefined) playbackCurrentTrack.value = updates.currentTrack;
  if (updates.playing !== undefined) playbackPlaying.value = updates.playing;
  if (updates.token !== undefined) playbackToken.value = updates.token;
  if (updates.quality !== undefined) playbackQuality.value = updates.quality;
  if (updates.isLocal !== undefined) playbackIsLocal.value = updates.isLocal;
  if (updates.buffering !== undefined) playbackBuffering.value = updates.buffering;
  if (updates.itemCached !== undefined) playbackItemCached.value = updates.itemCached;
  if (updates.error !== undefined) playbackError.value = updates.error;
  if (updates.blob !== undefined) playbackBlob.value = updates.blob;
  if (updates.rafId !== undefined) playbackRafId.value = updates.rafId;
  if (updates.crossfadeTimeoutId !== undefined) playbackCrossfadeTimeoutId.value = updates.crossfadeTimeoutId;
}

// Sleep timer check - called when track ends naturally
export function checkSleepTimerOnTrackEnd() {
  if (sleepMode.value === 'track') {
    return true;
  }
  if (sleepMode.value === 'queue' && sleepQueueDrained.value) {
    return true;
  }
  return false;
}

// Mark queue as drained when empty and sleep mode is queue
export function checkQueueDrained() {
  if (sleepMode.value === 'queue' && queue.value.length === 0) {
    sleepQueueDrained.value = true;
  }
}
