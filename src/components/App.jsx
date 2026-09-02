import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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
import { userId, musicLibraryId } from '../stores/state.js';
import { initNativeBridge } from '../utils/nativeBridge.js';
import { initPlayerShim } from '../utils/playerShim.js';
import { getUserId, getMusicLibraryId } from '../utils/api.js';
import { attachPlaybackControlListeners } from '../utils/playbackControls.js';

export default function App() {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function initialize() {
      try {
        window.addEventListener('error', (e) => {
          setError(e.message);
        });

        initNativeBridge();
        initPlayerShim();
        attachPlaybackControlListeners();

        const uid = await getUserId();
        if (!uid) throw new Error('No Jellyfin user was returned by the server.');
        userId.value = uid;

        const libId = await getMusicLibraryId(uid);
        if (!libId) throw new Error('No Jellyfin music library was found for this user.');
        musicLibraryId.value = libId;

        setInitialized(true);
      } catch (err) {
        setError(err.message);
        console.error('Initialization error:', err);
      }
    }

    initialize();
  }, []);

  if (error) {
    return (
      <div class="app">
        <main id="main">
          <div class="status-msg error">
            ⚠️ Error:<br /><code>{error}</code><br />Check console (F12).
          </div>
        </main>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div class="app">
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
    <div class="app">
      <Header />
      <NowPlayingStrip />

      <main id="main">
        <MainView />
      </main>

      <LyricsPopup />
      <QueuePanel />
      <ContextMenu />
      <SleepPanel />
      <TranslationEditPanel />

      <PlayerBar />
      <MiniPlayer />
    </div>
  );
}
