import { Fragment, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  albumTranslationCache,
  currentTracks,
  isTranslated,
  playbackCurrentTrack,
  trackTranslationCache,
} from '../stores/state.js';
import DownloadBadge from './DownloadBadge.jsx';
import { downloadedOnly } from '../stores/offline.js';
import { filterDownloadedTracks } from '../utils/downloads.js';
import Artwork from './Artwork.jsx';
import { formatDuration } from '../utils/api.js';
import { useRowInteractions } from '../utils/useRowInteractions.js';
import { ensureAlbumDetailLoaded, libraryGeneration } from '../utils/libraryData.js';
import { playTrack } from '../utils/playbackControls.js';
import { translatedAlbumText, translatedTrackText } from '../utils/metadata.js';
import { showAlbumGrid } from '../utils/navigation.js';
import { safeRequestError } from '../utils/request.js';

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
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const generation = libraryGeneration.value;
  const visibleTracks = filterDownloadedTracks(tracks);
  const trackRowHandlers = useRowInteractions([albumId, generation, tracks, downloadedOnly.value]);

  const goBack = () => {
    showAlbumGrid({
      restoreScroll: gridReturnMode !== 'center',
      centerAlbumId: gridReturnAlbumId || albumId,
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    async function loadAlbum() {
      setLoading(true);
      setError('');
      setAlbum(null);
      setTracks([]);
      try {
        const cached = await ensureAlbumDetailLoaded(albumId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAlbum(cached);
        setTracks(cached.Items || []);
      } catch (error) {
        if (!controller.signal.aborted && error?.code !== 'aborted') setError(safeRequestError(error, 'The album could not be loaded. Please retry.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    loadAlbum();
    return () => controller.abort();
  }, [albumId, generation, retryCount]);

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
    const track = visibleTracks[index];
    if (!track) return;
    currentTracks.value = visibleTracks;
    playTrack(track);
  };

  if (loading || error || !album) {
    return (
      <div class="album-detail">
        <div class="crumb"><button onClick={goBack}>← All albums</button></div>
        <div class="status-msg" role={error ? 'alert' : 'status'}>
          <p>{loading ? 'Loading album…' : error || 'Album not found.'}</p>
          {!loading && <button onClick={() => setRetryCount(value => value + 1)}>Retry</button>}
        </div>
      </div>
    );
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
        {album.ImageTags?.Primary ? (
          <Artwork
            itemId={album.Id}
            imageTag={album.ImageTags.Primary}
            size="detail"
            data-detail-art-id={album.Id}
            alt=""
          />
        ) : <div class="art-fallback">♪</div>}
        <div>
          <h2 data-original-title={album.Name}>{albumDisplay.title}</h2>
          {album.ProductionYear ? <div class="album-year">{album.ProductionYear}</div> : null}
          {albumDisplay.artist.length > 110 ? (
            <details class="album-credits" key={albumId}>
              <summary>Artist credits</summary>
              <div class="meta">{albumDisplay.artist}</div>
            </details>
          ) : <div class="meta">{albumDisplay.artist}</div>}
        </div>
      </div>

      {downloadedOnly.value && visibleTracks.length === 0 && <p class="status-msg">No downloaded tracks in this album yet.</p>}
      <div class="track-list">
        {visibleTracks.map((track, i) => {
          const discNum = track.ParentIndexNumber || 1;
          const previousDiscNum = i > 0 ? (visibleTracks[i - 1].ParentIndexNumber || 1) : null;
          const showDiscHeader = multiDisc && discNum !== previousDiscNum;
          const display = translatedTrackText(track, isTranslated.value, trackTranslationCache.value);

          return (
            <Fragment key={track.Id}>
              {showDiscHeader && <div class="disc-header">Disc {discNum}</div>}
              <div
                class={`track-row ${track.Id === playbackCurrentTrack.value?.Id ? 'playing' : ''}`}
                data-track-id={track.Id}
                role="button"
                tabIndex={0}
                {...trackRowHandlers({ track, tracks: visibleTracks, index: i, albumId }, () => handlePlay(i))}
              >
                <div class="track-index">
                  <span class="idx">{track.IndexNumber ?? i + 1}</span>
                  <span class="playing-icon">♫</span>
                </div>
                <div class="name">
                  {display.title}<DownloadBadge track={track} />
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
