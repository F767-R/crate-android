import { h } from 'preact';
import { lyricsVisible } from '../stores/state.js';
import { armClickSuppression } from '../utils/clickSuppression.js';
import LyricsContent from './LyricsContent.jsx';

export default function LyricsPopup() {
  const open = lyricsVisible.value;
  if (!open) return null;

  const close = () => {
    lyricsVisible.value = false;
    armClickSuppression();
  };

  return (
    <div id="lyricsPopup" class="popup-overlay open">
      <div class="popup-header">
        <h4 id="popupTitle">Lyrics</h4>
        <button id="closePopupBtn" title="Close lyrics" aria-label="Close lyrics" onClick={close}>✕</button>
      </div>
      <LyricsContent active={open} layout="popup" />
    </div>
  );
}
