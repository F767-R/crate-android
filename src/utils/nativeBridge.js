let nativeBridge = null;

export function initNativeBridge() {
  if (window.Capacitor && window.Capacitor.Plugins) {
    nativeBridge = window.Capacitor.Plugins.MediaBridge;
  }
  return nativeBridge;
}

export function getNativeBridge() {
  return nativeBridge;
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
    });
  }
}

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
