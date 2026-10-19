import { h } from 'preact';
import {
  currentTrack,
  playbackPlaying,
  playerBarExpanded,
  settingsVisible,
  currentViewState,
  isTranslated,
  trackTranslationCache
} from '../stores/state.js';
import { handleNext, handlePrev, togglePlayPause } from '../utils/playbackControls.js';
import { armClickSuppression } from '../utils/clickSuppression.js';
import { translatedTrackText } from '../utils/metadata.js';
import { TrackArtwork } from './Artwork.jsx';
import { isNativePlayback, nativeDesiredPlaying } from '../utils/nativePlayback.js';

export default function MiniPlayer() {
  const track = currentTrack.value;
  const playing = isNativePlayback() ? nativeDesiredPlaying.value : playbackPlaying.value;
  const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);

  if (!track) return null;

  const expandPlayer = (e) => {
    // Only handle direct clicks on the body, not on transport buttons
    if (e.target.closest('button')) return;
    armClickSuppression();
    playerBarExpanded.value = true;
  };

  // Hide mini-player when full player bar is showing
  const hidden = playerBarExpanded.value || currentViewState.value.type === 'lyrics';
  const className = `mini-player ${hidden ? '' : 'visible'}`;

  return (
    <div class={className} id="miniPlayer" role="region" aria-label="Mini player" aria-hidden={hidden || settingsVisible.value} inert={hidden || settingsVisible.value} onClick={expandPlayer}>
      <div class="mini-art" id="miniArt">
        <TrackArtwork track={track} lazy={false} enabled={!playerBarExpanded.value} fallback="" />
      </div>
      <button class="mini-info" aria-label={`Expand player: ${display.title}`} onClick={() => { playerBarExpanded.value = true; }}>
        <div class="mini-title" id="miniTitle">{display.title}</div>
        <div class="mini-artist" id="miniArtist">
          {display.artist}
        </div>
      </button>
      <button class="mini-btn" id="miniPrevBtn" title="Previous" aria-label="Previous" onClick={handlePrev}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <button class="mini-btn mini-play" id="miniPlayBtn" title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlayPause}>
        <svg id="miniPlayIcon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d={playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}/>
        </svg>
      </button>
      <button class="mini-btn" id="miniNextBtn" title="Next" aria-label="Next" onClick={handleNext}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
      </button>
    </div>
  );
}
