// Standard and enhanced LRC. Optional words retain the exact text between
// <mm:ss.xx> markers; line-only payloads keep their existing shape.

const TIME_RE = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_RE = /<(\d+):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function parseStamp(match) {
  const min = parseInt(match[1], 10) || 0;
  const sec = parseInt(match[2], 10) || 0;
  const fracStr = match[3] || '0';
  // Normalise fractional part to milliseconds
  const frac = parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) || 0;
  return min * 60 + sec + frac / 1000;
}

function parseWords(text, lineTime) {
  const matches = [...text.matchAll(WORD_RE)];
  if (!matches.length) return { text: text.trim() };
  const clean = text.replace(WORD_RE, '').trim();
  const times = matches.map(parseStamp);
  // A partial or broken timing map falls back to readable, line-synced text.
  const valid = !text.slice(0, matches[0].index).trim()
    && times.every((time, index) => Number(matches[index][2]) < 60
      && time >= Math.max(0, lineTime) && (index === 0 || time >= times[index - 1]));
  if (!valid) return { text: clean };
  const words = matches.map((match, index) => {
    const next = matches[index + 1];
    const word = { start: times[index], text: text.slice(match.index + match[0].length, next?.index ?? text.length) };
    if (next) word.end = times[index + 1];
    return word;
  }).filter(word => word.text.length);
  return words.some(word => word.text.trim()) ? { text: clean, words } : { text: clean };
}

function shiftLine(line, shift) {
  if (!shift) return line;
  return {
    ...line,
    time: line.time < 0 ? -1 : Math.max(0, line.time + shift),
    ...(line.words ? { words: line.words.map(word => ({
      ...word, start: Math.max(0, word.start + shift),
      ...(word.end == null ? {} : { end: Math.max(0, word.end + shift) }),
    })) } : {}),
  };
}

export function parseLRC(text) {
  if (!text || typeof text !== 'string') return { lines: [] };
  const out = [];
  const lines = text.split(/\r?\n/);
  const offsetMatch = text.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
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
      const lyric = parseWords(raw.trim(), -1);
      if (lyric.text) out.push(shiftLine({ time: lyric.words?.[0]?.start ?? -1, ...lyric }, offset));
      continue;
    }
    const lyric = parseWords(raw.slice(textStart).trim(), stamps[0]);
    for (const t of stamps) {
      out.push(shiftLine({ time: stamps[0], ...lyric }, t - stamps[0] + offset));
    }
  }
  out.sort((a, b) => (a.time < 0 ? Infinity : a.time) - (b.time < 0 ? Infinity : b.time));
  return { lines: out };
}

function normaliseStructuredLine(line) {
  if (!line || typeof line !== 'object') return null;
  const start = line.StartTicks ?? line.Start;
  const numericStart = Number(start);
  const time = start == null || !Number.isFinite(numericStart) ? -1 : numericStart / 10000000;
  const lyric = parseWords(String(line.Text ?? line.text ?? ''), time);
  return { time: time < 0 ? lyric.words?.[0]?.start ?? -1 : time, ...lyric };
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
      .filter(line => line && (line.time >= 0 || line.text.trim()))
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
    if (!text.trim() && time < 0) continue;

    const previous = groups.at(-1);
    if (time >= 0 && previous?.time === time) {
      if (!text.trim()) continue;
      if (line.words || previous.wordLines) {
        previous.wordLines ||= previous.lines.map(() => null);
        previous.wordLines.push(line.words || null);
      }
      previous.lines.push(text);
    } else {
      groups.push({ time, lines: [text], ...(line.words ? { wordLines: [line.words] } : {}) });
    }
  }
  return groups;
}

// Word-timed lyrics only: the last word of a line has no `end` (there is no
// following marker), so borrow a short, capped one. It never runs past the next
// line's start and never stretches through an instrumental gap.
const TAIL_MIN = 0.3;
const TAIL_MAX = 1.2;

function nextTimedStart(groups, from) {
  for (let i = from + 1; i < groups.length; i++) if (groups[i].time >= 0) return groups[i].time;
  return null;
}

function closeLastWords(words, nextStart) {
  const last = words.at(-1);
  if (last.end != null) return words;
  const spans = words.filter(word => word.end != null).map(word => word.end - word.start);
  const typical = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0.5;
  let tail = Math.min(TAIL_MAX, Math.max(TAIL_MIN, typical));
  if (nextStart != null) tail = Math.min(tail, nextStart - last.start);
  return tail > 0 ? [...words.slice(0, -1), { ...last, end: last.start + tail }] : words;
}

// Groups without word timing are returned untouched (plain line highlight).
export function prepareKaraokeGroups(groups) {
  return groups.map((group, index) => {
    if (!group.wordLines?.some(words => words?.length)) return group;
    const nextStart = nextTimedStart(groups, index);
    return {
      ...group,
      wordLines: group.wordLines.map(words => words?.length ? closeLastWords(words, nextStart) : words),
    };
  });
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
