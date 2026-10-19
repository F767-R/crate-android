import { RequestError } from './request.js';

// One request per resource and generation. A subscriber may leave without
// cancelling shared work that another view still needs.
export function createLibraryRequestOwner({ getContext, onInvalidate = () => {} }) {
  const requests = new Map();
  let context = getContext();
  let scope = JSON.stringify(context);
  let generation = 0;

  function invalidate(preserveData = false) {
    generation++;
    for (const request of requests.values()) request.controller.abort();
    requests.clear();
    onInvalidate(generation, preserveData);
    return generation;
  }

  function syncScope() {
    const nextContext = getContext();
    const nextScope = JSON.stringify(nextContext);
    if (nextScope !== scope) {
      context = nextContext;
      scope = nextScope;
      invalidate();
    }
    return generation;
  }

  function run(key, load, commit, { signal } = {}) {
    syncScope();
    if (signal?.aborted) return Promise.reject(new RequestError('aborted'));
    let request = requests.get(key);
    if (!request) {
      const controller = new AbortController();
      request = { controller, generation, subscribers: 0, settled: false };
      const ownedRequest = request;
      const requestContext = context;
      const aborted = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new RequestError('aborted')), { once: true });
      });
      requests.set(key, request);
      request.promise = Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new RequestError('aborted');
          return load(requestContext, { signal: controller.signal });
        }),
        aborted,
      ]).then(data => {
        syncScope();
        if (controller.signal.aborted || ownedRequest.generation !== generation || requests.get(key) !== ownedRequest) {
          throw new RequestError('aborted');
        }
        commit(data);
        return data;
      }).finally(() => {
        ownedRequest.settled = true;
        if (requests.get(key) === ownedRequest) requests.delete(key);
      });
    }

    const ownedRequest = request;
    ownedRequest.subscribers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, value, cancelled = false) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        ownedRequest.subscribers--;
        if (cancelled && !ownedRequest.settled && ownedRequest.subscribers === 0) {
          if (requests.get(key) === ownedRequest) requests.delete(key);
          ownedRequest.controller.abort();
        }
        callback(value);
      };
      const onAbort = () => finish(reject, new RequestError('aborted'), true);
      signal?.addEventListener('abort', onAbort, { once: true });
      ownedRequest.promise.then(value => finish(resolve, value), error => finish(reject, error));
    });
  }

  return { run, invalidate, syncScope, getGeneration: () => syncScope() };
}
