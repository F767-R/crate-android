// Local visual fixture. No request reaches a real server or phone cache.
import { h, render } from 'preact';
import '../src/styles.css';
const MIB = 1024 * 1024;
let stats = { audioBytes: 92 * MIB, artworkBytes: 4 * MIB, audioLimitBytes: 512 * MIB, artworkLimitBytes: 64 * MIB };
window.Capacitor = { Plugins: { MediaBridge: {
  async getCacheStats() { return { ...stats }; },
  async setCacheLimit({ audioLimitBytes }) { stats.audioLimitBytes = audioLimitBytes; return { ...stats }; },
  async clearCache() { stats.audioBytes = 3 * MIB; stats.artworkBytes = 0; return { ...stats }; },
} } };
window.fetch = async () => { throw new TypeError('Fixture offline'); };
const { default: Header } = await import('../src/components/Header.jsx');
const { default: SettingsPanel } = await import('../src/components/SettingsPanel.jsx');
const { default: RecoveryBanner } = await import('../src/components/RecoveryBanner.jsx');
const { default: RequestFailure } = await import('../src/components/RequestFailure.jsx');
const { settingsVisible, playbackError, translationError } = await import('../src/stores/state.js');
settingsVisible.value = true;
playbackError.value = new Error('Fixture playback error');
translationError.value = { message: 'The translation quota has been reached. Saved translations remain available.', retryable: false };
render(<div class="app"><Header /><RecoveryBanner /><main>
  <RequestFailure title="Could not load albums" error={{ code: 'network' }} onRetry={() => { settingsVisible.value = true; }} />
</main><SettingsPanel /></div>, document.getElementById('app'));
