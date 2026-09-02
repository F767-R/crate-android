import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  currentTrack,
  playbackPlaying,
  playerBarExpanded,
  isTranslated,
  trackTranslationCache
} from '../stores/state.js';
import { handleNext, handlePrev, togglePlayPause } from '../utils/playbackControls.js';
import { armClickSuppression } from '../utils/clickSuppression.js';
import { translatedTrackText } from '../utils/metadata.js';
import { cachedImageUrl } from '../utils/api.js';

export default function MiniPlayer() {
  const [art, setArt] = useState({ albumId: null, url: '' });
  const track = currentTrack.value;
  const playing = playbackPlaying.value;
  const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);

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

  if (!track) return null;

  const expandPlayer = (e) => {
    // Only handle direct clicks on the body, not on transport buttons
    if (e.target.closest('button')) return;
    armClickSuppression();
    playerBarExpanded.value = true;
  };

  // Hide mini-player when full player bar is showing
  const className = `mini-player ${playerBarExpanded.value ? '' : 'visible'}`;

  return (
    <div class={className} id="miniPlayer" role="region" aria-label="Mini player" onClick={expandPlayer}>
      <div class="mini-art" id="miniArt">
        {art.albumId === track.AlbumId && art.url && <img src={art.url} decoding="async" alt="" />}
      </div>
      <div class="mini-info">
        <div class="mini-title" id="miniTitle">{display.title}</div>
        <div class="mini-artist" id="miniArtist">
          {display.artist}
        </div>
      </div>
      <button class="mini-btn" id="miniPrevBtn" title="Previous" aria-label="Previous" onClick={handlePrev}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <button class="mini-btn mini-play" id="miniPlayBtn" title="Play/Pause" aria-label="Play/Pause" onClick={togglePlayPause}>
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
