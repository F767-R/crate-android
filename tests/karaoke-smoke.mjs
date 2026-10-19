import assert from 'node:assert/strict';
import { parseLRC, normalizeLyricsPayload, groupLyricsLines, prepareKaraokeGroups } from '../src/utils/lrcParser.js';
import { currentGroupIndex, lyricPosition, wordProgress } from '../src/utils/lyricsTiming.js';

const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-9, `${message} (expected ${expected}, got ${actual})`);

const source = '[00:01.00]<00:01.00>君<00:01.50>と <00:02.00>sing!<00:03.00>\n[00:04]Normal line';
const parsed = parseLRC(source);
assert.equal(parsed.lines[0].text, '君と sing!');
assert.deepEqual(parsed.lines[0].words, [
  { start: 1, end: 1.5, text: '君' }, { start: 1.5, end: 2, text: 'と ' }, { start: 2, end: 3, text: 'sing!' },
]);
assert.deepEqual(parsed.lines[1], { time: 4, text: 'Normal line' });
assert.equal(wordProgress(parsed.lines[0].words[0], 1.25), .5);
assert.equal(wordProgress(parsed.lines[0].words[0], .9), 0);
assert.equal(wordProgress(parsed.lines[0].words[0], 8), 1);
assert.equal(wordProgress(parsed.lines[0].words[0], 1.25, true), 1);
assert.equal(wordProgress({ start: 3, text: 'end' }, 3), 1, 'no fabricated duration for last word');
assert.equal(wordProgress({ start: 3, end: 3, text: 'instant' }, 3), 1);
assert.equal(wordProgress(parsed.lines[0].words[0], lyricPosition(1.25, 500, false, false)), .5, 'pause freezes fill');
assert.equal(wordProgress(parsed.lines[0].words[0], lyricPosition(1.25, 500, true, true)), .5, 'buffering freezes fill');
assert.equal(wordProgress(parsed.lines[0].words[0], .5), 0, 'backward seek resets fill');

const structured = normalizeLyricsPayload({ Lyrics: [{ StartTicks: 10000000, Text: '<00:01>one <00:02>two' }] });
assert.equal(structured.lines[0].words[1].text, 'two');
const repeat = parseLRC('[00:01][00:11]<00:01>one <00:02>two');
assert.equal(repeat.lines[1].words[0].start, 11);
assert.equal(repeat.lines[1].words[1].start, 12);
assert.equal(parseLRC('[offset:-500]\n[00:01]<00:01>a<00:02>b').lines[0].words[0].start, .5);
assert.equal(parseLRC('[00:01]<00:01.123>a<00:02>b').lines[0].words[0].start, 1.123);
assert.equal(parseLRC('[00:01]<00:03>a<00:02>b').lines[0].words, undefined, 'decreasing times use normal highlighting');
assert.equal(parseLRC('[00:01]<00:03>a<00:02>b').lines[0].text, 'ab');
assert.equal(parseLRC('[00:01]prefix <00:02>word').lines[0].words, undefined, 'incomplete map falls back');
assert.equal(parseLRC('[00:03]<00:01>a<00:02>b').lines[0].words, undefined, 'words cannot precede their line');
assert.equal(parseLRC('[00:01]<00:99>a').lines[0].words, undefined);
assert.equal(parseLRC('[00:01]Plain <text>').lines[0].text, 'Plain <text>', 'literal text is not HTML');
assert.deepEqual(parseLRC('Untimed lyrics').lines, [{ time: -1, text: 'Untimed lyrics' }]);
const groups = groupLyricsLines([...parsed.lines.slice(0, 1), { time: 1, text: 'Translation' }, { time: 3, text: '' }, parsed.lines[1]]);
assert.deepEqual(groups[0].lines, ['君と sing!', 'Translation']);
assert.equal(groups[0].wordLines[0][0].text, '君');
assert.equal(groups[0].wordLines[1], null, 'translation without word timing stays readable');
assert.equal(currentGroupIndex(groups, 3.5), 1, 'explicit blank timestamp marks an instrumental break');

// The final word of a word-timed line has no end marker. prepareKaraokeGroups
// borrows a short capped one so the word animates instead of snapping to full.
const TAIL_MIN = 0.3, TAIL_MAX = 1.2;
const tailOf = (source, time = null) => {
  const prepared = prepareKaraokeGroups(groupLyricsLines(parseLRC(source).lines));
  const words = prepared[0].wordLines[0];
  return { prepared, last: words.at(-1), tail: words.at(-1).end - words.at(-1).start };
};
const simple = tailOf('[00:01]<00:01>one<00:02>two');
assert.equal(simple.last.end, 3, 'final word receives an end');
close(simple.tail, 1, 'tail is the typical word duration');
assert.equal(wordProgress(simple.last, 2.5), .5, 'prepared final word interpolates');
assert.equal(wordProgress(parseLRC('[00:01]<00:01>one<00:02>two').lines[0].words[1], 2.5), 1,
  'unprepared final word still snaps to full');
close(tailOf('[00:01]<00:01>aa<00:03>bb').tail, TAIL_MAX, 'long lines clamp to the maximum tail');
close(tailOf('[00:01]<00:01>aa<00:01.1>bb').tail, TAIL_MIN, 'short lines clamp to the minimum tail');
close(tailOf('[00:01]<00:01>solo').tail, 0.5, 'a single word falls back to a half-second tail');

const capped = tailOf('[00:01]<00:01>aa<00:03>bb\n[00:03.05]next');
close(capped.last.end, 3.05, 'tail never runs past the next line start');
const untimed = prepareKaraokeGroups(groupLyricsLines(parseLRC('[00:01]<00:01>aa<00:03>bb\nuntimed\n[00:09]later').lines));
close(untimed[0].wordLines[0].at(-1).end, 4.2, 'untimed groups are skipped when bounding the tail');
assert.ok(untimed[0].wordLines[0].at(-1).end > 3, 'the tail is not clipped to the untimed line');
const gap = prepareKaraokeGroups(groupLyricsLines(parseLRC('[00:01]<00:01>aa<00:03>bb\n[00:03.05]\n[00:09]later').lines));
close(gap[0].wordLines[0].at(-1).end, 3.05, 'an instrumental gap stops the tail');

const completed = groupLyricsLines(parseLRC(source).lines);
assert.equal(prepareKaraokeGroups(completed)[0].wordLines[0], completed[0].wordLines[0],
  'a line whose final word already ends is left alone');
const plainGroups = groupLyricsLines(parseLRC('[00:01]Normal line\n[00:04]Second line').lines);
assert.equal(prepareKaraokeGroups(plainGroups)[0], plainGroups[0], 'groups without word timing are returned untouched');
assert.equal(prepareKaraokeGroups(groups)[1], groups[1], 'the instrumental group is returned untouched');
assert.equal(prepareKaraokeGroups(groups)[0].wordLines[1], null, 'a translation without word timing stays readable');

console.log('Karaoke timing passed: enhanced LRC, Jellyfin text, Japanese, repeats, offsets, invalid timing, rests, pause/buffering/seek and reduced motion.');
console.log('Karaoke tail passed: capped final-word ends, next-line and instrumental-gap limits, completed and untimed groups untouched.');
