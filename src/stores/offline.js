import { effect, signal } from '@preact/signals';

export const libraryUsingSaved = signal(false);
export const librarySavedAt = signal(null);
export const librarySaveError = signal(false);
export const libraryIndexError = signal(false);
export const libraryIndexing = signal(false);
export const downloadedOnly = signal(false);

// A filter belongs to one offline session, never the next online/offline session.
effect(() => {
  libraryUsingSaved.value;
  downloadedOnly.value = false;
});
