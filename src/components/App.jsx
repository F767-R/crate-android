import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import LibraryStatus from './LibraryStatus.jsx';
import { restoreSavedLibrary, refreshLibrary, syncLibraryIndex } from '../utils/libraryData.js';
import { libraryUsingSaved } from '../stores/offline.js';
import { attachDownloadListeners } from '../utils/downloads.js';
import Header from './Header.jsx';
import MainView from './MainView.jsx';
import PlayerBar from './PlayerBar.jsx';
import MiniPlayer from './MiniPlayer.jsx';
import LyricsPopup from './LyricsPopup.jsx';
import QueuePanel from './QueuePanel.jsx';
import ContextMenu from './ContextMenu.jsx';
import SleepPanel from './SleepPanel.jsx';
import TranslationEditPanel from './TranslationEditPanel.jsx';
import NowPlayingStrip from './NowPlayingStrip.jsx';
import RequestFailure from './RequestFailure.jsx';
import RecoveryBanner from './RecoveryBanner.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import { userId, musicLibraryId, currentViewState, currentTrack } from '../stores/state.js';
import { TrackArtwork } from './Artwork.jsx';
import { initNativeBridge } from '../utils/nativeBridge.js';
import { initPlayerShim } from '../utils/playerShim.js';
import { getUserId, getMusicLibraryId } from '../utils/api.js';
import { attachPlaybackControlListeners } from '../utils/playbackControls.js';
import { RequestError } from '../utils/request.js';
import { initNativePlayback, nativePlaybackReady } from '../utils/nativePlayback.js';
import { attachAppBackListener } from '../utils/backNavigation.js';

function suppressNativeContextMenu(event) {
  if (!event.target.isContentEditable && !event.target.closest('input, textarea')) event.preventDefault();
}

export default function App() {
  const immersiveLyrics = currentViewState.value.type === 'lyrics';
  const [initialized, setInitialized] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  useEffect(() => attachAppBackListener(), []);
  useEffect(() => attachDownloadListeners(), []);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      setError(null);
      setConnecting(true);
      let restored = initialized;
      try {
        initNativeBridge();
        await initNativePlayback();
        if (controller.signal.aborted) return;
        initPlayerShim();
        attachPlaybackControlListeners();

        if (!initialized) restored = await restoreSavedLibrary({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (restored) setInitialized(true);

        const uid = await getUserId({ signal: controller.signal });
        if (!uid) throw new RequestError('no_user');
        if (controller.signal.aborted) return;
        userId.value = uid;

        const libId = await getMusicLibraryId(uid, { signal: controller.signal });
        if (!libId) throw new RequestError('no_library');
        if (controller.signal.aborted) return;
        musicLibraryId.value = libId;

        await refreshLibrary({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setInitialized(true);
        syncLibraryIndex({ signal: controller.signal }).catch(() => {});
      } catch (err) {
        if (!controller.signal.aborted) {
          if (restored && err?.status !== 401 && err?.status !== 403) libraryUsingSaved.value = true;
          else setError(err);
        }
      } finally {
        if (!controller.signal.aborted) setConnecting(false);
      }
    }

    initialize();
    return () => controller.abort();
  }, [connectionAttempt]);

  if (error && !initialized && !nativePlaybackReady.value) {
    return (
      <div class="app" onContextMenu={suppressNativeContextMenu}>
        <main id="main">
          <RequestFailure title="Could not connect to your library" error={error}
            onRetry={() => setConnectionAttempt(value => value + 1)} />
        </main>
      </div>
    );
  }

  if (!initialized && !nativePlaybackReady.value) {
    return (
      <div class="app" onContextMenu={suppressNativeContextMenu}>
        <header>
          <div class="brand">
            <h1>C.R.A.T.E.</h1>
            <span class="tagline">Custom Remote Audio & Translation Engine</span>
          </div>
        </header>
        <main id="main">
          <div class="status-msg">Connecting to your Jellyfin server…</div>
        </main>
      </div>
    );
  }

  return (
    <div class={`app ${immersiveLyrics ? 'lyrics-mode' : ''}`} onContextMenu={suppressNativeContextMenu}>
      {immersiveLyrics && <div class="lyrics-backdrop" aria-hidden="true"><TrackArtwork track={currentTrack.value} lazy={false} fallback="" /></div>}
      <Header libraryReady={initialized} />
      {initialized && <LibraryStatus connecting={connecting} onReconnect={() => setConnectionAttempt(value => value + 1)} />}
      <RecoveryBanner />
      <NowPlayingStrip />

      <main id="main">
        {error ? <RequestFailure title="Could not connect to your library" error={error}
          onRetry={() => setConnectionAttempt(value => value + 1)} />
          : initialized ? <MainView /> : <div class="status-msg">Connecting to your Jellyfin server…</div>}
      </main>

      <LyricsPopup />
      <QueuePanel />
      <ContextMenu />
      <SleepPanel />
      <TranslationEditPanel />
      <SettingsPanel />

      <PlayerBar />
      <MiniPlayer />
    </div>
  );
}
