import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  albumDetailCache,
  albumTranslationCache,
  allAlbums,
  allTracks,
  allTracksFetched,
  contextMenuTarget,
  currentTracks,
  isTranslated,
  playbackTrackId,
  searchQuery,
  trackTranslationCache,
} from '../stores/state.js';
import { cachedImageUrl, formatDuration } from '../utils/api.js';
import { ensureAllTracksLoaded } from '../utils/libraryData.js';
import { searchLibrary } from '../utils/librarySearch.js';
import { playTrack } from '../utils/playbackControls.js';
import { translatedAlbumText, translatedTrackText } from '../utils/metadata.js';
import { navigateToView, showAlbumGrid } from '../utils/navigation.js';

const activateWithKeyboard = action => event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
};

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
  const [loading, setLoading] = useState(!tracksFetched);
  const [error, setError] = useState(null);
  const [loadedImages, setLoadedImages] = useState(new Map());
  const longPressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(!tracksFetched);
    ensureAllTracksLoaded()
      .catch(err => {
        if (active) setError(err.message || 'Failed to load tracks for search.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [query, tracksFetched]);

  const results = searchLibrary(
    query,
    allAlbums.value,
    allTracks.value,
    albumTranslationCache.value,
    trackTranslationCache.value,
  );
  const albumImageKey = results.albums
    .filter(album => album.ImageTags?.Primary)
    .map(album => album.Id)
    .join('|');

  useEffect(() => {
    let active = true;
    setLoadedImages(new Map());
    for (const album of results.albums) {
      if (!album.ImageTags?.Primary) continue;
      cachedImageUrl(album.Id, 'primary').then(url => {
        if (!active) return;
        setLoadedImages(previous => {
          const next = new Map(previous);
          next.set(album.Id, url);
          return next;
        });
      });
    }
    return () => { active = false; };
  }, [albumImageKey]);

  const backToAlbums = () => {
    searchQuery.value = '';
    showAlbumGrid({ restoreScroll: true });
  };

  const handleTrackClick = async track => {
    currentTracks.value = results.tracks;
    await playTrack(track);
  };

  const openContextMenu = (event, target) => {
    event.preventDefault();
    const point = event.touches?.[0] || event;
    contextMenuTarget.value = {
      x: point.clientX,
      y: point.clientY,
      ...target,
    };
  };

  const contextMenuHandlers = target => ({
    onContextMenu: event => openContextMenu(event, target),
    onPointerDown: event => {
      longPressFiredRef.current = false;
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        longPressFiredRef.current = true;
        openContextMenu(event, target);
      }, 500);
    },
    onPointerUp: () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    },
    onPointerCancel: () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    },
    onPointerLeave: () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    },
  });

  return (
    <div class="search-results">
      <div class="crumb">
        <button id="backBtn" onClick={backToAlbums}>← All albums</button>
        <span>Results for “{query}”</span>
      </div>

      {loading ? (
        <div class="status-msg">Searching…</div>
      ) : error ? (
        <div class="status-msg error">Failed to load tracks for search.<br /><code>{error}</code></div>
      ) : results.albums.length === 0 && results.tracks.length === 0 ? (
        <div class="status-msg">Nothing matched.</div>
      ) : (
        <>
          {results.albums.length > 0 && (
            <div class="album-grid" style="margin-bottom:30px">
              {results.albums.map((album, index) => {
                const display = translatedAlbumText(album, isTranslated.value, albumTranslationCache.value);
                const activate = () => openAlbum(album);
                const albumTracks = albumDetailCache.value.get(album.Id) || [];
                return (
                  <div
                    class="album-card"
                    key={album.Id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!longPressFiredRef.current) activate(); }}
                    onKeyDown={activateWithKeyboard(activate)}
                    {...contextMenuHandlers({
                      track: albumTracks[0] || null,
                      tracks: albumTracks,
                      index: 0,
                      albumId: album.Id,
                    })}
                  >
                    <div class="art-wrap">
                      {album.ImageTags?.Primary ? (
                        <img
                          data-art-id={album.Id}
                          src={loadedImages.get(album.Id) || ''}
                          {...(index < 6 ? { fetchpriority: 'high' } : { loading: 'lazy' })}
                          decoding="async"
                          alt=""
                        />
                      ) : <div class="art-fallback">♪</div>}
                    </div>
                    <div class="album-title" data-original-title={album.Name}>{display.title}</div>
                    <div class="album-artist" data-original-artist={display.artist}>{display.artist}</div>
                  </div>
                );
              })}
            </div>
          )}

          {results.tracks.length > 0 && (
            <div class="track-list">
              {results.tracks.map((track, index) => {
                const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);
                    const activate = () => handleTrackClick(track);
                return (
                  <div
                    class={`track-row ${playbackTrackId.value === track.Id ? 'playing' : ''}`}
                    key={track.Id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!longPressFiredRef.current) activate(); }}
                    onKeyDown={activateWithKeyboard(activate)}
                    {...contextMenuHandlers({
                      track,
                      tracks: results.tracks,
                      index,
                      albumId: track.AlbumId || null,
                    })}
                  >
                    <span class="track-index">
                      <span class="idx">{track.IndexNumber ?? (index + 1)}</span>
                      <span class="playing-icon">♫</span>
                    </span>
                    <span class="name">
                      {display.title}<span class="sub">{display.artist}</span>
                    </span>
                    <span class="dur">{formatDuration(track.RunTimeTicks)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
