// Save display metadata only. Never persist authenticated URLs or MediaSources.
/** @typedef {import('../types/contracts.js').Track & { SortName?: string, ProductionYear?: number, AlbumArtists?: import('../types/contracts.js').NamedArtist[] }} StoredItem */
/** @typedef {{ version: number, userId: string, libraryId: string, savedAt: number, albums: StoredItem[], tracks: StoredItem[], tracksComplete: boolean }} LibrarySnapshot */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} item @returns {StoredItem | null} */
export function libraryItem(item) {
  if (!isRecord(item) || typeof item.Id !== 'string' || !item.Id) return null;
  /** @type {StoredItem} */
  const clean = { Id: item.Id };
  for (const key of /** @type {const} */ (['Name', 'SortName', 'AlbumId', 'Album', 'AlbumArtist'])) {
    if (typeof item[key] === 'string') clean[key] = item[key];
  }
  for (const key of /** @type {const} */ (['RunTimeTicks', 'IndexNumber', 'ParentIndexNumber', 'ProductionYear'])) {
    if (typeof item[key] === 'number' && Number.isFinite(item[key])) clean[key] = item[key];
  }
  for (const key of /** @type {const} */ (['Artists', 'ArtistNames'])) {
    const values = item[key];
    if (Array.isArray(values)) clean[key] = values.filter(value => typeof value === 'string');
  }
  for (const key of /** @type {const} */ (['ArtistItems', 'AlbumArtists'])) {
    const values = item[key];
    if (Array.isArray(values)) clean[key] = values.filter(value => isRecord(value) && typeof value.Id === 'string')
      .map(value => ({ Id: value.Id, Name: typeof value.Name === 'string' ? value.Name : '' }));
  }
  if (isRecord(item.ImageTags) && typeof item.ImageTags.Primary === 'string') clean.ImageTags = { Primary: item.ImageTags.Primary };
  return clean;
}

/** @param {unknown} value @returns {LibrarySnapshot | null} */
export function librarySnapshot(value) {
  if (!isRecord(value) || value.version !== 1 || typeof value.userId !== 'string' || !value.userId
    || typeof value.libraryId !== 'string' || !value.libraryId || !Array.isArray(value.albums)
    || !Array.isArray(value.tracks) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null;
  return { version: 1, userId: value.userId, libraryId: value.libraryId, savedAt: value.savedAt,
    albums: value.albums.map(libraryItem).filter(item => item !== null),
    tracks: value.tracks.map(libraryItem).filter(item => item !== null), tracksComplete: value.tracksComplete === true };
}

/** @param {LibrarySnapshot | null} snapshot @param {string} albumId */
export function albumFromSnapshot(snapshot, albumId) {
  if (!snapshot) return null;
  const album = snapshot?.albums.find(item => item.Id === albumId);
  if (!album || !snapshot.tracksComplete) return null;
  const Items = snapshot.tracks.filter(track => track.AlbumId === albumId).sort((a, b) =>
    (a.ParentIndexNumber || 1) - (b.ParentIndexNumber || 1)
    || (a.IndexNumber || 0) - (b.IndexNumber || 0) || (a.Name || '').localeCompare(b.Name || ''));
  return { ...album, Items };
}

/** @param {string} server @param {string} apiKey */
export async function libraryStorageKey(server, apiKey) {
  const bytes = new TextEncoder().encode(JSON.stringify([server.replace(/\/+$/, ''), apiKey]));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

// IndexedDB avoids localStorage's small quota and synchronous writes for large libraries.
export function createLibraryStorage(indexedDB = globalThis.indexedDB) {
  /** @type {Promise<IDBDatabase> | null} */
  let opening = null;
  function open() {
    if (!indexedDB) return Promise.reject(new Error('storage_unavailable'));
    if (!opening) opening = new Promise(/** @param {(db: IDBDatabase) => void} resolve */ (resolve, reject) => {
      const request = indexedDB.open('crate-library', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onerror = () => reject(new Error('storage_unavailable'));
      request.onblocked = () => reject(new Error('storage_unavailable'));
      request.onsuccess = () => resolve(request.result);
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  /** @param {IDBTransactionMode} mode @param {(store: IDBObjectStore) => IDBRequest} run @returns {Promise<unknown>} */
  async function transaction(mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', mode);
      const request = run(tx.objectStore('snapshots'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('storage_unavailable'));
    });
  }
  return {
    /** @param {string} key */
    async read(key) { return librarySnapshot(await transaction('readonly', store => store.get(key))); },
    /** @param {string} key @param {unknown} snapshot */
    async write(key, snapshot) {
      const safe = librarySnapshot(snapshot);
      if (!safe) throw new Error('invalid_snapshot');
      await transaction('readwrite', store => store.put(safe, key));
    },
  };
}
