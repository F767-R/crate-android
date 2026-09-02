import { signal } from '@preact/signals';
import { buildSecrets } from './generated/secrets.js';

export const config = {
  SERVER: buildSecrets.JELLYFIN_SERVER,
  API_KEY: buildSecrets.JELLYFIN_API_KEY,
  DEVICE_ID: 'crate-web-' + Math.random().toString(36).slice(2, 10),
  CLIENT_NAME: 'C.R.A.T.E.',
  CLIENT_VERSION: '1.0.0',
  QUALITY_PRESETS: {
    high: { label: 'HD', bitrate: 14112000, codec: 'flac', container: 'flac', transContainer: 'flac', display: 'FLAC Lossless' },
    low:  { label: 'LQ', bitrate: 128000,   codec: 'opus', container: 'opus,webm,ogg', transContainer: 'ogg', display: 'Opus 128k' }
  },
};

export const qualityPreset = signal('low');

export const DEEPL_API_URL_DEFAULT = buildSecrets.DEEPL_API_URL;
export let DEEPL_API_URL = localStorage.getItem('crateDeeplUrl') || DEEPL_API_URL_DEFAULT;
if (/^https?:\/\/[^/]*:5000\//i.test(DEEPL_API_URL)) {
  DEEPL_API_URL = DEEPL_API_URL_DEFAULT;
  localStorage.setItem('crateDeeplUrl', DEEPL_API_URL);
}
export const DEEPL_API_KEY = buildSecrets.DEEPL_API_KEY;
export const TARGET_LANG = buildSecrets.DEEPL_TARGET_LANG;
export const SOURCE_LANG = buildSecrets.DEEPL_SOURCE_LANG;
export const GLOSSARY_ID = buildSecrets.DEEPL_GLOSSARY_ID;

export const translationCache = new Map();
export const pendingTranslations = new Map();

export function setDeeplServer() {
  const next = prompt('Translate server URL (default /translate — routed by nginx to the DeepL proxy):', DEEPL_API_URL);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  DEEPL_API_URL = trimmed;
  localStorage.setItem('crateDeeplUrl', DEEPL_API_URL);
  translationCache.clear();
}

export async function fetchTranslationBatch(uniqueTexts) {
  try {
    const translateUrl = new URL(DEEPL_API_URL, config.SERVER).toString();
    const configuredTranslationOrigin = new URL(DEEPL_API_URL_DEFAULT, config.SERVER).origin;
    const requestTranslationOrigin = new URL(translateUrl).origin;
    const canSendDeeplKey = DEEPL_API_KEY && requestTranslationOrigin === configuredTranslationOrigin;
    const headers = {
      'Content-Type': 'application/json',
      ...(canSendDeeplKey ? { Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}` } : {}),
    };
    const resp = await fetch(translateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: uniqueTexts,
        target_lang: TARGET_LANG,
        ...(SOURCE_LANG ? { source_lang: SOURCE_LANG } : {}),
        ...(GLOSSARY_ID ? { glossary_id: GLOSSARY_ID } : {}),
        context: 'This is a song title and/or artist name shown in a music player. ' +
                 'Translate it as a short label, not a full sentence. Keep it literal.'
      })
    });
    if (!resp.ok) throw new Error(`DeepL HTTP ${resp.status}`);
    const data = await resp.json();
    uniqueTexts.forEach((text, index) => {
      translationCache.set(text, data.translations[index].text);
    });
  } catch (err) {
    console.warn('DeepL error, using original text:', err);
    uniqueTexts.forEach(text => translationCache.set(text, text));
  } finally {
    uniqueTexts.forEach(text => pendingTranslations.delete(text));
  }
}

export async function translateBatch(texts) {
  const results = new Array(texts.length);
  const trimmedByIndex = new Array(texts.length);
  const newTexts = [];
  const waitingOn = [];

  texts.forEach((text, index) => {
    const trimmed = text ? text.trim() : '';
    trimmedByIndex[index] = trimmed;
    if (!trimmed) {
      results[index] = text || '';
    } else if (translationCache.has(trimmed)) {
      results[index] = translationCache.get(trimmed);
    } else if (pendingTranslations.has(trimmed)) {
      waitingOn.push(trimmed);
    } else if (!newTexts.includes(trimmed)) {
      newTexts.push(trimmed);
    }
  });

  const toAwait = [];
  if (newTexts.length > 0) {
    const batchPromise = fetchTranslationBatch(newTexts);
    newTexts.forEach(text => pendingTranslations.set(text, batchPromise));
    toAwait.push(batchPromise);
  }
  waitingOn.forEach(text => {
    const promise = pendingTranslations.get(text);
    if (promise) toAwait.push(promise);
  });

  if (toAwait.length > 0) await Promise.all(toAwait);

  texts.forEach((text, index) => {
    if (results[index] !== undefined) return;
    const trimmed = trimmedByIndex[index];
    results[index] = translationCache.get(trimmed) || text;
  });
  return results;
}
