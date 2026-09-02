import { h } from 'preact';
import {
  currentViewState,
  isTranslated,
  playbackCurrentTrack,
  trackTranslationCache,
} from '../stores/state.js';
import { translatedTrackText } from '../utils/metadata.js';
import { showNowPlayingTrack } from '../utils/navigation.js';

export default function NowPlayingStrip() {
  const track = playbackCurrentTrack.value;
  const view = currentViewState.value;
  if (!track?.AlbumId || (view.type === 'album' && view.albumId === track.AlbumId)) return null;

  const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
  const openAlbum = () => {
    showNowPlayingTrack(track);
  };

  return (
    <div
      class="now-playing-strip"
      id="nowPlayingStrip"
      title="Jump to playing album"
      role="button"
      tabIndex={0}
      onClick={openAlbum}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openAlbum();
        }
      }}
    >
      <span class="np-strip-note">♫</span>
      <span class="np-strip-text" id="npStripText">
        {display.title} <span class="artist">— {display.artist}</span>
      </span>
    </div>
  );
}
