const observers = new Map();

export function observeArtworkNearViewport(element, callback) {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true);
    return () => {};
  }
  const root = element.closest?.('#main') || null;
  let shared = observers.get(root);
  if (!shared) {
    const listeners = new Map();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    }, { root, rootMargin: '320px 0px' });
    shared = { observer, listeners };
    observers.set(root, shared);
  }
  shared.listeners.set(element, callback);
  shared.observer.observe(element);
  return () => {
    shared.observer.unobserve(element);
    shared.listeners.delete(element);
    if (!shared.listeners.size) {
      shared.observer.disconnect();
      observers.delete(root);
    }
  };
}
