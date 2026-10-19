import { useEffect, useMemo } from 'preact/hooks';
import { contextMenuTarget } from '../stores/state.js';
import { createRowInteractions } from './rowInteractions.js';

export function useRowInteractions(scope) {
  const gestures = useMemo(() => createRowInteractions(target => {
    contextMenuTarget.value = target;
  }), []);
  useEffect(() => {
    // Capture scroll from nested/virtualized lists as well as the main view.
    window.addEventListener('scroll', gestures.cancel, true);
    return () => {
      gestures.cancel();
      window.removeEventListener('scroll', gestures.cancel, true);
    };
  }, [gestures, ...scope]);
  return gestures.bind;
}
