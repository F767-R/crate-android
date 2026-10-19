import { h } from 'preact';
import LyricsSourcePicker from './LyricsSourcePicker.jsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import { settingsVisible, translationBusy, translationCacheOnly, translationEditVisible, currentTrack, translationError, userId, musicLibraryId } from '../stores/state.js';
import { nativeClearCache, nativeGetCacheStats, nativeSetCacheLimit, openNativeLibrary } from '../utils/nativeBridge.js';
import { setTranslationCacheOnly, translateAllMetadata } from '../utils/translationControls.js';
import { setDeeplServer } from '../config.js';
import { safeRequestError } from '../utils/request.js';
import { armClickSuppression } from '../utils/clickSuppression.js';

const MIB = 1024 * 1024;
const formatSize = bytes => {
  const size = Math.max(0, Number(bytes) || 0);
  return `${size === 0 ? '0' : size < MIB ? '<1' : Math.round(size / MIB)} MiB`;
};

export default function SettingsPanel() {
  const visible = settingsVisible.value;
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const requestId = useRef(0);

  const close = () => {
    settingsVisible.value = false;
    armClickSuppression();
  };

  async function updateStats(action = nativeGetCacheStats, success = '') {
    const id = ++requestId.current;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const next = await action();
      if (id !== requestId.current || !settingsVisible.value) return;
      setStats(next);
      setMessage(success);
    } catch (failure) {
      if (id === requestId.current && settingsVisible.value) setError(failure);
    } finally {
      if (id === requestId.current && settingsVisible.value) setBusy(false);
    }
  }

  useEffect(() => {
    if (!visible) return undefined;
    const previousFocus = document.activeElement;
    // aria-modal alone does not consistently isolate WebView accessibility navigation.
    const overlay = dialogRef.current?.parentElement;
    const background = [...(overlay?.parentElement?.children || [])]
      .filter(element => element !== overlay && !['playerBar', 'miniPlayer'].includes(element.id))
      .map(element => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    setStats(null);
    setConfirmClear(false);
    setNativeError('');
    updateStats();
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = [...(dialogRef.current?.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ) || [])];
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      requestId.current++;
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      previousFocus?.focus?.();
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <div class="settings-overlay" onClick={event => {
      if (event.target === event.currentTarget) close();
    }}>
      <section class="settings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div class="settings-heading">
          <h2 id="settingsTitle">Settings</h2>
          <button ref={closeRef} class="notice-dismiss" aria-label="Close settings" onClick={close}>✕</button>
        </div>
        <div class="settings-section">
          <h3>Lyrics</h3>
          <LyricsSourcePicker />
        </div>
        <div class="settings-section">
          <h3>Translations</h3>
          <label class="setting-checkbox">
            <input type="checkbox" checked={translationCacheOnly.value} disabled={translationBusy.value}
              onChange={event => setTranslationCacheOnly(event.currentTarget.checked)} />
            <span>Use saved translations only</span>
          </label>
          <p>No translation requests are sent in this mode. Labels already saved on this phone remain searchable; missing labels use their original text.</p>
          <p class="settings-hint">Successful translations are saved automatically. This setting does not modify your PC proxy or refill DeepL quota.</p>
          <div class="settings-actions">
            <button id="editTranslateBtn" class="action-button secondary" disabled={!currentTrack.value || translationBusy.value} onClick={() => {
              settingsVisible.value = false;
              translationEditVisible.value = true;
            }}>Edit current track translation</button>
            <button id="refreshTranslationsBtn" class="action-button secondary"
              disabled={translationBusy.value || translationCacheOnly.value || !userId.value || !musicLibraryId.value}
              onClick={() => translateAllMetadata({ force: true })}>Request fresh translations</button>
            <button id="translateServerBtn" class="action-button secondary" disabled={translationBusy.value}
              onClick={() => setDeeplServer()}>Change translation server</button>
          </div>
          <p class="settings-hint">Fresh translations request new labels for the whole library and use translation quota. Unavailable while saved-only mode is enabled.</p>
          {translationBusy.value && <p role="status">Translating library…</p>}
          {translationError.value && <p role="alert">{translationError.value.message}</p>}
        </div>
        <div class="settings-section">
          <h3>Audio cache</h3>
          <p>Recently played low-quality audio is saved for faster playback. Original music on your server is never deleted.</p>
          {busy && <p role="status">Updating cache information…</p>}
          {stats && (
            <>
              <dl class="cache-stats">
                <div><dt>Audio</dt><dd>{formatSize(stats.audioBytes)} / {formatSize(stats.audioLimitBytes)}</dd></div>
                <div><dt>Artwork</dt><dd>{formatSize(stats.artworkBytes)} / {formatSize(stats.artworkLimitBytes)}</dd></div>
              </dl>
              <label class="setting-row" for="cacheLimit">Audio storage limit
                <select id="cacheLimit" value={stats.audioLimitBytes} disabled={busy} onChange={event => {
                  const limit = Number(event.currentTarget.value);
                  updateStats(() => nativeSetCacheLimit(limit), 'Storage limit saved. Older unpinned audio is removed as needed.');
                }}>
                  {[128, 256, 512, 1024].map(size => <option key={size} value={size * MIB}>{size === 1024 ? '1 GiB' : `${size} MiB`}</option>)}
                </select>
              </label>
              <p class="settings-hint">Lowering the limit can remove older cached audio. The file currently playing is protected.</p>
              {confirmClear ? (
                <div class="cache-confirm">
                  <p>Remove downloaded audio and artwork? Current playback files may remain; other music will download again when played.</p>
                  <div class="settings-actions">
                    <button class="action-button" disabled={busy} onClick={() => {
                      setConfirmClear(false);
                      updateStats(nativeClearCache, 'Cache cleared where safe. Current playback files or finishing cancelled downloads may remain.');
                    }}>Clear cached files</button>
                    <button class="action-button secondary" onClick={() => setConfirmClear(false)}>Cancel</button>
                  </div>
                </div>
              ) : <button class="action-button secondary" disabled={busy} onClick={() => setConfirmClear(true)}>Clear cache…</button>}
            </>
          )}
          {error && <div role="alert" class="settings-error">
            <p>{safeRequestError(error, 'Could not read or update the cache. Please retry.')}</p>
            <button class="action-button" disabled={busy} onClick={() => updateStats()}>Retry cache connection</button>
          </div>}
          {message && <p role="status">{message}</p>}
        </div>
        <div class="settings-section">
          <h3>Native interface preview</h3>
          <p>Try native album browsing and playback. Lyrics, translations, offline browsing and queue editing are still available in the current interface.</p>
          <button class="action-button secondary" onClick={async () => {
            setNativeError('');
            try { await openNativeLibrary(); close(); }
            catch (_) { setNativeError('Could not open the native preview. Install the updated Android app and retry.'); }
          }}>Try native interface</button>
          {nativeError && <p role="alert">{nativeError}</p>}
        </div>
      </section>
    </div>
  );
}
