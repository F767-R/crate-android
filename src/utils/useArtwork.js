import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { acquireArtwork } from './api.js';
import { observeArtworkNearViewport } from './artworkVisibility.js';

export function useArtwork({ itemId, size = 'primary', imageTag = '', lazy = true, enabled = true }) {
  const [element, setElement] = useState(null);
  const [near, setNear] = useState(!lazy);
  const [result, setResult] = useState({ key: null, url: '' });
  const currentLease = useRef(null);
  const ref = useCallback(node => setElement(node), []);
  const key = JSON.stringify([itemId || '', size, imageTag || '']);
  const shouldLoad = Boolean(itemId && enabled && (!lazy || near));

  useEffect(() => {
    if (!element || !lazy) return undefined;
    return observeArtworkNearViewport(element, setNear);
  }, [element, lazy]);

  useEffect(() => {
    if (!shouldLoad) return undefined;
    let active = true;
    const lease = acquireArtwork(itemId, size, imageTag);
    currentLease.current = lease;
    lease.promise.then(url => { if (active) setResult({ key, url, lease }); })
      .catch(() => { if (active) setResult({ key, url: '' }); });
    return () => {
      active = false;
      if (currentLease.current === lease) currentLease.current = null;
      lease.release();
    };
  }, [key, shouldLoad]);

  return {
    ref,
    url: shouldLoad && result.key === key && result.lease === currentLease.current ? result.url : '',
    onError: () => setResult({ key, url: '' }),
  };
}
