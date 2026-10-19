import { RequestError } from './request.js';

export function artworkKey({ server, itemId, size = 'primary', imageTag = '' }) {
  return JSON.stringify([server, itemId, size, imageTag || '']);
}

export function createArtworkPool({
  loadBlob,
  createUrl = blob => URL.createObjectURL(blob),
  revokeUrl = url => URL.revokeObjectURL(url),
  maxConcurrent = 4,
  maxDormant = 100,
  maxDormantBytes = 32 * 1024 * 1024,
}) {
  const entries = new Map();
  const dormant = new Map();
  const queue = [];
  let running = 0;
  let dormantBytes = 0;

  function removeDormant(entry) {
    if (!dormant.delete(entry.key)) return;
    dormantBytes -= entry.bytes;
  }

  function evictDormant() {
    while (dormant.size > maxDormant || dormantBytes > maxDormantBytes) {
      const entry = dormant.values().next().value;
      removeDormant(entry);
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
      revokeUrl(entry.url);
    }
  }

  function pump() {
    while (running < maxConcurrent && queue.length) {
      const entry = queue.shift();
      if (!entry.refs || entries.get(entry.key) !== entry) continue;
      entry.state = 'loading';
      running++;
      Promise.resolve().then(() => {
        if (entry.controller.signal.aborted) throw new RequestError('aborted');
        return loadBlob(entry.descriptor, { signal: entry.controller.signal });
      })
        .then(blob => {
          if (entry.controller.signal.aborted || !entry.refs || entries.get(entry.key) !== entry) {
            throw new RequestError('aborted');
          }
          entry.url = createUrl(blob);
          entry.bytes = Number(blob.size) || 0;
          entry.state = 'ready';
          entry.resolve(entry.url);
        })
        .catch(error => {
          entry.state = 'failed';
          if (entries.get(entry.key) === entry) entries.delete(entry.key);
          entry.reject(error);
        })
        .finally(() => { running--; pump(); });
    }
  }

  function acquire(descriptor) {
    const key = artworkKey(descriptor);
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, descriptor, refs: 0, bytes: 0, state: 'queued', controller: new AbortController() };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      // A lease may be released before its caller gets to attach a handler.
      entry.promise.catch(() => {});
      entries.set(key, entry);
      queue.push(entry);
    }
    removeDormant(entry);
    entry.refs++;
    pump();
    let released = false;
    return {
      promise: entry.promise,
      release() {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.refs) return;
        if (entry.state === 'ready') {
          dormant.set(key, entry);
          dormantBytes += entry.bytes;
          evictDormant();
        } else if (entry.state === 'queued' || entry.state === 'loading') {
          if (entries.get(key) === entry) entries.delete(key);
          entry.controller.abort();
          entry.reject(new RequestError('aborted'));
          if (entry.state === 'queued') {
            const index = queue.indexOf(entry);
            if (index !== -1) queue.splice(index, 1);
            pump();
          }
        }
      },
    };
  }

  return {
    acquire,
    stats: () => ({ running, queued: queue.filter(entry => entry.refs && entries.get(entry.key) === entry).length, entries: entries.size, dormant: dormant.size, dormantBytes }),
  };
}
