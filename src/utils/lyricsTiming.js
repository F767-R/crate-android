// Extrapolate only between recent playback samples; never run ahead indefinitely.
export function lyricPosition(position, elapsedMs, playing, buffering) {
  return Math.max(0, position) + (playing && !buffering ? Math.min(750, Math.max(0, elapsedMs)) / 1000 : 0);
}

export function currentGroupIndex(groups, position) {
  let active = -1;
  for (let index = 0; index < groups.length; index++) {
    if (groups[index].time < 0) continue;
    if (groups[index].time > position) break;
    active = index;
  }
  return active;
}

// This function never invents a duration: a word with no end highlights
// immediately at its start rather than stretching. The capped tail for a line's
// final word comes from prepareKaraokeGroups, which runs before this.
// Interpolation uses only supplied boundaries.
export function wordProgress(word, position, reducedMotion = false) {
  if (position < word.start) return 0;
  if (reducedMotion || word.end == null || word.end <= word.start) return 1;
  return Math.min(1, (position - word.start) / (word.end - word.start));
}

export const LYRIC_FOLLOW_DELAY = 5000;

// Native samples arrive less frequently than animation frames. A new forward
// sample can lag the position we just painted; hold that position briefly
// instead of running the same syllable backward. A backward sample (seek),
// pause or buffering change resets immediately to the supplied position.
export function createLyricClock() {
  let sample = null;
  let painted = 0;
  return {
    sample(position, now, playing, buffering) {
      if (!sample || position < sample.position || playing !== sample.playing
          || buffering !== sample.buffering || !playing || buffering) painted = Math.max(0, position);
      sample = { position, now, playing, buffering };
    },
    read(now) {
      if (!sample) return 0;
      const next = lyricPosition(sample.position, now - sample.now, sample.playing, sample.buffering);
      painted = sample.playing && !sample.buffering ? Math.max(painted, next) : next;
      return painted;
    },
  };
}

// No flashing for rapid syllables; a smooth envelope for sustained words also
// reaches zero at the boundary, so removing the active state cannot snap it off.
export function wordGlow(word, progress, reducedMotion = false) {
  const duration = (word.end ?? word.start) - word.start;
  if (reducedMotion || duration <= 0.25 || progress <= 0 || progress >= 1) return 0;
  const strength = Math.min(1, (duration - 0.25) / 0.35);
  return Math.sin(Math.PI * progress) ** 2 * strength;
}

// The same 105% peak applies to every timed syllable. Drive it from lyric
// progress rather than a fixed CSS transition, so fast words stay in sync.
export function wordScale(progress, reducedMotion = false) {
  if (reducedMotion || progress <= 0 || progress >= 1) return 1;
  return 1 + 0.05 * Math.sin(Math.PI * progress) ** 2;
}
