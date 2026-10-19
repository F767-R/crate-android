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
export const previousViewState = signal(null);

export const trackTranslationCache = signal({});
export const albumTranslationCache = signal({});
export const isTranslated = signal(false);
export const translationComplete = signal(false);
export const translationBusy = signal(false);
// Safe user-facing errors only: null or { message, code, retryable }.
export const translationError = signal(null);
function loadTranslationCacheOnly() {
  try { return localStorage.getItem('crateTranslationCacheOnly') === 'true'; } catch (_) { return false; }
}
export const translationCacheOnly = signal(loadTranslationCacheOnly());

export const albumDetailCache = signal(new Map());
export const currentViewState = signal({ type: 'grid' });
export const searchQuery = signal('');
export const albumGridScrollTop = signal(0);
export const albumGridFocusAlbumId = signal(null);
export const albumGridFollowPlayback = signal(false);

export const allAlbums = signal([]);
export const allTracks = signal([]);
export const allTracksFetched = signal(false);

export const queue = signal([]);

function queueEntry(item) {
  const track = item.track;
  return {
    track: track ? {
      Id: track.Id, Name: track.Name, Artists: track.Artists,
      ArtistNames: track.ArtistNames, ArtistItems: track.ArtistItems,
      RunTimeTicks: track.RunTimeTicks, AlbumId: track.AlbumId,
      AlbumArtist: track.AlbumArtist, Album: track.Album, ImageUrl: track.ImageUrl,
      IndexNumber: track.IndexNumber, ParentIndexNumber: track.ParentIndexNumber,
    } : null,
    albumId: item.albumId,
  };
}

function loadQueue() {
  try {
    const saved = localStorage.getItem('crateQueue');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        queue.value = parsed.filter(item => item?.track?.Id).map(queueEntry);
      }
    }
  } catch (_) {}
}

function saveQueue() {
  try {
    const toSave = queue.value.map(queueEntry);
    localStorage.setItem('crateQueue', JSON.stringify(toSave));
  } catch (_) {}
}

loadQueue();

export { saveQueue };
export const queueVisible = signal(false);
export const resumeAfterQueue = signal(null);
export const contextMenuTarget = signal(null);

// Panel visibility signals (driven by buttons in PlayerBar / MiniPlayer)
export const playerBarExpanded = signal(true);
export const playerMoreVisible = signal(false);
export const lyricsVisible = signal(false);
export const sleepPanelVisible = signal(false);
export const translationEditVisible = signal(false);
export const settingsVisible = signal(false);

export const sleepTimerId = signal(null);
export const sleepRefreshIntervalId = signal(null);
export const sleepEndTime = signal(null);
export const sleepMode = signal(null);
export const sleepDurationMinutes = signal(0);
export const sleepOriginalQueueLength = signal(0);
export const sleepQueueDrained = signal(false);

// Playback state - using separate signals to avoid mutation hazards
export const playbackPosition = signal(0);
export const playbackDuration = signal(0);
export const playbackStartOffset = signal(0);
export const playbackTrackId = signal(null);
export const playbackCurrentTrack = signal(null);
export const playbackPlaying = signal(false);
export const playbackQuality = signal('low');
export const playbackIsLocal = signal(false);
export const playbackBuffering = signal(false);
export const playbackItemCached = signal(false);
export const playbackError = signal(null);

export const currentTrack = computed(() => {
  return playbackCurrentTrack.value;
});

// Helper to update playback state immutably
export function setPlaybackState(updates) {
  if (updates.position !== undefined) playbackPosition.value = updates.position;
  if (updates.duration !== undefined) playbackDuration.value = updates.duration;
  if (updates.startOffset !== undefined) playbackStartOffset.value = updates.startOffset;
  if (updates.trackId !== undefined) playbackTrackId.value = updates.trackId;
  if (updates.currentTrack !== undefined) playbackCurrentTrack.value = updates.currentTrack;
  if (updates.playing !== undefined) playbackPlaying.value = updates.playing;
  if (updates.quality !== undefined) playbackQuality.value = updates.quality;
  if (updates.isLocal !== undefined) playbackIsLocal.value = updates.isLocal;
  if (updates.buffering !== undefined) playbackBuffering.value = updates.buffering;
  if (updates.itemCached !== undefined) playbackItemCached.value = updates.itemCached;
  if (updates.error !== undefined) playbackError.value = updates.error;
}
