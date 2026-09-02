import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { albumTranslationCache, isTranslated, userId } from '../stores/state.js';
import { getArtistAlbums, cachedImageUrl } from '../utils/api.js';
import { translatedAlbumText } from '../utils/metadata.js';
import { navigateToView, showAlbumGrid } from '../utils/navigation.js';

export default function ArtistView({ artistId, name }) {
  const [albums, setAlbums] = useState([]);
  const [loadedImages, setLoadedImages] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await getArtistAlbums(userId.value, artistId);
        if (!cancelled) setAlbums(data.Items || []);
      } catch (err) {
        console.error('Failed to load artist albums:', err);
        if (!cancelled) setAlbums([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (artistId) load();
    return () => { cancelled = true; };
  }, [artistId]);

  useEffect(() => {
    albums.forEach((album, idx) => {
      if (album.ImageTags?.Primary) {
        cachedImageUrl(album.Id, 'primary').then(url => {
          setLoadedImages(prev => new Map(prev).set(album.Id, url));
        });
      }
    });
  }, [albums]);

  if (loading) {
    return <div class="status-msg">Loading artist…</div>;
  }

  return (
    <div class="artist-view">
      <div class="crumb">
        <button onClick={() => showAlbumGrid()}>← Library</button>
        <span> / {name || 'Artist'}</span>
      </div>
      {albums.length === 0 ? (
        <div class="status-msg">No albums found for this artist.</div>
      ) : (
        <div class="album-grid">
          {albums.map((album, idx) => {
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
                  <img
                    data-art-id={album.Id}
                    src={loadedImages.get(album.Id) || ''}
                    {...(idx < 6 ? { fetchpriority: "high" } : { loading: "lazy" })}
                    decoding="async"
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
