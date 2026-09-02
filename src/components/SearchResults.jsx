import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  albumTranslationCache,
  currentTracks,
  isTranslated,
  trackTranslationCache,
  userId,
} from '../stores/state.js';
import { searchItems, cachedImageUrl } from '../utils/api.js';
import { playTrack } from '../utils/playbackControls.js';
import { translatedAlbumText, translatedTrackText } from '../utils/metadata.js';
import { navigateToView } from '../utils/navigation.js';

const openAlbum = album => {
  navigateToView({
    type: 'album',
    albumId: album.Id,
    gridReturnMode: 'center',
    gridReturnAlbumId: album.Id,
  });
};

export default function SearchResults({ query }) {
  const [results, setResults] = useState({ Items: [] });
  const [loading, setLoading] = useState(true);
  const [loadedImages, setLoadedImages] = useState(new Map());

  useEffect(() => {
    async function search() {
      setLoading(true);
      try {
        const data = await searchItems(userId.value, query);
        setResults(data);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }
    if (query) search();
  }, [query]);

  useEffect(() => {
    const items = results.Items || [];
    items.forEach((item, idx) => {
      if (item.Type === 'MusicAlbum' && item.ImageTags?.Primary) {
        cachedImageUrl(item.Id, 'primary').then(url => {
          setLoadedImages(prev => new Map(prev).set(item.Id, url));
        });
      }
    });
  }, [results.Items]);

  if (loading) {
    return <div class="status-msg">Searching…</div>;
  }

  const items = results.Items || [];
  const albums = items.filter(i => i.Type === 'MusicAlbum');
  const artists = items.filter(i => i.Type === 'MusicArtist');
  const tracks = items.filter(i => i.Type === 'Audio');

  const handleTrackClick = async (track) => {
    // Make the search-result tracks the current track list so next/prev
    // continues from this search context.
    currentTracks.value = tracks;
    await playTrack(track);
  };

  return (
    <div class="search-results">
      {albums.length > 0 && (
        <section>
          <h3>Albums ({albums.length})</h3>
          <div class="album-grid">
            {albums.map((album, idx) => {
              const display = translatedAlbumText(album, isTranslated.value, albumTranslationCache.value);
              return (
              <div class="album-card" key={album.Id} onClick={() => openAlbum(album)}>
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
                  <div class="album-artist" data-original-artist={display.artist}>
                    {display.artist}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}
      {artists.length > 0 && (
        <section>
          <h3>Artists ({artists.length})</h3>
          <div class="artist-list">
            {artists.map(artist => (
              <div class="artist-item" key={artist.Id} onClick={() => navigateToView({ type: 'artist', artistId: artist.Id, name: artist.Name })}>
                <div class="artist-name">{artist.Name}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {tracks.length > 0 && (
        <section>
          <h3>Tracks ({tracks.length})</h3>
          <div class="track-list">
            {tracks.map((track, i) => {
              const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
              return (
              <div class="track-row" key={track.Id} onClick={() => handleTrackClick(track)}>
                <div class="track-number">{i + 1}</div>
                <div class="track-info">
                  <div class="track-title">{display.title}</div>
                  <div class="track-artist">{display.artist}</div>
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}
      {albums.length === 0 && artists.length === 0 && tracks.length === 0 && (
        <div class="status-msg">No results found</div>
      )}
    </div>
  );
}
