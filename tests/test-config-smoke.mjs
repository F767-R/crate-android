import assert from 'node:assert/strict';
// A direct invocation without the test hook fails here before any real config
// import. Use npm test (or node --import ./scripts/register-test-config.mjs ...).
import { buildSecrets as virtualSecrets } from 'crate-test:build-secrets';
import { resolve, load } from '../scripts/test-config-loader.mjs';

const { buildSecrets } = await import('../src/generated/secrets.js');
assert.strictEqual(buildSecrets, virtualSecrets);
assert.equal(buildSecrets.JELLYFIN_SERVER, 'https://jellyfin.test.invalid');
assert.equal(buildSecrets.JELLYFIN_API_KEY, 'test-only-jellyfin-token');
assert.equal(buildSecrets.DEEPL_API_KEY, 'test-only-deepl-token');
assert.equal(Object.isFrozen(buildSecrets), true);

const resolved = await resolve('../src/generated/secrets.js', { parentURL: import.meta.url }, () => {
  assert.fail('The test config must resolve without consulting the filesystem.');
});
assert.equal(resolved.shortCircuit, true);
const loaded = await load(resolved.url, {}, () => {
  assert.fail('The test config must load without reading a generated file.');
});
assert.equal(loaded.format, 'module');
assert.equal(loaded.shortCircuit, true);

let delegated = false;
await resolve('node:assert/strict', { parentURL: import.meta.url }, () => {
  delegated = true;
  return { url: 'node:assert/strict' };
});
assert.equal(delegated, true, 'Only the exact generated configuration import is replaced.');
console.log('secret-free test configuration checks passed');
