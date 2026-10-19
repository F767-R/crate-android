import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { currentViewState, allAlbums } from '../stores/state.js';
import { ensureAlbumsLoaded, libraryGeneration } from '../utils/libraryData.js';
import { visibleLibraryAlbums } from '../utils/downloads.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import TrackList from './TrackList.jsx';
import SearchResults from './SearchResults.jsx';
import ArtistView from './ArtistView.jsx';
import LyricsView from './LyricsView.jsx';
import RequestFailure from './RequestFailure.jsx';

export default function MainView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const generation = libraryGeneration.value;

  useEffect(() => {
    const controller = new AbortController();
    async function loadInitial() {
      try {
        setError(null);
        setLoading(true);
        await ensureAlbumsLoaded({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted || err?.code === 'aborted') return;
        setError(err);
        setLoading(false);
      }
    }
    loadInitial();
    return () => controller.abort();
  }, [attempt, generation]);

  // Read signals before early return to establish subscription
  const view = currentViewState.value;

  if (loading && !allAlbums.value.length) {
    return <div class="status-msg">Loading library…</div>;
  }

  if (error && !allAlbums.value.length) {
    return <RequestFailure title="Could not load the music library" error={error}
      onRetry={() => setAttempt(value => value + 1)} />;
  }

  let content;
  let viewKey;

  switch (view.type) {
    case 'grid':
      viewKey = 'grid';
      content = (
        <AlbumGrid
          albums={visibleLibraryAlbums.value}
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
      content = <AlbumGrid albums={visibleLibraryAlbums.value} />;
  }

  return <>
    {error && <RequestFailure title="Could not refresh the music library" error={error}
      onRetry={() => setAttempt(value => value + 1)} />}
    <div class="view-stage" key={`${viewKey}:${generation}`}>{content}</div>
  </>;
}
