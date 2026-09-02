// --- Native shell adapter -------------------------------------------------
// Paste this into C.R.A.T.E.'s <script> block. Safe no-op in a normal
// browser; activates the native MediaSession bridge when running inside
// the Capacitor Android shell.

const isNativeShell = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
let MediaBridge = null;

if (isNativeShell) {
  // Capacitor 6 plugin access pattern
  MediaBridge = window.Capacitor.Plugins.MediaBridge;

  MediaBridge.addListener('nativePlay', () => {
    // Call your existing play function here
    audioController.play();
  });
  MediaBridge.addListener('nativePause', () => {
    audioController.pause();
  });
  MediaBridge.addListener('nativeNext', () => {
    audioController.playNext();
  });
  MediaBridge.addListener('nativePrev', () => {
    audioController.playPrevious();
  });
  MediaBridge.addListener('nativeSeek', (e) => {
    audioController.seekTo(e.position / 1000); // ms -> seconds, adjust to your API
  });
}

// Call this whenever the current track changes.
function syncNowPlaying(track) {
  if (isNativeShell && MediaBridge) {
    MediaBridge.updateNowPlaying({
      title: track.title,
      artist: track.artist,
      artUrl: track.coverUrl || '',
      duration: Math.round((track.duration || 0) * 1000) // seconds -> ms
    });
  } else if ('mediaSession' in navigator) {
    // existing browser fallback, if you already have one
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      artwork: track.coverUrl ? [{ src: track.coverUrl }] : []
    });
  }
}

// Call this on every play/pause and periodically (e.g. every 5s) while
// playing, so the lockscreen scrubber stays roughly in sync.
function syncPlaybackState(isPlaying, positionSeconds) {
  if (isNativeShell && MediaBridge) {
    MediaBridge.updatePlaybackState({
      isPlaying,
      position: Math.round(positionSeconds * 1000)
    });
  } else if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}
// ---------------------------------------------------------------------------
