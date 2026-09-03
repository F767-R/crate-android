import { artistText } from './metadata.js';

function includesQuery(query, values) {
  return values.some(value => String(value || '').toLowerCase().includes(query));
}

export function searchLibrary(
  query,
  albums = [],
  tracks = [],
  albumTranslations = {},
  trackTranslations = {},
) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return { albums: [], tracks: [] };

  return {
    albums: albums.filter(album => {
      const translated = albumTranslations[album?.Id] || {};
      return includesQuery(needle, [
        album?.Name,
        artistText(album, ''),
        translated.title,
        translated.artist,
      ]);
    }),
    tracks: tracks.filter(track => {
      const translated = trackTranslations[track?.Id] || {};
      return includesQuery(needle, [
        track?.Name,
        artistText(track, ''),
        translated.title,
        translated.artist,
      ]);
    }),
  };
}
