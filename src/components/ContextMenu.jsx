import { h } from 'preact';
import { contextMenuTarget } from '../stores/state.js';
import { playFromHere, playNextInQueue, addToQueue } from '../utils/playbackControls.js';

export default function ContextMenu() {
  const target = contextMenuTarget.value;
  if (!target) return null;

  const close = () => { contextMenuTarget.value = null; };

  const handlePlayFromHere = () => {
    if (target.tracks && typeof target.index === 'number') {
      playFromHere(target.tracks, target.index);
    } else if (target.track) {
      playFromHere([target.track], 0);
    }
    close();
  };

  const handlePlayNext = () => {
    if (target.track) playNextInQueue(target.track, target.albumId);
    close();
  };

  const handleAddToQueue = () => {
    if (target.track) addToQueue(target.track, target.albumId);
    close();
  };

  return (
    <div
      id="contextMenu"
      class="context-menu open"
      style={`left: ${Math.max(10, Math.min(target.x, window.innerWidth - 200))}px; top: ${Math.max(10, Math.min(target.y, window.innerHeight - 170))}px;`}
    >
      <button id="ctxPlayFromHere" onClick={handlePlayFromHere}>Play from here</button>
      <button id="ctxPlayNext" onClick={handlePlayNext}>Play next</button>
      <button id="ctxAddToQueue" onClick={handleAddToQueue}>Add to queue</button>
    </div>
  );
}
