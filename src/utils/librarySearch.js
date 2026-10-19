import { artistText } from './metadata.js';

const EMPTY_ITEMS = [];
const EMPTY_TRANSLATIONS = {};

export function buildLibrarySearchIndex(albums, tracks, albumTranslations = EMPTY_TRANSLATIONS, trackTranslations = EMPTY_TRANSLATIONS) {
  const indexItems = (items, translations) => items.map(item => {
    const translated = translations[item?.Id] || {};
    return {
      item,
      fields: [item?.Name, artistText(item, ''), translated.title, translated.artist]
        .map(value => String(value || '').toLowerCase()),
    };
  });
  return { albums: indexItems(albums, albumTranslations), tracks: indexItems(tracks, trackTranslations) };
}

export function searchLibraryIndex(query, index) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return { albums: [], tracks: [] };
  const matches = entries => entries.filter(entry => entry.fields.some(value => value.includes(needle))).map(entry => entry.item);
  return { albums: matches(index.albums), tracks: matches(index.tracks) };
}

export function createLibrarySearchSelector() {
  let references = null;
  let index;
  let previousQuery;
  let results;
  return (query, albums = EMPTY_ITEMS, tracks = EMPTY_ITEMS, albumTranslations = EMPTY_TRANSLATIONS, trackTranslations = EMPTY_TRANSLATIONS) => {
    const next = [albums, tracks, albumTranslations, trackTranslations];
    const changed = !references || next.some((value, position) => value !== references[position]);
    const needle = String(query || '').trim().toLowerCase();
    if (changed) {
      index = buildLibrarySearchIndex(albums, tracks, albumTranslations, trackTranslations);
      references = next;
    }
    if (changed || needle !== previousQuery) {
      results = searchLibraryIndex(needle, index);
      previousQuery = needle;
    }
    return results;
  };
}

export function searchLibrary(
  query,
  albums = [],
  tracks = [],
  albumTranslations = {},
  trackTranslations = {},
) {
  return searchLibraryIndex(query, buildLibrarySearchIndex(albums, tracks, albumTranslations, trackTranslations));
}
