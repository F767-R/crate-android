import {
  settingsVisible, lyricsVisible, contextMenuTarget, translationEditVisible,
  sleepPanelVisible, queueVisible, currentTrack, playerBarExpanded, playerMoreVisible,
} from '../stores/state.js';
import { cancelPendingSearch, goBackView } from './navigation.js';

// Highest visible layer first, matching the panels' CSS stacking order.
export function handleAppBack() {
  cancelPendingSearch();
  for (const panel of [settingsVisible, translationEditVisible, lyricsVisible,
    contextMenuTarget, sleepPanelVisible, queueVisible, playerMoreVisible]) {
    if (panel.value) {
      panel.value = panel === contextMenuTarget ? null : false;
      return true;
    }
  }
  if (goBackView()) return true;
  if (currentTrack.value && playerBarExpanded.value) {
    playerBarExpanded.value = false;
    return true;
  }
  return false; // Android backgrounds the task; playback is untouched.
}

export function attachAppBackListener(target = window) {
  const onBack = event => {
    if (handleAppBack()) event.preventDefault();
  };
  target.addEventListener('crate:back', onBack);
  return () => target.removeEventListener('crate:back', onBack);
}
