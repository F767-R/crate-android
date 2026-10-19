import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { albumTranslationCache, isTranslated, userId } from '../stores/state.js';
import { libraryUsingSaved } from '../stores/offline.js';
import { savedArtistAlbums, libraryGeneration } from '../utils/libraryData.js';
import { filterDownloadedAlbums } from '../utils/downloads.js';
import { getArtistAlbums } from '../utils/api.js';
import Artwork from './Artwork.jsx';
import { translatedAlbumText } from '../utils/metadata.js';
import { navigateToView, showAlbumGrid } from '../utils/navigation.js';
import { safeRequestError } from '../utils/request.js';

export default function ArtistView({ artistId, name }) {
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const requestUserId = userId.value;
  const generation = libraryGeneration.value;
  const visibleAlbums = filterDownloadedAlbums(albums);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      setAlbums([]);
      try {
        let data;
        const saved = savedArtistAlbums(artistId);
        if (libraryUsingSaved.value && saved !== null) data = { Items: saved };
        else {
          try { data = await getArtistAlbums(requestUserId, artistId, { signal: controller.signal }); }
          catch (error) {
            if (controller.signal.aborted || saved === null || error?.status === 401 || error?.status === 403) throw error;
            data = { Items: saved }; libraryUsingSaved.value = true;
          }
        }
        if (!Array.isArray(data?.Items)) throw new Error('invalid artist response');
        if (!controller.signal.aborted) setAlbums(data.Items);
      } catch (error) {
        if (!controller.signal.aborted) setError(safeRequestError(error, 'The artist albums could not be loaded. Please retry.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    if (artistId) load();
    else {
      setAlbums([]);
      setLoading(false);
      setError('No artist was selected. Return to the library to choose an artist.');
    }
    return () => controller.abort();
  }, [artistId, requestUserId, retryCount, generation]);

  return (
    <div class="artist-view">
      <div class="crumb">
        <button onClick={() => showAlbumGrid()}>← Library</button>
        <span> / {name || 'Artist'}</span>
      </div>
      {loading ? (
        <div class="status-msg" role="status">Loading artist…</div>
      ) : error ? (
        <div class="status-msg" role="alert">
          <p>{error}</p>
          {artistId && <button onClick={() => setRetryCount(value => value + 1)}>Retry</button>}
        </div>
      ) : visibleAlbums.length === 0 ? (
        <div class="status-msg">No albums found for this artist.</div>
      ) : (
        <div class="album-grid">
          {visibleAlbums.map(album => {
            const display = translatedAlbumText(album, isTranslated.value, albumTranslationCache.value);
            return (
            <div
              class="album-card"
              key={album.Id}
              role="button"
              tabIndex={0}
              onClick={() => navigateToView({ type: 'album', albumId: album.Id, gridReturnMode: 'center', gridReturnAlbumId: album.Id })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToView({ type: 'album', albumId: album.Id, gridReturnMode: 'center', gridReturnAlbumId: album.Id }); } }}
            >
              <div class="art-wrap">
                {album.ImageTags?.Primary ? (
                  <Artwork
                    itemId={album.Id}
                    imageTag={album.ImageTags.Primary}
                    data-art-id={album.Id}
                    alt=""
                  />
                ) : <div class="art-fallback">♪</div>}
              </div>
              <div class="album-info">
                <div class="album-title" data-original-title={album.Name}>{display.title}</div>
                <div class="album-artist" data-original-artist={album.ProductionYear || ''}>
                  {album.ProductionYear || ''}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
