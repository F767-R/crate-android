// Test-only ESM hook. This module never reads secrets.txt or generated files.
// Intercept resolution before Node checks whether generated/secrets.js exists.
const generatedConfigUrl = new URL('../src/generated/secrets.js', import.meta.url).href;
const virtualConfigUrl = 'crate-test:build-secrets';
const source = `
export const buildSecrets = Object.freeze({
  JELLYFIN_SERVER: 'https://jellyfin.test.invalid',
  JELLYFIN_API_KEY: 'test-only-jellyfin-token',
  DEEPL_API_URL: '/translate',
  DEEPL_API_KEY: 'test-only-deepl-token',
  DEEPL_TARGET_LANG: 'EN',
  DEEPL_SOURCE_LANG: 'JA',
  DEEPL_GLOSSARY_ID: 'test-only-glossary'
});
`;

export function resolve(specifier, context, nextResolve) {
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; } catch (_) {}
  if (url === generatedConfigUrl || specifier === virtualConfigUrl) {
    return { url: virtualConfigUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url === virtualConfigUrl) return { format: 'module', source, shortCircuit: true };
  return nextLoad(url, context);
}
