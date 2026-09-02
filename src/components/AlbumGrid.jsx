import { h } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import {
  albumGridScrollTop,
  albumTranslationCache,
  isTranslated,
} from '../stores/state.js';
import { cachedImageUrl } from '../utils/api.js';
import { translatedAlbumText } from '../utils/metadata.js';
import { navigateToView } from '../utils/navigation.js';

export default function AlbumGrid({ albums, centerAlbumId = null, centerRequestId = 0 }) {
  const [loadedImages, setLoadedImages] = useState(() => new Map());

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

  useEffect(() => {
    if (!albums) return;
    albums.forEach(album => {
      if (album.ImageTags?.Primary) {
        cachedImageUrl(album.Id, 'primary').then(url => {
          setLoadedImages(prev => new Map(prev).set(album.Id, url));
        });
      }
    });
  }, [albums]);

  if (!albums || albums.length === 0) {
    return <div class="status-msg">No albums found</div>;
  }

  return (
    <div class="album-grid">
      {albums.map((album, idx) => {
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
