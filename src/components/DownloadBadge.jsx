import { h } from 'preact';
import { downloadedIds } from '../utils/downloads.js';
export default function DownloadBadge({ track }) {
  return downloadedIds.value.has(track.Id)
    ? <span class="download-badge" role="img" title="Downloaded LQ audio" aria-label="Downloaded, low quality">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
        </svg>
      </span>
    : null;
}
