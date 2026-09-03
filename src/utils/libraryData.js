import { allTracks, allTracksFetched, musicLibraryId, userId } from '../stores/state.js';
import { getAllTracks } from './api.js';

let allTracksRequest = null;

export async function ensureAllTracksLoaded() {
  if (allTracksFetched.value) return allTracks.value;
  if (allTracksRequest) return allTracksRequest;

  allTracksRequest = getAllTracks(userId.value, musicLibraryId.value)
    .then(data => {
      const tracks = data.Items || [];
      allTracks.value = tracks;
      allTracksFetched.value = true;
      return tracks;
    })
    .finally(() => {
      allTracksRequest = null;
    });

  return allTracksRequest;
}
