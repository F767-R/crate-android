import { signal } from '@preact/signals';
import { buildSecrets } from './generated/secrets.js';
import { createTranslationClient, translationScopeKey } from './utils/translationClient.js';
import { albumTranslationCache, trackTranslationCache, translationComplete, translationError } from './stores/state.js';

// Blocked or unavailable storage must not stop the app from starting.
function readStored(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function writeStored(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }

// A stable id keeps Jellyfin from listing a new device after every launch.
function stableDeviceId() {
  const saved = readStored('crateDeviceId');
  if (saved) return saved;
  const created = 'crate-web-' + Math.random().toString(36).slice(2, 10);
  writeStored('crateDeviceId', created);
  return created;
}

export const config = {
  SERVER: buildSecrets.JELLYFIN_SERVER,
  API_KEY: buildSecrets.JELLYFIN_API_KEY,
  DEVICE_ID: stableDeviceId(),
  CLIENT_NAME: 'C.R.A.T.E.',
  CLIENT_VERSION: '1.0.0',
  QUALITY_PRESETS: {
    high: { label: 'HD', bitrate: 14112000, codec: 'flac', container: 'flac', transContainer: 'flac', display: 'FLAC Lossless' },
    low:  { label: 'LQ', bitrate: 128000,   codec: 'opus', container: 'opus,webm,ogg', transContainer: 'ogg', display: 'Opus 128k' }
  },
};

export const qualityPreset = signal('low');

export const DEEPL_API_URL_DEFAULT = buildSecrets.DEEPL_API_URL;
export let DEEPL_API_URL = readStored('crateDeeplUrl') || DEEPL_API_URL_DEFAULT;
if (/^https?:\/\/[^/]*:5000\//i.test(DEEPL_API_URL)) {
  DEEPL_API_URL = DEEPL_API_URL_DEFAULT;
  writeStored('crateDeeplUrl', DEEPL_API_URL);
}
export const DEEPL_API_KEY = buildSecrets.DEEPL_API_KEY;
export const TARGET_LANG = buildSecrets.DEEPL_TARGET_LANG;
export const SOURCE_LANG = buildSecrets.DEEPL_SOURCE_LANG;
export const GLOSSARY_ID = buildSecrets.DEEPL_GLOSSARY_ID;

export function getTranslationContext() {
  const endpoint = new URL(DEEPL_API_URL, config.SERVER).toString();
  const configuredOrigin = new URL(DEEPL_API_URL_DEFAULT, config.SERVER).origin;
  const canSendKey = DEEPL_API_KEY && new URL(endpoint).origin === configuredOrigin;
  return {
    server: config.SERVER,
    endpoint,
    targetLang: TARGET_LANG,
    sourceLang: SOURCE_LANG,
    glossaryId: GLOSSARY_ID,
    authorization: canSendKey ? `DeepL-Auth-Key ${DEEPL_API_KEY}` : '',
  };
}

const translationClient = createTranslationClient({
  getContext: getTranslationContext,
  storage: typeof localStorage === 'undefined' ? null : localStorage,
});

export const translateBatch = translationClient.translateBatch;
export const hasCachedTranslation = translationClient.hasCached;
export const getCachedTranslation = translationClient.getCached;
export const saveTranslationOverride = translationClient.saveOverride;
export const getTranslationPersistenceWarning = translationClient.getPersistenceWarning;
export const getTranslationScope = () => translationScopeKey(getTranslationContext());

export function setDeeplServer() {
  const next = prompt('Translate server URL (default /translate — routed by nginx to the DeepL proxy):', DEEPL_API_URL);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  try {
    const endpoint = new URL(trimmed, config.SERVER);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('unsupported protocol');
  } catch (_) {
    translationError.value = { message: 'Enter a valid HTTP or HTTPS translation proxy address.', code: 'translation_endpoint', retryable: false };
    return;
  }
  DEEPL_API_URL = trimmed;
  writeStored('crateDeeplUrl', DEEPL_API_URL);
  albumTranslationCache.value = {};
  trackTranslationCache.value = {};
  translationComplete.value = false;
  translationError.value = null;
}
