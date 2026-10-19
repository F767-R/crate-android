import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  albumTranslationCache,
  allAlbums,
  allTracks,
  allTracksFetched,
  currentTracks,
  isTranslated,
  playbackTrackId,
  searchQuery,
  trackTranslationCache,
} from '../stores/state.js';
import DownloadBadge from './DownloadBadge.jsx';
import { visibleLibraryAlbums, visibleLibraryTracks } from '../utils/downloads.js';
import { downloadedOnly } from '../stores/offline.js';
import { useRowInteractions } from '../utils/useRowInteractions.js';
import { formatDuration } from '../utils/api.js';
import { ensureAllTracksLoaded, libraryGeneration } from '../utils/libraryData.js';
import { createLibrarySearchSelector } from '../utils/librarySearch.js';
import { playTrack } from '../utils/playbackControls.js';
import { translatedAlbumText, translatedTrackText } from '../utils/metadata.js';
import { navigateToView, showAlbumGrid } from '../utils/navigation.js';
import RequestFailure from './RequestFailure.jsx';
import Artwork from './Artwork.jsx';
import WindowedList from './WindowedList.jsx';
import WindowedAlbumGrid from './WindowedAlbumGrid.jsx';

const openAlbum = album => {
  navigateToView({
    type: 'album',
    albumId: album.Id,
    gridReturnMode: 'center',
    gridReturnAlbumId: album.Id,
  });
};

export default function SearchResults({ query }) {
  const tracksFetched = allTracksFetched.value;
  const generation = libraryGeneration.value;
  const [loading, setLoading] = useState(!tracksFetched);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const searchRef = useRef(null);
  if (!searchRef.current) searchRef.current = createLibrarySearchSelector();
  const contextMenuHandlers = useRowInteractions([query, generation, downloadedOnly.value]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError(null);
    setLoading(!tracksFetched);
    ensureAllTracksLoaded({ signal: controller.signal })
      .catch(err => {
        if (active && err?.code !== 'aborted') setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; controller.abort(); };
  }, [query, tracksFetched, attempt, generation]);

  const results = searchRef.current(
    query,
    visibleLibraryAlbums.value,
    visibleLibraryTracks.value,
    albumTranslationCache.value,
    trackTranslationCache.value,
  );
  const backToAlbums = () => {
    searchQuery.value = '';
    showAlbumGrid({ restoreScroll: true });
  };

  const handleTrackClick = async track => {
    currentTracks.value = results.tracks;
    await playTrack(track);
  };

  return (
    <div class="search-results">
      <div class="crumb">
        <button id="backBtn" onClick={backToAlbums}>← All albums</button>
        <span>Results for “{query}”</span>
      </div>

      {loading ? (
        <div class="status-msg">Searching…</div>
      ) : error ? (
        <RequestFailure title="Could not load tracks for search" error={error}
          onRetry={() => setAttempt(value => value + 1)} />
      ) : results.albums.length === 0 && results.tracks.length === 0 ? (
        <div class="status-msg">{downloadedOnly.value ? "No downloaded tracks matched." : "Nothing matched."}</div>
      ) : (
        <>
          {results.albums.length > 0 && (
            <div style="margin-bottom:30px">
              <WindowedAlbumGrid albums={results.albums} renderAlbum={album => {
                const display = translatedAlbumText(album, isTranslated.value, albumTranslationCache.value);
                const activate = () => openAlbum(album);
                return (
                  <div
                    class="album-card"
                    key={album.Id}
                    role="button"
                    tabIndex={0}
                    {...contextMenuHandlers({
                      kind: 'album',
                      albumId: album.Id,
                    }, activate)}
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
                    <div class="album-title" data-original-title={album.Name}>{display.title}</div>
                    <div class="album-artist" data-original-artist={display.artist}>{display.artist}</div>
                  </div>
                );
              }} />
            </div>
          )}

          {results.tracks.length > 0 && (
            <WindowedList className="track-list" items={results.tracks} itemKey={track => track.Id} renderItem={(track, index) => {
                const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
                const activate = () => handleTrackClick(track);
                return (
                  <div
                    class={`track-row ${playbackTrackId.value === track.Id ? 'playing' : ''}`}
                    data-track-id={track.Id}
                    key={track.Id}
                    role="button"
                    tabIndex={0}
                    {...contextMenuHandlers({
                      track,
                      tracks: results.tracks,
                      index,
                      albumId: track.AlbumId || null,
                    }, activate)}
                  >
                    <span class="track-index">
                      <span class="idx">{track.IndexNumber ?? (index + 1)}</span>
                      {track.ParentIndexNumber > 1 && <span class="disc-index">D{track.ParentIndexNumber}</span>}
                      <span class="playing-icon">♫</span>
                    </span>
                    <span class="name">
                      {display.title}<DownloadBadge track={track} /><span class="sub">{display.artist}</span>
                    </span>
                    <span class="dur">{formatDuration(track.RunTimeTicks)}</span>
                  </div>
                );
              }} />
          )}
        </>
      )}
    </div>
  );
}
