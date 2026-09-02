import { Fragment, h } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import {
  albumDetailCache,
  albumTranslationCache,
  contextMenuTarget,
  currentTracks,
  isTranslated,
  playbackCurrentTrack,
  trackTranslationCache,
  userId,
} from '../stores/state.js';
import { getAlbumTracks, getItemInfo, cachedImageUrl } from '../utils/api.js';
import { playTrack } from '../utils/playbackControls.js';
import { translatedAlbumText, translatedTrackText } from '../utils/metadata.js';
import { showAlbumGrid } from '../utils/navigation.js';

export default function AlbumDetail({
  albumId,
  centerTrackId = null,
  centerRequestId = 0,
  gridReturnMode = 'restore',
  gridReturnAlbumId = null,
}) {
  const [album, setAlbum] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [artUrl, setArtUrl] = useState('');
  const longPressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);

  const goBack = () => {
    showAlbumGrid({
      restoreScroll: gridReturnMode !== 'center',
      centerAlbumId: gridReturnAlbumId || albumId,
    });
  };

  useEffect(() => {
    async function loadAlbum() {
      setLoading(true);
      try {
        let cached = albumDetailCache.value.get(albumId);
        if (!cached) {
          const [albumInfo, tracksData] = await Promise.all([
            getItemInfo(userId.value, albumId),
            getAlbumTracks(userId.value, albumId),
          ]);
          cached = { ...albumInfo, Items: tracksData.Items || [] };
          albumDetailCache.value.set(albumId, cached);
        }
        setAlbum(cached);
        setTracks(cached.Items || []);

        if (cached.ImageTags?.Primary) {
          const url = await cachedImageUrl(albumId, 'detail');
          setArtUrl(url);
        }
      } catch (err) {
        console.error('Failed to load album:', err);
      } finally {
        setLoading(false);
      }
    }
    loadAlbum();
  }, [albumId]);

  useEffect(() => {
    if (loading || !centerTrackId) return;
    const frame = requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll('.track-row[data-track-id]'))
        .find(element => element.dataset.trackId === centerTrackId);
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [albumId, centerTrackId, centerRequestId, loading, tracks.length]);

  const handlePlay = (index) => {
    const track = tracks[index];
    if (!track) return;
    currentTracks.value = tracks;
    playTrack(track);
  };

  const openContextMenu = (e, track, index) => {
    e.preventDefault();
    const point = e.touches?.[0] || e;
    contextMenuTarget.value = {
      x: point.clientX,
      y: point.clientY,
      track,
      tracks,
      index,
      albumId,
    };
  };

  const trackRowHandlers = (track, index) => ({
    onContextMenu: (e) => openContextMenu(e, track, index),
    onPointerDown: (e) => {
      longPressFiredRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        openContextMenu(e, track, index);
      }, 500);
    },
    onPointerUp: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    },
    onPointerLeave: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    },
  });

  if (loading) {
    return <div class="status-msg">Loading album…</div>;
  }

  if (!album) {
    return <div class="status-msg">Album not found</div>;
  }

  const discCount = new Set(tracks.map(t => t.ParentIndexNumber || 1)).size;
  const multiDisc = discCount > 1;
  const albumDisplay = translatedAlbumText(album, isTranslated.value, albumTranslationCache.value);

  return (
    <div class="album-detail">
      <div class="crumb">
        <button id="backBtn" onClick={goBack}>← All albums</button>
      </div>

      <div class="track-header" data-album-id={album.Id}>
        {artUrl ? (
          <img
            data-detail-art-id={album.Id}
            src={artUrl}
            decoding="async"
            fetchpriority="high"
            alt=""
          />
        ) : <div class="art-fallback">♪</div>}
        <div>
          <h2 data-original-title={album.Name}>{albumDisplay.title}</h2>
          <div class="meta">
            {albumDisplay.artist} · {tracks.length} track{tracks.length === 1 ? '' : 's'}{multiDisc ? ` · ${discCount} discs` : ''}{album.ProductionYear ? ` · ${album.ProductionYear}` : ''}
          </div>
        </div>
      </div>

      <div class="track-list">
        {tracks.map((track, i) => {
          const discNum = track.ParentIndexNumber || 1;
          const previousDiscNum = i > 0 ? (tracks[i - 1].ParentIndexNumber || 1) : null;
          const showDiscHeader = multiDisc && discNum !== previousDiscNum;
          const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);

          return (
            <Fragment key={track.Id}>
              {showDiscHeader && <div class="disc-header">Disc {discNum}</div>}
              <div
                class={`track-row ${track.Id === playbackCurrentTrack.value?.Id ? 'playing' : ''}`}
                data-track-id={track.Id}
                onClick={() => { if (!longPressFiredRef.current) handlePlay(i); }}
                {...trackRowHandlers(track, i)}
              >
                <div class="track-index">
                  <span class="idx">{track.IndexNumber ?? i + 1}</span>
                  <span class="playing-icon">♫</span>
                </div>
                <div class="name">
                  {display.title}
                  {display.artist && <span class="sub">{display.artist}</span>}
                </div>
                <div class="dur">{formatDuration(track.RunTimeTicks)}</div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function formatDuration(ticks) {
  if (!ticks) return '--:--';
  const seconds = Math.floor(ticks / 10000000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
