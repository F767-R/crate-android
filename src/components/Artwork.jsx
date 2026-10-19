import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import { useArtwork } from '../utils/useArtwork.js';
import { allAlbums } from '../stores/state.js';

export default function Artwork({ itemId, imageTag = '', size = 'primary', lazy = true, enabled = true, fallback = '♪', ...imageProps }) {
  const { ref, url, onError } = useArtwork({ itemId, imageTag, size, lazy, enabled });
  return url
    ? <img {...imageProps} ref={ref} src={url} draggable={false} decoding="async" alt={imageProps.alt || ''} onError={onError} />
    : <div ref={ref} class="art-fallback" aria-hidden="true">{fallback}</div>;
}

export function TrackArtwork({ track, ...props }) {
  const albums = allAlbums.value;
  const albumId = track?.AlbumId;
  const album = useMemo(() => albums.find(item => item.Id === albumId), [albums, albumId]);
  return <Artwork {...props} itemId={albumId} imageTag={album?.ImageTags?.Primary || track?.AlbumPrimaryImageTag || ''} />;
}
