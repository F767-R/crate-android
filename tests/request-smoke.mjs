import assert from 'node:assert/strict';
import { fetchWithTimeout, httpError, safeRequestError } from '../src/utils/request.js';

const url = 'https://example.invalid/library?api_key=DO_NOT_DISPLAY';
let calls = 0;
assert.deepEqual(await fetchWithTimeout(url, {}, {
  fetchImpl: async () => { calls++; return { json: async () => ({ Items: [] }) }; },
  consume: response => response.json(),
}), { Items: [] });
assert.equal(calls, 1);

let timedSignal;
await assert.rejects(fetchWithTimeout(url, { method: 'POST' }, {
  timeoutMs: 10,
  fetchImpl: async (_, options) => {
    calls++;
    timedSignal = options.signal;
    return { json: () => new Promise(() => {}) };
  },
  consume: response => response.json(),
}), error => error.code === 'timeout');
assert.equal(timedSignal.aborted, true, 'Timeout aborts body downloads too');
assert.equal(calls, 2, 'POST is never automatically replayed');

const controller = new AbortController();
let internalSignal;
const pending = fetchWithTimeout(url, { signal: controller.signal }, {
  fetchImpl: async (_, options) => { internalSignal = options.signal; return new Promise(() => {}); },
});
await Promise.resolve();
controller.abort();
await assert.rejects(pending, error => error.code === 'aborted');
assert.equal(internalSignal.aborted, true);
await assert.rejects(fetchWithTimeout(url, { signal: controller.signal }, {
  fetchImpl: async () => { throw new Error('Must not fetch'); },
}), error => error.code === 'aborted');

await assert.rejects(fetchWithTimeout(url, {}, {
  fetchImpl: async () => ({ json: async () => { throw new SyntaxError('bad payload'); } }),
  consume: response => response.json(),
}), error => error.code === 'invalid_response');
await assert.rejects(fetchWithTimeout(url, {}, {
  fetchImpl: async () => ({ status: 401 }),
  consume: response => { throw httpError(response.status); },
}), error => error.status === 401 && !safeRequestError(error).includes('DO_NOT_DISPLAY'));
await assert.rejects(fetchWithTimeout(url, {}, {
  fetchImpl: async () => { throw new TypeError(`Failed to fetch ${url}`); },
}), error => error.code === 'network' && !error.message.includes(url));
assert.match(safeRequestError(httpError(403)), /Access was denied/);
assert.match(safeRequestError(httpError(503)), /unavailable/);
assert.equal(safeRequestError(new Error(url)), 'Request failed. Please try again.');

let completedSignal;
await fetchWithTimeout(url, {}, {
  timeoutMs: 10,
  fetchImpl: async (_, options) => { completedSignal = options.signal; return {}; },
});
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(completedSignal.aborted, false, 'Successful completion clears timeout');
console.log('request smoke test passed');
