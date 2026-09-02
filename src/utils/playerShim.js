import {
  isTranslated,
  playbackBuffering,
  playbackCurrentTrack,
  playbackDuration,
  playbackIsLocal,
  playbackPosition,
  playbackStartOffset,
  playbackTrackId,
  setPlaybackState,
  trackTranslationCache,
} from '../stores/state.js';
import { qualityPreset } from '../config.js';
import {
  addNativeListener,
  nativePause,
  nativePlayStream,
  nativeResume,
  nativeSeek,
  nativeSetVolume,
  nativeUpdateNowPlaying,
} from './nativeBridge.js';
import { getAlbumArtUrl } from './api.js';
import { translatedTrackText } from './metadata.js';

let initialized = false;

function emit(listeners, event, payload = {}) {
  const value = { type: event, target: audioShim, ...payload };
  for (const callback of listeners[event] || []) {
    try {
      callback(value);
    } catch (error) {
      console.error(`[player] ${event} listener failed`, error);
    }
  }
}

export const audioShim = {
  src: '',
  currentTime: 0,
  duration: 0,
  paused: true,
  volume: 1,
  playbackRate: 1,
  _listeners: {},

  get isLocalStream() {
    return playbackIsLocal.value;
  },

  get isBuffering() {
    return playbackBuffering.value;
  },

  setSrc(url, track = null, { itemCached = false } = {}) {
    this.src = url || '';
    const nextTrack = track || playbackCurrentTrack.value;
    this.currentTime = 0;
    this.duration = nextTrack?.RunTimeTicks ? nextTrack.RunTimeTicks / 10000000 : 0;
    setPlaybackState({
      trackId: nextTrack?.Id || null,
      currentTrack: nextTrack,
      duration: this.duration,
      isLocal: false,
      buffering: false,
      itemCached,
      error: null,
    });
  },

  async play(opts = {}) {
    const track = playbackCurrentTrack.value;
    const url = opts.url ?? this.src;
    if (!track || !url) return;

    const startPositionMs = opts.startPositionMs ?? Math.round(playbackPosition.value * 1000);
    const cache = opts.cache ?? qualityPreset.value === 'low';
    const cached = opts.cached === true;
    const text = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);

    this.paused = false;
    setPlaybackState({ playing: true, buffering: !cached, itemCached: cached, error: null });
    emit(this._listeners, 'play');

    try {
      await nativePlayStream({
        url,
        startPositionMs,
        title: text.title,
        artist: text.artist,
        artUrl: track.AlbumId ? getAlbumArtUrl(track.AlbumId, 400) : null,
        durationMs: Math.round((track.RunTimeTicks || 0) / 10000),
        cache,
      });
    } catch (error) {
      this.paused = true;
      setPlaybackState({ playing: false, buffering: false, error });
      emit(this._listeners, 'error', { error });
      throw error;
    }
  },

  async pause() {
    if (this.paused) return;
    this.paused = true;
    setPlaybackState({ playing: false });
    emit(this._listeners, 'pause');
    return nativePause();
  },

  async resume() {
    if (!playbackCurrentTrack.value || !this.paused) return;
    this.paused = false;
    setPlaybackState({ playing: true });
    emit(this._listeners, 'play');
    return nativeResume();
  },

  async seek(time) {
    const safeTime = Math.max(0, Number(time) || 0);
    this.currentTime = safeTime;
    setPlaybackState({ position: safeTime });
    emit(this._listeners, 'timeupdate');
    return nativeSeek(Math.round(safeTime * 1000));
  },

  setVolume(volume) {
    const next = Math.max(0, Math.min(1, Number(volume) || 0));
    this.volume = next;
    return nativeSetVolume(next);
  },

  updateMetadata() {
    const track = playbackCurrentTrack.value;
    if (!track) return;
    const text = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
    return nativeUpdateNowPlaying({
      title: text.title,
      artist: text.artist,
      artUrl: track.AlbumId ? getAlbumArtUrl(track.AlbumId, 400) : null,
      duration: Math.round((playbackDuration.value || 0) * 1000),
    });
  },

  addEventListener(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  removeEventListener(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(value => value !== callback);
  },

  dispatchEvent(event) {
    emit(this._listeners, event.type, event);
  },
};

export function initPlayerShim() {
  if (initialized) return;
  initialized = true;

  addNativeListener('stateChanged', data => {
    const wasPaused = audioShim.paused;
    const wasBuffering = playbackBuffering.value;
    const rawPosition = Math.max(0, (Number(data?.position) || 0) / 1000);
    const isLocal = data?.isLocal === true;
    const position = (isLocal || qualityPreset.value === 'high')
      ? rawPosition
      : playbackStartOffset.value + rawPosition;
    const duration = Number(data?.duration) > 0
      ? Number(data.duration) / 1000
      : playbackDuration.value;
    const isPlaying = data?.isPlaying === true;
    // A cached local file briefly enters ExoPlayer's BUFFERING state while
    // its extractor opens. That is local preparation, not network buffering,
    // and should not flash a misleading buffer state in the UI.
    const isBuffering = data?.buffering === true && !isLocal;

    audioShim.currentTime = position;
    audioShim.duration = duration;
    audioShim.paused = !isPlaying;
    setPlaybackState({
      position,
      duration,
      playing: isPlaying,
      isLocal,
      buffering: isBuffering,
      ...(isLocal ? { itemCached: true } : {}),
    });

    if (wasPaused && isPlaying) emit(audioShim._listeners, 'play');
    if (!wasPaused && !isPlaying) emit(audioShim._listeners, 'pause');
    if (!wasBuffering && isBuffering) emit(audioShim._listeners, 'waiting');
    if (wasBuffering && !isBuffering) emit(audioShim._listeners, 'canplay');
    emit(audioShim._listeners, 'timeupdate');
  });

  // The Android plugin emits sessionSeek with positionMs. Network
  // transcodes need the controller's URL-restart seek path.
  addNativeListener('sessionSeek', data => {
    emit(audioShim._listeners, 'sessionseek', {
      position: Math.max(0, (Number(data?.positionMs) || 0) / 1000),
    });
  });

  addNativeListener('trackEnded', () => {
    audioShim.paused = true;
    setPlaybackState({ playing: false, buffering: false });
    emit(audioShim._listeners, 'ended');
  });
  addNativeListener('next', () => emit(audioShim._listeners, 'next'));
  addNativeListener('prev', () => emit(audioShim._listeners, 'previous'));
  addNativeListener('cacheReady', data => {
    if (data?.itemId && data.itemId === playbackTrackId.value) {
      setPlaybackState({ itemCached: true });
    }
    emit(audioShim._listeners, 'cacheready', { itemId: data?.itemId });
  });
  addNativeListener('error', data => {
    const error = new Error(data?.message || 'Native playback error');
    setPlaybackState({ error, buffering: false });
    emit(audioShim._listeners, 'error', { error });
  });
}

if (typeof window !== 'undefined') window.audio = audioShim;
export default audioShim;
