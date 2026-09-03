import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { currentViewState, allAlbums, userId, musicLibraryId } from '../stores/state.js';
import { getAlbums, getArtistAlbums, cachedImageUrl } from '../utils/api.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import TrackList from './TrackList.jsx';
import SearchResults from './SearchResults.jsx';
import ArtistView from './ArtistView.jsx';
import LyricsView from './LyricsView.jsx';

export default function MainView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadInitial() {
      try {
        setError(null);
        const albums = await getAlbums(userId.value, musicLibraryId.value);
        allAlbums.value = albums.Items || [];
        setLoading(false);
      } catch (err) {
        console.error('Failed to load albums:', err);
        setError(err.message || 'Failed to load the music library.');
        setLoading(false);
      }
    }
    loadInitial();
  }, []);

  // Read signals before early return to establish subscription
  const view = currentViewState.value;

  if (loading) {
    return <div class="status-msg">Loading library…</div>;
  }

  if (error) {
    return <div class="status-msg error">⚠️ {error}</div>;
  }

  let content;
  let viewKey;

  switch (view.type) {
    case 'grid':
      viewKey = 'grid';
      content = (
        <AlbumGrid
          albums={allAlbums.value}
          centerAlbumId={view.centerAlbumId}
          centerRequestId={view.gridRequestId}
        />
      );
      break;
    case 'album':
      viewKey = `album-${view.albumId}`;
      content = (
        <AlbumDetail
          albumId={view.albumId}
          centerTrackId={view.centerTrackId}
          centerRequestId={view.centerRequestId}
          gridReturnMode={view.gridReturnMode}
          gridReturnAlbumId={view.gridReturnAlbumId}
        />
      );
      break;
    case 'tracks':
      viewKey = 'tracks';
      content = <TrackList />;
      break;
    case 'search':
      viewKey = 'search';
      content = <SearchResults query={view.query} />;
      break;
    case 'artist':
      viewKey = `artist-${view.artistId}`;
      content = <ArtistView artistId={view.artistId} name={view.name} />;
      break;
    case 'lyrics':
      viewKey = 'lyrics';
      content = <LyricsView />;
      break;
    default:
      viewKey = 'grid';
      content = <AlbumGrid albums={allAlbums.value} />;
  }

  return <div class="view-stage" key={viewKey}>{content}</div>;
}
