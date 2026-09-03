import { extractLyricsFromFlac } from './flacLyrics.js';
import { normalizeLyricsPayload } from './lrcParser.js';

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

async function readResponsePrefix(response, maximumBytes = LYRICS_PREFIX_BYTES) {
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    return buffer.slice(0, maximumBytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maximumBytes) {
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
    if (total >= maximumBytes) {
      try { await reader.cancel(); } catch (_) {}
    }
    try { reader.releaseLock(); } catch (_) {}
  }

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
}) {
  try {
    const response = await fetchImpl(endpointUrl, { headers, signal });
    if (response.ok) {
      const payload = parseEndpointText(await response.text());
      if (payload) return payload;
    }
  } catch (_) {}

  for (const url of [originalAudioUrl, transcodedFlacUrl]) {
    if (!url || signal?.aborted) break;
    try {
      const response = await fetchImpl(url, {
        headers: { ...headers, Range: LYRICS_AUDIO_RANGE },
        signal,
      });
      if (!response.ok && response.status !== 206) continue;
      const lyrics = extractLyricsFromFlac(await readResponsePrefix(response));
      if (lyrics) return lyrics;
    } catch (_) {}
  }

  return null;
}
