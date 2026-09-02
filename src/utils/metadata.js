function normaliseName(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value.Name === 'string') return value.Name.trim();
  return '';
}

export function artistNames(item) {
  if (!item) return [];

  const sources = [item.Artists, item.ArtistNames, item.ArtistItems];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    const names = source.map(normaliseName).filter(Boolean);
    if (names.length) return [...new Set(names)];
  }

  const fallback = normaliseName(item.AlbumArtist);
  return fallback ? [fallback] : [];
}

export function artistText(item, fallback = 'Unknown Artist') {
  const names = artistNames(item);
  return names.length ? names.join(', ') : fallback;
}

export function translatedTrackText(track, translated, cache) {
  if (!track) return { title: '—', artist: 'Nothing playing' };
  const saved = translated ? cache?.[track.Id] : null;
  return {
    title: saved?.title || track.Name || '—',
    artist: saved?.artist || artistText(track),
  };
}

export function translatedAlbumText(album, translated, cache) {
  if (!album) return { title: '—', artist: 'Unknown Artist' };
  const saved = translated ? cache?.[album.Id] : null;
  return {
    title: saved?.title || album.Name || '—',
    artist: saved?.artist || artistText(album),
  };
}
