// Minimal LRC parser. Returns { lines: [{ time, text }, ...] } sorted
// by time. Handles [mm:ss.xx] and [mm:ss.xxx] timestamps. Multi-stamp
// lines (same text at multiple times) are emitted as separate lines.

const TIME_RE = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function parseStamp(match) {
  const min = parseInt(match[1], 10) || 0;
  const sec = parseInt(match[2], 10) || 0;
  const fracStr = match[3] || '0';
  // Normalise fractional part to milliseconds
  const frac = parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) || 0;
  return min * 60 + sec + frac / 1000;
}

export function parseLRC(text) {
  if (!text || typeof text !== 'string') return { lines: [] };
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    // Strip the [ti:...], [ar:...], [al:...] metadata lines (no time)
    if (/^\[[a-z]+:/i.test(raw.trim())) continue;
    // Find all timestamps in the line
    const stamps = [];
    let textStart = 0;
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(raw)) !== null) {
      stamps.push(parseStamp(m));
      textStart = TIME_RE.lastIndex;
    }
    if (stamps.length === 0) {
      const lyric = raw.trim();
      if (lyric) out.push({ time: -1, text: lyric });
      continue;
    }
    const lyric = raw.slice(textStart).trim();
    for (const t of stamps) {
      out.push({ time: t, text: lyric });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return { lines: out };
}

function normaliseStructuredLine(line) {
  if (!line || typeof line !== 'object') return null;
  const start = line.StartTicks ?? line.Start;
  const numericStart = Number(start);
  return {
    time: start == null || !Number.isFinite(numericStart) ? -1 : numericStart / 10000000,
    text: String(line.Text ?? line.text ?? ''),
  };
}

export function normalizeLyricsPayload(payload) {
  if (typeof payload === 'string') return parseLRC(payload);

  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.Lyrics)
      ? payload.Lyrics
      : null;

  if (source) {
    const lines = source
      .map((line, index) => {
        const normalized = normaliseStructuredLine(line);
        return normalized ? { ...normalized, sourceIndex: index } : null;
      })
      .filter(line => line && line.text.trim())
      .sort((a, b) => {
        if (a.time < 0 && b.time >= 0) return 1;
        if (a.time >= 0 && b.time < 0) return -1;
        return a.time - b.time || a.sourceIndex - b.sourceIndex;
      })
      .map(({ sourceIndex: _, ...line }) => line);
    return { lines };
  }

  if (typeof payload?.Lyrics === 'string') return parseLRC(payload.Lyrics);
  return { lines: [] };
}

export function groupLyricsLines(lines) {
  const groups = [];
  for (const line of lines || []) {
    const time = Number.isFinite(line?.time) ? line.time : -1;
    const text = String(line?.text ?? '');
    if (!text.trim()) continue;

    const previous = groups.at(-1);
    if (time >= 0 && previous?.time === time) {
      previous.lines.push(text);
    } else {
      groups.push({ time, lines: [text] });
    }
  }
  return groups;
}

export function getCurrentLineIndex(lines, currentTimeSec) {
  if (!lines || lines.length === 0 || currentTimeSec < 0) return -1;
  // Binary search would be nicer; linear is fine for the typical line count
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time < 0) continue;
    if (lines[i].time <= currentTimeSec) idx = i;
    else break;
  }
  return idx;
}
