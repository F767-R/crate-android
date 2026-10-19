import {
  albumGridFocusAlbumId,
  albumGridFollowPlayback,
  allAlbums,
  currentViewState,
  previousViewState,
  searchQuery,
} from '../stores/state.js';

let centerRequestId = 0;
let gridRequestId = 0;
let activeViewTransition = null;
const viewHistory = [];
let navigationRevision = 0;
let searchRevision = 0;
let pendingView = null;

export const getNavigationRevision = () => searchRevision;
export function cancelPendingSearch() { searchRevision++; }

function viewIdentity(view) {
  if (!view) return 'unknown';
  if (view.type === 'album') return `album:${view.albumId || ''}`;
  if (view.type === 'artist') return `artist:${view.artistId || ''}`;
  return view.type || 'unknown';
}

export function navigateToView(nextView, { remember = true } = {}) {
  const previous = pendingView || currentViewState.value;
  const changesScreen = viewIdentity(previous) !== viewIdentity(nextView);
  if (nextView.type === 'grid') viewHistory.length = 0;
  else if (remember && changesScreen) {
    viewHistory.push(previous);
    if (viewHistory.length > 50) viewHistory.shift();
  }
  pendingView = nextView;
  cancelPendingSearch();
  const revision = ++navigationRevision;
  const apply = () => {
    if (revision !== navigationRevision) return;
    currentViewState.value = nextView;
    searchQuery.value = nextView.type === 'search' ? nextView.query || '' : '';
    pendingView = null;
  };
  const doc = typeof document !== 'undefined' ? document : null;
  const reducedMotion = doc?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!doc?.startViewTransition || reducedMotion || !changesScreen) {
    apply();
    return null;
  }

  activeViewTransition?.skipTransition?.();
  doc.documentElement.classList.add('view-transitions-supported', 'view-transition-running');
  const transition = doc.startViewTransition(apply);
  activeViewTransition = transition;
  transition.finished
    .catch(() => {})
    .finally(() => {
      if (activeViewTransition === transition) {
        activeViewTransition = null;
        doc.documentElement.classList.remove('view-transition-running');
      }
    });
  return transition;
}

export function goBackView() {
  const view = pendingView || currentViewState.value;
  if (view.type === 'grid') return false;
  const previous = viewHistory.pop()
    || (view.type === 'lyrics' ? previousViewState.value : null)
    || { type: 'grid' };
  if (view.type === 'lyrics') previousViewState.value = null;
  navigateToView(previous, { remember: false });
  return true;
}

export function trackAlbumId(track) {
  if (!track) return null;
  let albumId = track.AlbumId || (typeof track.Album === 'object' ? track.Album?.Id : null);
  if (!albumId && typeof track.Album === 'string') {
    albumId = allAlbums.value.find(album => album.Name === track.Album)?.Id || null;
  }
  return albumId || null;
}

export function showAlbumGrid({ restoreScroll = false, centerAlbumId = null } = {}) {
  const targetAlbumId = restoreScroll
    ? null
    : centerAlbumId || albumGridFocusAlbumId.value || null;

  navigateToView({
    type: 'grid',
    centerAlbumId: targetAlbumId,
    gridRequestId: ++gridRequestId,
  });

  // The focus request has now been carried by the view state. Future
  // returns should preserve the grid position until another external
  // playback source asks the grid to follow it again.
  albumGridFocusAlbumId.value = null;
  albumGridFollowPlayback.value = false;
}

export function showLyricsView() {
  const view = pendingView || currentViewState.value;
  if (view.type === 'lyrics') return;
  previousViewState.value = view;
  navigateToView({ type: 'lyrics' });
}

export function hideLyricsView() {
  if ((pendingView || currentViewState.value).type === 'lyrics') goBackView();
}

export function showNowPlayingTrack(track) {
  if (!track?.Id) return false;

  const albumId = trackAlbumId(track);
  if (!albumId) return false;

  const view = currentViewState.value;
  const alreadyOnAlbum = view.type === 'album' && view.albumId === albumId;
  const shouldCenterAlbumOnGridReturn = view.gridReturnMode === 'center'
    || (view.type !== 'grid' && albumGridFocusAlbumId.value === albumId);

  navigateToView({
    type: 'album',
    albumId,
    centerTrackId: track.Id,
    centerRequestId: ++centerRequestId,
    gridReturnMode: alreadyOnAlbum
      ? (view.gridReturnMode || 'restore')
      : (shouldCenterAlbumOnGridReturn ? 'center' : 'restore'),
    gridReturnAlbumId: alreadyOnAlbum
      ? (view.gridReturnAlbumId || albumId)
      : albumId,
  });
  return true;
}
