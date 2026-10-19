import { filterDownloadedTracks } from '../utils/downloads.js';
import { h } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { contextMenuTarget, currentViewState } from '../stores/state.js';
import { playFromHere, playNextInQueue, addToQueue } from '../utils/playbackControls.js';
import { ensureAlbumDetailLoaded, getLibraryGeneration, libraryGeneration } from '../utils/libraryData.js';
import { createContextMenuActions } from '../utils/contextMenuActions.js';
import { safeRequestError } from '../utils/request.js';
import { beginPlaybackCommand, isPlaybackCommandCurrent } from '../utils/playbackCommands.js';

export default function ContextMenu() {
  const target = contextMenuTarget.value;
  const view = currentViewState.value;
  const generation = libraryGeneration.value;
  const [status, setStatus] = useState({ target: null, loading: false, error: null, action: null });
  const actionsRef = useRef(null);
  const navigationRef = useRef({ view, generation });
  if (!actionsRef.current) actionsRef.current = createContextMenuActions({
    getTarget: () => contextMenuTarget.value,
    getView: () => currentViewState.value,
    getGeneration: getLibraryGeneration,
    loadAlbum: async (...args) => {
      const album = await ensureAlbumDetailLoaded(...args);
      return { ...album, Items: filterDownloadedTracks(album.Items) };
    },
    playFromHere,
    playNext: playNextInQueue,
    addToQueue,
    close: closedTarget => { if (contextMenuTarget.value === closedTarget) contextMenuTarget.value = null; },
    onState: setStatus,
    beginPlaybackCommand,
    isPlaybackCommandCurrent,
  });

  useLayoutEffect(() => {
    setStatus({ target, loading: false, error: null, action: null });
    return () => actionsRef.current.cancel();
  }, [target]);

  useLayoutEffect(() => {
    if (navigationRef.current.view !== view || navigationRef.current.generation !== generation) {
      contextMenuTarget.value = null;
      actionsRef.current.cancel();
    }
    navigationRef.current = { view, generation };
  }, [view, generation]);

  if (!target) return null;
  const currentStatus = status.target === target ? status : {};
  const loading = Boolean(currentStatus.loading);
  const error = currentStatus.error;
  const errorMessage = error?.code === 'empty_album'
    ? 'This album has no tracks. Refresh the library or retry.'
    : safeRequestError(error, 'The selected music could not be loaded. Please retry.');

  return (
    <div
      id="contextMenu"
      class="context-menu open"
      aria-busy={loading}
      style={`left: ${Math.max(10, Math.min(target.x, window.innerWidth - 200))}px; top: ${Math.max(10, Math.min(target.y, window.innerHeight - (error ? 310 : 200)))}px;`}
    >
      <button id="ctxPlayFromHere" disabled={loading} onClick={() => actionsRef.current.run('play')}>Play from here</button>
      <button id="ctxPlayNext" disabled={loading} onClick={() => actionsRef.current.run('next')}>Play next</button>
      <button id="ctxAddToQueue" disabled={loading} onClick={() => actionsRef.current.run('queue')}>Add to queue</button>
      {loading && <div role="status" class="context-menu-status">Loading selected music…</div>}
      {error && <div class="context-menu-status" role="alert">
        <p>{errorMessage}</p>
        <button onClick={() => actionsRef.current.run(currentStatus.action)}>Retry</button>
      </div>}
    </div>
  );
}
