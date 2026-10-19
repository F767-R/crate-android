import { h } from 'preact';
import { useEffect, useLayoutEffect } from 'preact/hooks';
import {
  albumGridScrollTop,
  albumTranslationCache,
  isTranslated,
} from '../stores/state.js';
import { downloadedOnly } from '../stores/offline.js';
import Artwork from './Artwork.jsx';
import { translatedAlbumText } from '../utils/metadata.js';
import { navigateToView } from '../utils/navigation.js';

export default function AlbumGrid({ albums, centerAlbumId = null, centerRequestId = 0 }) {
  const handleAlbumClick = (album) => {
    const main = document.getElementById('main');
    if (main) albumGridScrollTop.value = main.scrollTop;
    navigateToView({
      type: 'album',
      albumId: album.Id,
      gridReturnMode: 'restore',
      gridReturnAlbumId: album.Id,
    });
  };

  useLayoutEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    const target = centerAlbumId
      ? Array.from(document.querySelectorAll('.album-card[data-album-id]'))
        .find(element => element.dataset.albumId === String(centerAlbumId))
      : null;

    if (target) {
      const transitioning = document.documentElement.classList.contains('view-transition-running');
      target.scrollIntoView({ block: 'center', behavior: transitioning ? 'auto' : 'smooth' });
      target.classList.add('grid-centered');
    } else {
      main.scrollTop = albumGridScrollTop.value;
    }

    const highlightTimer = setTimeout(() => {
      document.querySelector('.album-card.grid-centered')?.classList.remove('grid-centered');
    }, 900);

    return () => {
      clearTimeout(highlightTimer);
    };
  }, [centerAlbumId, centerRequestId, albums?.length]);

  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    const rememberPosition = () => {
      albumGridScrollTop.value = main.scrollTop;
    };
    main.addEventListener('scroll', rememberPosition, { passive: true });
    return () => {
      rememberPosition();
      main.removeEventListener('scroll', rememberPosition);
    };
  }, []);

  if (!albums || albums.length === 0) {
    return <div class="status-msg">{downloadedOnly.value ? "No downloaded tracks in this library yet. Play music in LQ while connected to save audio automatically." : "No albums found"}</div>;
  }

  return (
    <div class="album-grid">
      {albums.map(album => {
        const display = translatedAlbumText(album, isTranslated.value, albumTranslationCache.value);
        return (
        <div
          class="album-card"
          key={album.Id}
          data-album-id={album.Id}
          role="button"
          tabIndex={0}
          onClick={() => handleAlbumClick(album)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAlbumClick(album); } }}
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
            <div class="album-artist" data-original-artist={album.AlbumArtist || 'Unknown Artist'}>
              {display.artist}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
