import { h } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
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
  allTracks,
  allTracksFetched,
  isTranslated,
  trackTranslationCache,
  albumTranslationCache,
  translationComplete,
  allAlbums,
  playerBarExpanded,
  lyricsVisible,
  sleepPanelVisible,
  sleepEndTime,
  sleepMode,
  translationEditVisible,
  userId,
  musicLibraryId,
} from '../stores/state.js';
import { config, qualityPreset, translateBatch, setDeeplServer } from '../config.js';
import { audioShim } from '../utils/playerShim.js';
import { handleNext, handlePrev, seekTo, togglePlayPause, toggleQuality } from '../utils/playbackControls.js';
import { artistText, translatedTrackText } from '../utils/metadata.js';
import { cachedImageUrl, getAllTracks } from '../utils/api.js';
import { showNowPlayingTrack } from '../utils/navigation.js';

export default function PlayerBar() {
  const [volume, setVolume] = useState(1);
  const [clock, setClock] = useState(Date.now());
  const [art, setArt] = useState({ albumId: null, url: '' });
  const [dragPosition, setDragPosition] = useState(null);
  const translateBtnRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressedRef = useRef(false);
  const scrubRef = useRef(null);
  const seekDragRef = useRef({ active: false, pointerId: null, lastTime: 0, wasPlaying: false });

  const track = currentTrack.value;
  const playing = playbackPlaying.value;
  const position = playbackPosition.value;
  const duration = playbackDuration.value;
  const expanded = playerBarExpanded.value;
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
        ? `${Math.max(1, Math.ceil((sleepEndTime.value - clock) / 60000))}m`
        : '';

  // Always render the player bar (collapsed when no track)

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const toggleShuffle = () => {
    shuffleOn.value = !shuffleOn.value;
  };

  const toggleRepeat = () => {
    const modes = ['off', 'all', 'one'];
    const current = modes.indexOf(repeatMode.value);
    repeatMode.value = modes[(current + 1) % modes.length];
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
      wasPlaying: playbackPlaying.value,
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
    seekTo(target, playbackPlaying.value);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    audioShim.setVolume(vol);
  };

  const openLyrics = () => {
    lyricsVisible.value = !lyricsVisible.value;
  };

  const openSleepPanel = () => {
    sleepPanelVisible.value = !sleepPanelVisible.value;
  };

  const openTranslationEditor = () => {
    translationEditVisible.value = true;
  };

  const collapsePlayer = () => {
    playerBarExpanded.value = false;
  };

  const openPlayingAlbum = () => {
    showNowPlayingTrack(track);
  };

  async function translateAllMetadata(force = false) {
    let libraryTracks = allTracks.value;
    if (!allTracksFetched.value) {
      const data = await getAllTracks(userId.value, musicLibraryId.value);
      libraryTracks = data.Items || [];
      allTracks.value = libraryTracks;
      allTracksFetched.value = true;
    }

    const items = [];
    const albums = Array.from(new Map(allAlbums.value.map(a => [a.Id, a])).values());
    albums.forEach(album => {
      if (force || !albumTranslationCache.value[album.Id]) {
        items.push({ id: album.Id, type: 'album', title: album.Name, artist: album.AlbumArtist || '' });
      }
    });
    Array.from(new Map(libraryTracks.map(t => [t.Id, t])).values()).forEach(t => {
      if (force || !trackTranslationCache.value[t.Id]) {
        items.push({ id: t.Id, type: 'track', title: t.Name, artist: artistText(t, '') });
      }
    });

    if (items.length === 0) {
      translationComplete.value = true;
      return;
    }

    const chunkSize = 50;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const texts = [];
      chunk.forEach(item => {
        texts.push(item.title);
        texts.push(item.artist);
      });
      const translated = await translateBatch(texts);
      chunk.forEach((item, idx) => {
        const titleTrans = translated[idx * 2] || item.title;
        const artistTrans = translated[idx * 2 + 1] || item.artist;
        if (item.type === 'album') {
          albumTranslationCache.value = {
            ...albumTranslationCache.value,
            [item.id]: { title: titleTrans, artist: artistTrans },
          };
        } else {
          trackTranslationCache.value = { ...trackTranslationCache.value, [item.id]: { title: titleTrans, artist: artistTrans } };
        }
      });
    }
    translationComplete.value = true;
  }

  const translateBtnClick = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (!translationComplete.value) {
      // First time: kick off translation
      translateAllMetadata()
        .then(() => {
          isTranslated.value = true;
          audioShim.updateMetadata();
        })
        .catch(err => {
          console.error('Translation failed:', err);
        });
    } else {
      isTranslated.value = !isTranslated.value;
      audioShim.updateMetadata();
    }
  };

  const translateBtnLongPress = () => {
    longPressedRef.current = true;
    // Force re-translate (re-runs even if already complete)
    translateAllMetadata(true)
      .then(() => {
        isTranslated.value = true;
        audioShim.updateMetadata();
      })
      .catch(err => {
        console.error('Translation failed:', err);
      });
  };

  useEffect(() => {
    const btn = translateBtnRef.current;
    if (!btn) return;
    const handlePointerDown = () => {
      longPressedRef.current = false;
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        translateBtnLongPress();
      }, 600);
    };
    const handlePointerUp = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
    const handlePointerLeave = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
    btn.addEventListener('pointerdown', handlePointerDown);
    btn.addEventListener('pointerup', handlePointerUp);
    btn.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      btn.removeEventListener('pointerdown', handlePointerDown);
      btn.removeEventListener('pointerup', handlePointerUp);
      btn.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  useEffect(() => {
    if (activeSleepMode !== 'duration' || !sleepEndTime.value) return;
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [activeSleepMode, sleepEndTime.value]);

  useEffect(() => {
    document.body.classList.toggle('player-collapsed', !track || !expanded);
    return () => document.body.classList.remove('player-collapsed');
  }, [track?.Id, expanded]);

  useEffect(() => {
    let active = true;
    setArt({ albumId: track?.AlbumId || null, url: '' });
    if (track?.AlbumId) {
      cachedImageUrl(track.AlbumId, 'primary')
        .then(url => { if (active) setArt({ albumId: track.AlbumId, url }); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [track?.AlbumId]);

  const className = `player-bar ${track && expanded ? '' : 'collapsed'}`;

  return (
    <div class={className} id="playerBar">
      <div class={`art-thumb ${playbackBuffering.value ? 'buffering' : ''}`} id="artThumb">
        {art.albumId === track?.AlbumId && art.url && <img src={art.url} decoding="async" alt="" />}
      </div>
      <div class="now-playing" id="nowPlayingBar" title="Jump to playing album" onClick={openPlayingAlbum}>
        <div class="t" id="npTitle">{display.title}</div>
<div class="a" id="npArtist">
          {display.artist}
        </div>
      </div>
      <div class="transport">
        <div class="transport-row primary">
          <button id="shuffleBtn" title="Shuffle" onClick={toggleShuffle} class={shuffleOn.value ? 'active' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          </button>
          <button id="prevBtn" title="Previous" onClick={handlePrev}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button id="playBtn" class="play-btn" title="Play/Pause" onClick={togglePlayPause}>
            <svg id="playIcon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d={playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}/>
            </svg>
          </button>
          <button id="nextBtn" title="Next" onClick={handleNext}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
          </button>
          <button
            id="repeatBtn"
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
          <div class="secondary-group">
            <button
              id="qualityBtn"
              title={qualityPreset.value === 'high' ? 'High quality (Lossless FLAC)' : 'Low quality (128 kbps Opus)'}
              onClick={toggleQuality}
              class={qualityPreset.value === 'low' ? 'active' : ''}
            >
              {preset.label}
            </button>
            <button id="lyricsBtn" title="Show lyrics" onClick={openLyrics} class={lyricsVisible.value ? 'active' : ''}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm14 1v2h4V8h-4v2zm0 4v2h4v-2h-4z"/></svg>
            </button>
            <button id="translateBtn" ref={translateBtnRef} title="Translate visible text (long‑press for all)" onClick={translateBtnClick} class={isTranslated.value ? 'active' : ''}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>
            </button>
            <button id="editTranslateBtn" title="Edit translation for current track" aria-label="Edit translation" onClick={openTranslationEditor}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <button id="translateServerBtn" title="Set translate server address" onClick={() => setDeeplServer()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.44.17-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
            </button>
            <button id="sleepBtn" title="Sleep timer" aria-label="Sleep timer" onClick={openSleepPanel} class={sleepPanelVisible.value ? 'active' : ''}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8A9.005 9.005 0 0012 3zm1.15 14.35l-3.5-3.5a.5.5 0 01.7-.7l3.15 3.15 6.65-6.65a.5.5 0 01.7.7l-7.2 7.3z"/></svg>
              <span class={`sleep-badge ${sleepBadgeText ? 'visible' : ''}`} id="sleepBadge">{sleepBadgeText}</span>
            </button>
          </div>
          <button id="collapsePlayerBtn" title="Hide player (keeps mini-player at bottom)" aria-label="Hide player" onClick={collapsePlayer}>
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
      <div class="stream-row">
        <span class="time stream-info" id="streamInfo">{streamInfo}</span>
      </div>
      <div class="vol-area">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--muted)"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>
        <input type="range" class="vol-scrub" id="volScrub" min="0" max="1" step="0.01" value={volume} onInput={handleVolumeChange} />
      </div>
    </div>
  );
}
