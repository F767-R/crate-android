const CACHE_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15000;

// This is a namespace identifier, not encryption. Credentials are never stored here.
export function translationScopeKey(context) {
  const scope = JSON.stringify([
    context.server, context.endpoint, context.sourceLang || '',
    context.targetLang || '', context.glossaryId || '',
  ]);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < scope.length; index++) {
    const code = scope.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `crateTranslations:v${CACHE_VERSION}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export class TranslationError extends Error {
  constructor(message, code = 'translation_failed', retryable = true) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function safeTranslationError(error) {
  if (error instanceof TranslationError) {
    return { message: error.message, code: error.code, retryable: error.retryable };
  }
  return {
    message: 'Translation could not finish. Check your tailnet connection and translation proxy, then retry.',
    code: 'translation_failed',
    retryable: true,
  };
}

function httpError(status) {
  if (status === 429 || status === 456) {
    return new TranslationError('The translation quota or request limit has been reached. Use saved translations, or retry after the limit is available.', 'translation_quota');
  }
  if (status === 401 || status === 403) {
    return new TranslationError('The translation service rejected access. Check its credentials before retrying.', 'translation_access');
  }
  return new TranslationError(`The translation proxy returned an error (HTTP ${status}). Saved translations are still available. Check the proxy and quota, then retry.`, 'translation_http');
}

async function requestJson(fetchImpl, endpoint, options, timeoutMs, allowEmpty = false) {
  const controller = new AbortController();
  let timer;
  try {
    const request = (async () => {
      const response = await fetchImpl(endpoint, { ...options, signal: controller.signal });
      if (!response.ok) throw httpError(response.status);
      if (allowEmpty) return null;
      try {
        return await response.json();
      } catch (_) {
        throw new TranslationError('The translation proxy returned an unreadable response. Check the proxy, then retry.', 'translation_response');
      }
    })();
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TranslationError('Translation timed out. Check your tailnet connection and proxy, then retry.', 'translation_timeout'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof TranslationError) throw error;
    throw new TranslationError('The translation proxy could not be reached. Check your tailnet connection, then retry.', 'translation_network');
  } finally {
    clearTimeout(timer);
  }
}

export function createTranslationClient({ getContext, storage, fetchImpl = (...args) => fetch(...args), timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const scopes = new Map();

  function scopeFor(context = getContext()) {
    const key = translationScopeKey(context);
    if (!scopes.has(key)) {
      const cache = new Map();
      try {
        const saved = JSON.parse(storage?.getItem(key) || 'null');
        if (saved?.version === CACHE_VERSION && Array.isArray(saved.entries)) {
          for (const entry of saved.entries) {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].trim()
              && typeof entry[1] === 'string' && entry[1].trim()) cache.set(entry[0], entry[1]);
          }
        }
      } catch (_) {}
      scopes.set(key, { key, cache, pending: new Map(), versions: new Map(), persistenceWarning: null });
    }
    return scopes.get(key);
  }

  function persist(scope) {
    try {
      if (!storage?.setItem) throw new Error('storage unavailable');
      storage.setItem(scope.key, JSON.stringify({ version: CACHE_VERSION, entries: [...scope.cache] }));
      scope.persistenceWarning = null;
    } catch (_) {
      // Keep usable translations, but do not promise that a full/disabled store saved them.
      scope.persistenceWarning = {
        message: 'Translations are available for this session, but could not be saved on this device. Free up device storage; unsaved labels may be lost when the app closes.',
        code: 'translation_storage',
        retryable: false,
      };
    }
  }

  async function fetchBatch(texts, context, scope) {
    const versions = new Map(texts.map(text => {
      const version = (scope.versions.get(text) || 0) + 1;
      scope.versions.set(text, version);
      return [text, version];
    }));
    const data = await requestJson(fetchImpl, context.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(context.authorization ? { Authorization: context.authorization } : {}) },
      body: JSON.stringify({
        text: texts,
        target_lang: context.targetLang,
        ...(context.sourceLang ? { source_lang: context.sourceLang } : {}),
        ...(context.glossaryId ? { glossary_id: context.glossaryId } : {}),
        context: 'This is a song title and/or artist name shown in a music player. Translate it as a short label, not a full sentence. Keep it literal.',
      }),
    }, timeoutMs);
    if (!Array.isArray(data?.translations) || data.translations.length !== texts.length
      || data.translations.some(item => typeof item?.text !== 'string' || !item.text.trim())) {
      throw new TranslationError('The translation proxy returned incomplete translations. Saved results were kept; retry to finish.', 'translation_response');
    }
    texts.forEach((text, index) => {
      // A newer force request or manual edit owns this text now.
      if (scope.versions.get(text) === versions.get(text)) scope.cache.set(text, data.translations[index].text);
    });
    persist(scope);
  }

  async function translateBatch(texts, { force = false, cacheOnly = false, context = getContext() } = {}) {
    const scope = scopeFor(context);
    const normalized = texts.map(text => typeof text === 'string' ? text.trim() : '');
    const needed = [...new Set(normalized.filter(text => text && (force || !scope.cache.has(text))))];
    const tasks = new Set();
    if (!cacheOnly) {
      const newTexts = needed.filter(text => force || !scope.pending.has(text));
      needed.forEach(text => {
        if (!force && scope.pending.has(text)) tasks.add(scope.pending.get(text));
      });
      if (newTexts.length) {
        const promise = fetchBatch(newTexts, context, scope);
        newTexts.forEach(text => scope.pending.set(text, promise));
        tasks.add(promise);
        const removePending = () => newTexts.forEach(text => {
          if (scope.pending.get(text) === promise) scope.pending.delete(text);
        });
        promise.then(removePending, removePending);
      }
    }
    const settled = await Promise.allSettled([...tasks]);
    const failure = settled.find(result => result.status === 'rejected');
    const confirmed = normalized.map(text => !text || scope.cache.has(text));
    return {
      values: normalized.map((text, index) => scope.cache.get(text) ?? texts[index] ?? ''),
      confirmed,
      complete: !failure && confirmed.every(Boolean),
      error: failure ? safeTranslationError(failure.reason) : null,
      persistenceWarning: scope.persistenceWarning,
    };
  }

  async function saveOverride(original, translated, { context = getContext() } = {}) {
    const text = typeof original === 'string' ? original.trim() : '';
    if (!text || typeof translated !== 'string' || !translated.trim()) {
      throw new TranslationError('Enter a translation before saving.', 'translation_empty', false);
    }
    const endpoint = new URL(context.endpoint);
    endpoint.pathname = endpoint.pathname.replace(/\/translate\/?$/, '/translate/override');
    if (!/\/translate\/override$/.test(endpoint.pathname)) {
      throw new TranslationError('Manual edits require a proxy address ending in /translate.', 'translation_override_endpoint', false);
    }
    await requestJson(fetchImpl, endpoint.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(context.authorization ? { Authorization: context.authorization } : {}) },
      body: JSON.stringify({
        original: text, translated,
        source_lang: context.sourceLang || null,
        target_lang: context.targetLang,
        glossary_id: context.glossaryId || null,
      }),
    }, timeoutMs, true);
    const scope = scopeFor(context);
    scope.versions.set(text, (scope.versions.get(text) || 0) + 1);
    scope.cache.set(text, translated);
    persist(scope);
    return { persistenceWarning: scope.persistenceWarning };
  }

  return {
    translateBatch,
    saveOverride,
    getCached: (text, context) => scopeFor(context).cache.get(typeof text === 'string' ? text.trim() : ''),
    hasCached: (text, context) => !text?.trim() || scopeFor(context).cache.has(text.trim()),
    getPersistenceWarning: context => scopeFor(context).persistenceWarning,
  };
}
