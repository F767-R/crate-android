import { RequestError } from './request.js';

export function createContextMenuActions({
  getTarget, getView, getGeneration, loadAlbum,
  playFromHere, playNext, addToQueue, close, onState = () => {},
  beginPlaybackCommand, isPlaybackCommandCurrent,
}) {
  let active = null;

  const isCurrent = (request, checkPlayback = true) => active === request
    && !request.controller.signal.aborted
    && getTarget() === request.target
    && getView() === request.view
    && getGeneration() === request.generation
    && (!checkPlayback || request.action !== 'play' || isPlaybackCommandCurrent(request.command));

  function cancel() {
    active?.controller.abort();
    active = null;
  }

  function run(action) {
    const target = getTarget();
    if (!target) return Promise.resolve(false);
    if (active?.target === target) return active.promise;
    cancel();
    const request = {
      target, action, view: getView(), generation: getGeneration(), controller: new AbortController(),
      command: action === 'play' ? beginPlaybackCommand() : null,
    };
    active = request;
    onState({ target, action, loading: true, error: null });
    request.promise = (async () => {
      try {
        let tracks;
        let index;
        let track;
        if (target.kind === 'album') {
          const album = await loadAlbum(target.albumId, { signal: request.controller.signal });
          tracks = album?.Items;
          if (!Array.isArray(tracks) || !tracks.length) throw new RequestError('empty_album');
          index = 0;
          track = tracks[0];
        } else {
          tracks = Array.isArray(target.tracks) ? target.tracks : target.track ? [target.track] : [];
          index = Number.isInteger(target.index) ? Math.max(0, Math.min(target.index, tracks.length - 1)) : 0;
          track = target.track || tracks[index];
          if (!track || !tracks.length) throw new RequestError('empty_selection');
        }
        // A dismissed menu, navigation, replacement target or refresh owns no command.
        if (!isCurrent(request)) {
          if (isCurrent(request, false)) close(target);
          return false;
        }
        if (action === 'play') await playFromHere(tracks, index, target.albumId);
        else if (action === 'next') await playNext(track, target.albumId);
        else if (action === 'queue') await addToQueue(track, target.albumId);
        else throw new RequestError('invalid_action');
        if (isCurrent(request, false)) close(target);
        return true;
      } catch (error) {
        if (isCurrent(request) && error?.code !== 'aborted') {
          onState({ target, action, loading: false, error });
        } else if (isCurrent(request, false)) {
          close(target);
        }
        return false;
      } finally {
        if (active === request) active = null;
      }
    })();
    return request.promise;
  }

  return { run, cancel };
}
