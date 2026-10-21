let nativeBridge = null;

export function initNativeBridge() {
  if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins) {
    nativeBridge = window.Capacitor.Plugins.MediaBridge;
  }
  return nativeBridge;
}

export function getNativeBridge() {
  return nativeBridge;
}

export async function openNativeLibrary() {
  const bridge = getNativeBridge() || initNativeBridge();
  if (typeof bridge?.openNativeLibrary !== 'function') throw new Error('Native preview requires the updated Android app.');
  return bridge.openNativeLibrary();
}

// Best effort: older installed builds lack the method, and the web UI works without it.
export async function nativeSetSystemBars(color, lightBackground) {
  if (!nativeBridge) initNativeBridge();
  if (typeof nativeBridge?.setSystemBars !== 'function') return;
  try { await nativeBridge.setSystemBars({ color, lightBackground }); } catch (_) {}
}

export async function nativePlayStream(payload) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.playStream) {
    return nativeBridge.playStream({
      url: payload.url,
      startPositionMs: payload.startPositionMs || 0,
      title: payload.title || '',
      artist: payload.artist || '',
      artUrl: payload.artUrl || null,
      durationMs: payload.durationMs || 0,
      cache: payload.cache === true,
      bypassCache: payload.bypassCache === true,
    });
  }
  const error = new Error('Native playback is unavailable.');
  error.code = 'native_unavailable';
  throw error;
}

async function cacheCommand(method, args = {}) {
  if (!nativeBridge) initNativeBridge();
  if (typeof nativeBridge?.[method] !== 'function') {
    const error = new Error('Cache controls require the updated Android app.');
    error.code = 'native_unavailable';
    throw error;
  }
  return nativeBridge[method](args);
}

export const nativeGetDownloadedTracks = () => cacheCommand('getDownloadedTracks');
export const nativeGetCacheStats = () => cacheCommand('getCacheStats');
export const nativeSetCacheLimit = audioLimitBytes => cacheCommand('setCacheLimit', { audioLimitBytes });
export const nativeClearCache = () => cacheCommand('clearCache');

export async function nativeIsCached(itemId) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.isCached && itemId) {
    try {
      const result = await nativeBridge.isCached({ itemId });
      return result?.cached === true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

export async function nativePause() {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.pause) {
    return nativeBridge.pause();
  }
}

export async function nativeResume() {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.resume) {
    return nativeBridge.resume();
  }
}

export async function nativeSeek(positionMs) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.seek) {
    return nativeBridge.seek({ positionMs });
  }
}

export async function nativeSetVolume(volume) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.setVolume) {
    return nativeBridge.setVolume({ level: volume });
  }
}

export async function nativeUpdateNowPlaying(metadata) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.updateNowPlaying) {
    return nativeBridge.updateNowPlaying({
      itemId: metadata.itemId || null,
      title: metadata.title || '',
      artist: metadata.artist || '',
      artUrl: metadata.artUrl || null,
      duration: metadata.duration || 0,
    });
  }
}

export async function nativeUpdatePlaybackState(playing, positionMs) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.updatePlaybackState) {
    return nativeBridge.updatePlaybackState({
      isPlaying: playing,
      position: positionMs,
    });
  }
}

export function addNativeListener(eventName, callback) {
  if (!nativeBridge) initNativeBridge();
  if (nativeBridge && nativeBridge.addListener) {
    return nativeBridge.addListener(eventName, callback);
  }
}

export function removeNativeListener(eventName, callback) {
  if (nativeBridge && nativeBridge.removeListener) {
    nativeBridge.removeListener(eventName, callback);
  }
}
