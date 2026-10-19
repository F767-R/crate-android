import { h } from 'preact';
import { useEffect, useLayoutEffect, useState, useRef } from 'preact/hooks';
import {
  playbackPosition,
  playbackDuration,
  playbackPlaying,
  playbackBuffering,
  playbackIsLocal,
  playbackItemCached,
  currentTrack,
  repeatMode,
  shuffleOn,
  isTranslated,
  trackTranslationCache,
  translationComplete,
  translationBusy,
  playerBarExpanded,
  playerMoreVisible,
  settingsVisible,
  lyricsVisible,
  sleepPanelVisible,
  sleepEndTime,
  sleepMode,
  currentViewState,
} from '../stores/state.js';
import { config, qualityPreset } from '../config.js';
import { audioShim } from '../utils/playerShim.js';
import { handleNext, handlePrev, seekTo, togglePlayPause, toggleQuality, toggleShuffle, toggleRepeat } from '../utils/playbackControls.js';
import { isNativePlayback, nativeDesiredPlaying } from '../utils/nativePlayback.js';
import { translatedTrackText } from '../utils/metadata.js';
import { TrackArtwork } from './Artwork.jsx';
import { translateAllMetadata } from '../utils/translationControls.js';
import { hideLyricsView, showLyricsView, showNowPlayingTrack } from '../utils/navigation.js';

export default function PlayerBar() {
  const moreOpen = playerMoreVisible.value;
  const setMoreOpen = value => { playerMoreVisible.value = typeof value === 'function' ? value(playerMoreVisible.value) : value; };
  const moreRef = useRef(null);
  const moreButtonRef = useRef(null);
  const [volume, setVolume] = useState(1);
  const [, setClock] = useState(Date.now());
  const [dragPosition, setDragPosition] = useState(null);
  const scrubRef = useRef(null);
  const seekDragRef = useRef({ active: false, pointerId: null, lastTime: 0, wasPlaying: false });

  const track = currentTrack.value;
  const playing = isNativePlayback() ? nativeDesiredPlaying.value : playbackPlaying.value;
  const position = playbackPosition.value;
  const duration = playbackDuration.value;
  const immersiveLyrics = currentViewState.value.type === 'lyrics';
  const expanded = playerBarExpanded.value || immersiveLyrics;
  const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
  const displayedPosition = dragPosition ?? position;
  const progress = duration > 0 ? Math.max(0, Math.min(100, displayedPosition / duration * 100)) : 0;
  const preset = config.QUALITY_PRESETS[qualityPreset.value];
  const streamStatus = qualityPreset.value === 'low'
    && (playbackIsLocal.value || playbackItemCached.value)
    ? 'Cached'
    : '';
  const streamInfo = streamStatus ? `${preset.display} · ${streamStatus}` : preset.display;
  const activeSleepMode = sleepMode.value;
  const sleepBadgeText = activeSleepMode === 'track'
    ? '1'
    : activeSleepMode === 'queue'
      ? 'Q'
      : activeSleepMode === 'duration' && sleepEndTime.value
        ? `${Math.max(1, Math.ceil((sleepEndTime.value - Date.now()) / 60000))}m`
        : '';

  // Always render the player bar (collapsed when no track)

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const seekTimeFromPointer = (event) => {
    const element = scrubRef.current || event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !duration || !Number.isFinite(duration)) return 0;
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return percent * duration;
  };

  const startSeekDrag = (event) => {
    if (!duration || !Number.isFinite(duration)) return;
    event.preventDefault();
    const seekTime = seekTimeFromPointer(event);
    seekDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastTime: seekTime,
      wasPlaying: isNativePlayback() ? nativeDesiredPlaying.value : playbackPlaying.value,
    };
    event.currentTarget.classList.add('dragging');
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
    setDragPosition(seekTime);
  };

  const updateSeekDrag = (event) => {
    const drag = seekDragRef.current;
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const seekTime = seekTimeFromPointer(event);
    drag.lastTime = seekTime;
    setDragPosition(seekTime);
  };

  const finishSeekDrag = (event, cancelled = false) => {
    const drag = seekDragRef.current;
    if (!drag.active || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const seekTime = cancelled ? drag.lastTime : seekTimeFromPointer(event);
    const wasPlaying = drag.wasPlaying;
    seekDragRef.current = { active: false, pointerId: null, lastTime: seekTime, wasPlaying: false };
    const element = scrubRef.current;
    element?.classList.remove('dragging');
    try {
      if (element?.hasPointerCapture?.(drag.pointerId)) element.releasePointerCapture(drag.pointerId);
    } catch (_) {}
    setDragPosition(null);
    seekTo(seekTime, wasPlaying);
  };

  const handleSeekKeyDown = (event) => {
    if (!duration || !Number.isFinite(duration)) return;
    let target = null;
    if (event.key === 'ArrowLeft') target = Math.max(0, position - 5);
    if (event.key === 'ArrowRight') target = Math.min(duration, position + 5);
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = duration;
    if (target == null) return;
    event.preventDefault();
    seekTo(target);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    audioShim.setVolume(vol);
  };

  const toggleLyrics = () => {
    if (currentViewState.value.type === 'lyrics') {
      hideLyricsView();
      return;
    }

    const mobile = isNativePlayback() || window.matchMedia?.('(max-width: 640px), (pointer: coarse)').matches;
    if (mobile) {
      lyricsVisible.value = false;
      showLyricsView();
    } else {
      lyricsVisible.value = !lyricsVisible.value;
    }
  };

  const openSleepPanel = () => {
    sleepPanelVisible.value = !sleepPanelVisible.value;
  };

  const collapsePlayer = () => {
    playerBarExpanded.value = false;
  };

  const openPlayingAlbum = () => {
    showNowPlayingTrack(track);
  };

  const translateBtnClick = () => {
    if (translationBusy.value) return;
    if (isTranslated.value) {
      isTranslated.value = false;
      audioShim.updateMetadata();
    } else if (!translationComplete.value) {
      translateAllMetadata();
    } else {
      isTranslated.value = true;
      audioShim.updateMetadata();
    }
  };

  useEffect(() => {
    if (activeSleepMode !== 'duration' || !sleepEndTime.value) return;
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [activeSleepMode, sleepEndTime.value]);

  useEffect(() => {
    document.body.classList.toggle('player-collapsed', !track || !expanded);
    return () => document.body.classList.remove('player-collapsed');
  }, [track?.Id, expanded]);

  // Reserve the actual dock height, including wrapped controls and safe-area padding.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const dock = document.getElementById(expanded ? 'playerBar' : 'miniPlayer');
    const update = () => {
      const height = track && dock ? Math.ceil(dock.getBoundingClientRect().height) + (expanded ? 0 : 16) : 0;
      root.style.setProperty('--player-inset', `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    if (dock) observer.observe(dock);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--player-inset');
    };
  }, [!!track, expanded]);

  useEffect(() => { setMoreOpen(false); }, [expanded, track?.Id]);
  useEffect(() => {
    if (!moreOpen) return;
    const dismiss = event => {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        setMoreOpen(false); moreButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [moreOpen]);
  const moreAction = action => { setMoreOpen(false); moreButtonRef.current?.focus(); action(); };

  const className = `player-bar ${track && expanded ? '' : 'collapsed'}`;

  return (
    <div class={className} id="playerBar" aria-hidden={!track || !expanded || settingsVisible.value} inert={!track || !expanded || settingsVisible.value}>
      <div class={`art-thumb ${playbackBuffering.value ? 'buffering' : ''}`} id="artThumb">
        <TrackArtwork track={track} lazy={false} enabled={Boolean(track && expanded)} fallback="" />
      </div>
      <button class="now-playing" id="nowPlayingBar" aria-label={`Open playing album: ${display.title}`} onClick={openPlayingAlbum}>
        <div class="t" id="npTitle">{display.title}</div>
<div class="a" id="npArtist">
          {display.artist}
        </div>
      </button>
      <div class="transport">
        <div class="transport-row primary">
          <button id="shuffleBtn" title="Shuffle" aria-label="Shuffle" aria-pressed={shuffleOn.value} onClick={toggleShuffle} class={shuffleOn.value ? 'active' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          </button>
          <button id="prevBtn" title="Previous" aria-label="Previous" onClick={handlePrev}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button id="playBtn" class="play-btn" title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlayPause}>
            <svg id="playIcon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d={playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}/>
            </svg>
          </button>
          <button id="nextBtn" title="Next" aria-label="Next" onClick={handleNext}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
          </button>
          <button
            id="repeatBtn"
            aria-label={`Repeat: ${repeatMode.value === 'one' ? 'one track' : repeatMode.value === 'all' ? 'all tracks' : 'off'}`}
            aria-pressed={repeatMode.value !== 'off'}
            title={repeatMode.value === 'one' ? 'Repeat: one track' : repeatMode.value === 'all' ? 'Repeat: all' : 'Repeat'}
            onClick={toggleRepeat}
            class={`${repeatMode.value !== 'off' ? 'active' : ''} ${repeatMode.value === 'one' ? 'repeat-one' : ''}`}
            style="position:relative;"
          >
            <svg id="repeatIcon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
            {repeatMode.value === 'one' && <span id="repeatOneBadge">1</span>}
          </button>
        </div>
        <div class="transport-row secondary">
          <button class="player-utility" id="lyricsBtn" aria-label="Lyrics" title="Lyrics" onClick={toggleLyrics} aria-pressed={lyricsVisible.value || currentViewState.value.type === 'lyrics'}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></svg>
            <span class="player-utility-label">Lyrics</span>
          </button>
          <div class="player-more" ref={moreRef}>
            <button class="player-utility" ref={moreButtonRef} id="playerMoreBtn" aria-label="More" title="More playback options" aria-expanded={moreOpen} aria-controls="playerMoreActions" onClick={() => setMoreOpen(value => !value)}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
              <span class="player-utility-label">More</span>
            </button>
            {moreOpen && <div class="player-more-actions" id="playerMoreActions" role="group" aria-label="Playback options">
              <p class="player-options-heading">Playback options</p>
              <button id="qualityBtn" onClick={() => moreAction(toggleQuality)}><span>Audio quality</span><span>{preset.label}</span></button>
              <button id="translateBtn" disabled={translationBusy.value} aria-pressed={isTranslated.value} onClick={() => moreAction(translateBtnClick)}><span>{translationBusy.value ? 'Translating…' : 'Translated labels'}</span><span>{isTranslated.value ? 'On' : 'Off'}</span></button>
              <button id="sleepBtn" onClick={() => moreAction(openSleepPanel)}><span>Sleep timer</span><span>{sleepBadgeText || 'Off'}</span></button>
              <p class="player-options-hint">{streamInfo}</p>
            </div>}
          </div>
          <button id="collapsePlayerBtn" title="Collapse player" aria-label="Collapse player" onClick={collapsePlayer}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
          </button>
        </div>
      </div>
      <div class="scrub-area">
        <span class="time" id="curTime">{formatTime(displayedPosition)}</span>
        <div
          class="scrub"
          id="scrub"
          ref={scrubRef}
          role="slider"
          tabIndex={0}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(displayedPosition || 0)}
          aria-valuetext={`${formatTime(displayedPosition)} of ${formatTime(duration)}`}
          onPointerDown={startSeekDrag}
          onPointerMove={updateSeekDrag}
          onPointerUp={event => finishSeekDrag(event)}
          onPointerCancel={event => finishSeekDrag(event, true)}
          onLostPointerCapture={event => finishSeekDrag(event, true)}
          onKeyDown={handleSeekKeyDown}
        >
          <div class="fill" id="scrubFill" style={`width: ${progress}%`}></div>
          <div class="knob" id="scrubKnob" style={`left: ${progress}%`}></div>
        </div>
        <span class="time right" id="durTime">{formatTime(duration)}</span>
      </div>
      <div class="vol-area">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--muted)"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>
        <input type="range" class="vol-scrub" id="volScrub" aria-label="Volume" min="0" max="1" step="0.01" value={volume} onInput={handleVolumeChange} />
      </div>
    </div>
  );
}
