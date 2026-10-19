import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import SearchResults from '../src/components/SearchResults.jsx';
import { allAlbums, allTracks, allTracksFetched, userId, musicLibraryId } from '../src/stores/state.js';
import styles from '../src/styles.css?inline';

// Local-only fixture: every fetch is intercepted before any component mounts.
// Artwork is synthetic SVG; no Jellyfin/proxy traffic or real music data is used.
const metrics = { requests: 0, active: 0, peak: 0, cancelled: 0 };
globalThis.fetch = async (input, { signal } = {}) => {
  const path = new URL(input, location.href).pathname;
  if (!path.endsWith('/Images/Primary')) return new Response(JSON.stringify({ Items: [] }), { headers: { 'Content-Type': 'application/json' } });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  metrics.requests++;
  metrics.active++;
  metrics.peak = Math.max(metrics.peak, metrics.active);
  const index = Number(path.match(/album-(\d+)/)?.[1] || 0);
  return new Promise((resolve, reject) => {
    const cleanup = () => { metrics.active--; signal?.removeEventListener('abort', cancel); };
    const timer = setTimeout(() => {
      cleanup();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${index * 37 % 360} 35% 30%)"/><circle cx="200" cy="180" r="110" fill="none" stroke="#dfca94" stroke-width="5"/><text x="200" y="350" text-anchor="middle" font-size="36" fill="#fff">Album ${index}</text></svg>`;
      resolve(new Response(new Blob([svg], { type: 'image/svg+xml' }), { headers: { 'Content-Type': 'image/svg+xml' } }));
    }, 40);
    function cancel() {
      clearTimeout(timer);
      cleanup();
      metrics.cancelled++;
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', cancel, { once: true });
  });
};

const style = document.createElement('style');
style.textContent = `${styles}\n.fixture-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.fixture-tools button,.fixture-tools input{font:inherit}.fixture-metrics{font-size:11px;color:var(--muted);width:100%}`;
document.head.appendChild(style);
userId.value = 'fixture-user';
musicLibraryId.value = 'fixture-library';
allAlbums.value = Array.from({ length: 600 }, (_, index) => ({ Id: `album-${index}`, Name: `Album fixture ${String(index).padStart(3, '0')}`, AlbumArtist: 'Preview artist', ImageTags: { Primary: `tag-${index}` } }));
allTracks.value = Array.from({ length: 1500 }, (_, index) => ({
  Id: `track-${index}`,
  Name: `Track fixture ${String(index).padStart(4, '0')}${index % 7 === 0 ? ' — A deliberately long song title to exercise wrapping on a narrow phone display' : ''}`,
  Artists: [index % 5 === 0 ? 'A much longer artist name for a variable-height row' : 'Preview artist'],
  AlbumId: `album-${index % 600}`,
  RunTimeTicks: 1800000000,
}));
allTracksFetched.value = true;

function jump(where) {
  const main = document.getElementById('main');
  if (where === 'top') main.scrollTop = 0;
  if (where === 'middle') main.scrollTop = main.scrollHeight / 2;
  if (where === 'end') main.scrollTop = main.scrollHeight;
  if (where === 'tracks') {
    const tracks = main.querySelector('.track-list');
    if (tracks) main.scrollTop += tracks.getBoundingClientRect().top - main.getBoundingClientRect().top;
  }
}

function Preview() {
  const [query, setQuery] = useState(new URLSearchParams(location.search).get('query') || 'fixture');
  return <div class="app">
    <header class="fixture-tools">
      <strong>600 albums · 1,500 tracks</strong>
      <input aria-label="Fixture search" value={query} onInput={event => setQuery(event.currentTarget.value)} />
      <button onClick={() => setQuery('album')}>Albums only</button>
      <button onClick={() => setQuery('track')}>Tracks only</button>
      {['top', 'tracks', 'middle', 'end'].map(where => <button key={where} onClick={() => jump(where)}>{where}</button>)}
      <div id="fixtureMetrics" class="fixture-metrics" role="status" />
    </header>
    <main id="main"><SearchResults query={query} /></main>
  </div>;
}

window.__foundationPreview = {
  snapshot: () => ({
    ...metrics,
    mountedAlbums: document.querySelectorAll('.album-card').length,
    mountedTracks: document.querySelectorAll('.track-row').length,
    loadedImages: document.querySelectorAll('img').length,
    brokenImages: [...document.querySelectorAll('img')].filter(image => image.complete && !image.naturalWidth).length,
    firstTrack: document.querySelector('.track-row')?.dataset.trackId || null,
    lastTrack: [...document.querySelectorAll('.track-row')].at(-1)?.dataset.trackId || null,
  }),
  jump,
};
render(<Preview />, document.getElementById('app'));
setInterval(() => {
  const summary = window.__foundationPreview.snapshot();
  document.getElementById('fixtureMetrics').textContent = `Artwork requests: ${summary.requests} · active/peak: ${summary.active}/${summary.peak} · mounted albums/tracks: ${summary.mountedAlbums}/${summary.mountedTracks} · broken: ${summary.brokenImages}`;
}, 250);
