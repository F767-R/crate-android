import { extractLyricsFromFlac } from './flacLyrics.js';
import { normalizeLyricsPayload } from './lrcParser.js';
import { fetchWithTimeout } from './request.js';

export const LYRICS_AUDIO_RANGE = 'bytes=0-131071';
const LYRICS_PREFIX_BYTES = 131072;

function hasLyrics(payload) {
  return normalizeLyricsPayload(payload).lines.some(line => String(line.text || '').trim());
}

function parseEndpointText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || /^<(?:!doctype|html)\b/i.test(trimmed)) return null;

  if (/^[\[{\"]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      return hasLyrics(parsed) ? parsed : null;
    } catch (_) {
      return hasLyrics(trimmed) ? trimmed : null;
    }
  }
  return hasLyrics(trimmed) ? trimmed : null;
}

async function readResponsePrefix(response, maximumBytes = LYRICS_PREFIX_BYTES, signal) {
  if (signal?.aborted) return new ArrayBuffer(0);
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    return buffer.slice(0, maximumBytes);
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {}
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (total < maximumBytes && !signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const remaining = maximumBytes - total;
      const chunk = bytes.byteLength > remaining ? bytes.subarray(0, remaining) : bytes;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < bytes.byteLength) break;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (total >= maximumBytes) {
      try { await reader.cancel(); } catch (_) {}
    }
    try { reader.releaseLock(); } catch (_) {}
  }

  if (signal?.aborted) return new ArrayBuffer(0);

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export async function fetchLyricsFromMultipleSources({
  fetchImpl = fetch,
  endpointUrl,
  originalAudioUrl,
  transcodedFlacUrl,
  headers = {},
  signal,
  timeoutMs = 15000,
  source = 'auto',
  tag = '',
}) {
  if (signal?.aborted) return null;
  if (source !== 'embedded') try {
    const payload = await fetchWithTimeout(endpointUrl, { headers, signal }, {
      fetchImpl,
      timeoutMs,
      consume: async response => response.ok ? parseEndpointText(await response.text()) : null,
    });
    if (payload && !signal?.aborted) return payload;
  } catch (_) {}
  if (source === 'jellyfin') return null;

  for (const url of source === 'embedded' ? [originalAudioUrl] : [originalAudioUrl, transcodedFlacUrl]) {
    if (!url || signal?.aborted) break;
    try {
      let sourceSignal;
      const lyrics = await fetchWithTimeout(url, {
        headers: { ...headers, Range: LYRICS_AUDIO_RANGE },
        signal,
      }, {
        timeoutMs,
        fetchImpl: (input, options) => {
          sourceSignal = options.signal;
          return fetchImpl(input, options);
        },
        consume: async response => {
          if (!response.ok && response.status !== 206) return null;
          return extractLyricsFromFlac(await readResponsePrefix(response, LYRICS_PREFIX_BYTES, sourceSignal), tag);
        },
      });
      if (lyrics && !signal?.aborted) return lyrics;
    } catch (_) {}
  }

  return null;
}
