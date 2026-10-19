import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {} };
const state = await import('../src/stores/state.js');
const nav = await import('../src/utils/navigation.js');
const { handleAppBack, attachAppBackListener } = await import('../src/utils/backNavigation.js');

nav.showAlbumGrid({ restoreScroll: true });
nav.navigateToView({ type: 'search', query: 'first' });
nav.navigateToView({ type: 'search', query: 'second' });
nav.navigateToView({ type: 'album', albumId: 'A' });
nav.navigateToView({ type: 'artist', artistId: 'artist' });
nav.showLyricsView();
assert.equal(handleAppBack(), true);
assert.equal(state.currentViewState.value.type, 'artist');
assert.equal(state.previousViewState.value, null);
handleAppBack();
assert.equal(state.currentViewState.value.albumId, 'A');
handleAppBack();
assert.equal(state.currentViewState.value.query, 'second');
assert.equal(state.searchQuery.value, 'second', 'search text returns with its results');
handleAppBack();
assert.equal(state.currentViewState.value.type, 'grid', 'typing does not add Back steps');
assert.equal(state.searchQuery.value, '');
assert.equal(handleAppBack(), false, 'root lets Android background the app');

nav.navigateToView({ type: 'album', albumId: 'A' });
nav.showAlbumGrid();
assert.equal(handleAppBack(), false, 'explicit library return clears old screen history');

nav.navigateToView({ type: 'album', albumId: 'B' });
const visiblePanels = [state.settingsVisible, state.translationEditVisible, state.lyricsVisible,
  state.contextMenuTarget, state.sleepPanelVisible, state.queueVisible, state.playerMoreVisible];
visiblePanels.forEach(panel => { panel.value = panel === state.contextMenuTarget ? { id: 'target' } : true; });
const beforeSearch = nav.getNavigationRevision();
for (let index = 0; index < visiblePanels.length; index++) {
  assert.equal(handleAppBack(), true);
  assert.ok(!visiblePanels[index].value);
  assert.equal(state.currentViewState.value.albumId, 'B', 'panels dismiss before navigation');
  if (index + 1 < visiblePanels.length) assert.ok(visiblePanels[index + 1].value, 'only the top panel closes');
}
assert.notEqual(nav.getNavigationRevision(), beforeSearch, 'Back invalidates delayed searches');
state.playbackCurrentTrack.value = { Id: 'playing' };
state.playbackPlaying.value = true;
state.playbackPosition.value = 42;
state.queue.value = [{ track: { Id: 'queued' } }];
handleAppBack();
assert.equal(state.currentViewState.value.type, 'grid');
assert.equal(handleAppBack(), true, 'collapse player at library root');
assert.equal(state.playerBarExpanded.value, false);
assert.equal(handleAppBack(), false);
assert.equal(state.playbackPlaying.value, true);
assert.equal(state.playbackPosition.value, 42);
assert.equal(state.queue.value.length, 1, 'Back never mutates playback or queue');

const target = new EventTarget();
const detach = attachAppBackListener(target);
state.settingsVisible.value = true;
assert.equal(target.dispatchEvent(new Event('crate:back', { cancelable: true })), false);
assert.equal(target.dispatchEvent(new Event('crate:back', { cancelable: true })), true);
detach();
state.settingsVisible.value = true;
assert.equal(target.dispatchEvent(new Event('crate:back', { cancelable: true })), true);
assert.equal(state.settingsVisible.value, true, 'listener is removed on unmount');
state.settingsVisible.value = false;

// Real view transitions defer their update callback. A quick Back or a newer
// selection must win even if older callbacks finish later.
const transitions = [];
globalThis.document = {
  documentElement: { classList: { add() {}, remove() {} } },
  startViewTransition(apply) {
    const transition = { apply, finished: Promise.resolve(), skipTransition() {} };
    transitions.push(transition);
    return transition;
  },
};
nav.navigateToView({ type: 'album', albumId: 'slow' });
handleAppBack();
transitions.at(-1).apply();
transitions[0].apply();
assert.equal(state.currentViewState.value.type, 'grid', 'delayed album cannot reopen after Back');
nav.navigateToView({ type: 'album', albumId: 'next' });
state.settingsVisible.value = true;
handleAppBack();
transitions.at(-1).apply();
assert.equal(state.currentViewState.value.albumId, 'next', 'closing a panel does not cancel a pending view');
nav.showLyricsView();
nav.hideLyricsView();
transitions.at(-1).apply();
transitions.at(-2).apply();
assert.equal(state.currentViewState.value.albumId, 'next', 'rapid lyrics close restores its source');
console.log('Navigation checks passed: screen history, panels, search, playback preservation, Android event contract and delayed transitions.');
