import { h } from 'preact';
import { libraryUsingSaved, librarySaveError, libraryIndexing, libraryIndexError, downloadedOnly } from '../stores/offline.js';
import { downloadsError, downloadsReady, refreshDownloads, setDownloadedOnly } from '../utils/downloads.js';

export default function LibraryStatus({ onReconnect, connecting }) {
  const offline = libraryUsingSaved.value;
  const indexError = libraryIndexError.value && !libraryIndexing.value;
  if (!offline && !indexError && !librarySaveError.value && !downloadsError.value) return null;
  return <section class="library-status" aria-label="Library availability">
    {offline && <div class="library-status-row">
      <span role="status">Saved library</span>
      <button class="download-filter" aria-pressed={downloadedOnly.value}
        onClick={() => setDownloadedOnly(!downloadedOnly.value)}>↓ Downloaded only</button>
    </div>}
    {offline && <p>Browsing saved albums and tracks. Downloaded tracks play in LQ.
      <button class="text-action" disabled={connecting} onClick={onReconnect}>{connecting ? 'Connecting…' : 'Reconnect'}</button>
    </p>}
    {offline && downloadedOnly.value && <p>Showing audio already on this phone. Cached tracks may be removed as storage fills.</p>}
    {indexError && <p role="alert">The offline track index is incomplete. <button class="text-action" disabled={connecting} onClick={onReconnect}>Retry sync</button></p>}
    {librarySaveError.value && <p role="alert">The library could not be saved on this phone. Free some storage, then refresh.</p>}
    {downloadsError.value && <p role="alert">Could not check downloaded audio. <button class="text-action" onClick={refreshDownloads}>Retry</button></p>}
    {offline && downloadedOnly.value && !downloadsReady.value && !downloadsError.value && <p role="status">Checking downloaded audio…</p>}
  </section>;
}
