import assert from 'node:assert/strict';
import { extractLyricsFromFlac, parseFlacVorbisComments } from '../src/utils/flacLyrics.js';
import { searchLibrary } from '../src/utils/librarySearch.js';
import { fetchLyricsFromMultipleSources, LYRICS_AUDIO_RANGE } from '../src/utils/lyricsSources.js';
import {
  getCurrentLineIndex,
  groupLyricsLines,
  normalizeLyricsPayload,
} from '../src/utils/lrcParser.js';

const encoder = new TextEncoder();

function uint32LE(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function joinBytes(...parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function flacWithComments(comments) {
  const vendor = encoder.encode('C.R.A.T.E. test');
  const fields = Object.entries(comments).map(([key, value]) => encoder.encode(`${key}=${value}`));
  const payload = joinBytes(
    uint32LE(vendor.byteLength),
    vendor,
    uint32LE(fields.length),
    ...fields.flatMap(field => [uint32LE(field.byteLength), field]),
  );
  const length = new Uint8Array([
    (payload.byteLength >>> 16) & 0xff,
    (payload.byteLength >>> 8) & 0xff,
    payload.byteLength & 0xff,
  ]);
  return joinBytes(encoder.encode('fLaC'), new Uint8Array([0x84]), length, payload).buffer;
}

function textResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return text; },
  };
}

function binaryResponse(buffer, status = 206) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async arrayBuffer() { return buffer; },
  };
}

const albums = [
  { Id: 'a1', Name: 'Moonlight', AlbumArtist: 'Alpha' },
  { Id: 'a2', Name: 'Sunrise', ArtistItems: [{ Name: 'Beta' }] },
  { Id: 'a3', Name: 'Quiet', AlbumArtist: 'Gamma' },
];
const tracks = [
  { Id: 't1', Name: 'First', Artists: ['Singer One'] },
  { Id: 't2', Name: 'Second', ArtistNames: ['Singer Two'] },
  { Id: 't3', Name: 'Third', ArtistItems: [{ Name: 'Singer Three' }] },
];
const albumTranslations = { a3: { title: 'Loud Night', artist: 'Delta Voice' } };
const trackTranslations = { t3: { title: 'Last Song', artist: 'Translated Singer' } };

assert.deepEqual(searchLibrary(' moon ', albums, tracks, albumTranslations, trackTranslations).albums.map(a => a.Id), ['a1']);
assert.deepEqual(searchLibrary('BETA', albums, tracks, albumTranslations, trackTranslations).albums.map(a => a.Id), ['a2']);
assert.deepEqual(searchLibrary('two', albums, tracks, albumTranslations, trackTranslations).tracks.map(t => t.Id), ['t2']);
assert.deepEqual(searchLibrary('three', albums, tracks, albumTranslations, trackTranslations).tracks.map(t => t.Id), ['t3']);
assert.deepEqual(searchLibrary('loud', albums, tracks, albumTranslations, trackTranslations).albums.map(a => a.Id), ['a3']);
assert.deepEqual(searchLibrary('delta', albums, tracks, albumTranslations, trackTranslations).albums.map(a => a.Id), ['a3']);
assert.deepEqual(searchLibrary('last', albums, tracks, albumTranslations, trackTranslations).tracks.map(t => t.Id), ['t3']);
assert.deepEqual(searchLibrary('translated', albums, tracks, albumTranslations, trackTranslations).tracks.map(t => t.Id), ['t3']);
assert.deepEqual(searchLibrary(' ', albums, tracks).tracks, []);

const manyTracks = Array.from({ length: 75 }, (_, index) => ({ Id: `many-${index}`, Name: `Match ${index}` }));
const manyResults = searchLibrary('m', [], manyTracks).tracks;
assert.equal(manyResults.length, 75);
assert.deepEqual(manyResults.map(track => track.Id), manyTracks.map(track => track.Id));
assert.equal(manyTracks[0].Name, 'Match 0');

for (const tag of ['LYRICS', 'UNSYNCED LYRICS', 'UNSYNCEDLYRICS', 'CUSTOM_LYRIC_TEXT']) {
  const buffer = flacWithComments({ [tag]: '[00:01.00]Embedded' });
  assert.equal(extractLyricsFromFlac(buffer), '[00:01.00]Embedded');
}
assert.equal(parseFlacVorbisComments(flacWithComments({ TITLE: 'Example' })).TITLE, 'Example');
assert.equal(extractLyricsFromFlac(new Uint8Array([1, 2, 3]).buffer), null);

const endpointCalls = [];
const endpointLyrics = await fetchLyricsFromMultipleSources({
  fetchImpl: async (url, options) => {
    endpointCalls.push([url, options]);
    return textResponse('[00:01.00]Endpoint');
  },
  endpointUrl: 'endpoint',
  originalAudioUrl: 'original',
  transcodedFlacUrl: 'transcoded',
});
assert.equal(endpointLyrics, '[00:01.00]Endpoint');
assert.deepEqual(endpointCalls.map(([url]) => url), ['endpoint']);

const sectionLyrics = await fetchLyricsFromMultipleSources({
  fetchImpl: async () => textResponse('[Verse 1]\nPlain endpoint lyrics'),
  endpointUrl: 'endpoint',
  originalAudioUrl: 'original',
  transcodedFlacUrl: 'transcoded',
});
assert.equal(sectionLyrics, '[Verse 1]\nPlain endpoint lyrics');

const originalCalls = [];
const originalLyrics = await fetchLyricsFromMultipleSources({
  fetchImpl: async (url, options) => {
    originalCalls.push([url, options]);
    if (url === 'endpoint') return textResponse('', 404);
    return binaryResponse(flacWithComments({ LYRICS: 'Original audio lyrics' }));
  },
  endpointUrl: 'endpoint',
  originalAudioUrl: 'original',
  transcodedFlacUrl: 'transcoded',
});
assert.equal(originalLyrics, 'Original audio lyrics');
assert.deepEqual(originalCalls.map(([url]) => url), ['endpoint', 'original']);
assert.equal(originalCalls[1][1].headers.Range, LYRICS_AUDIO_RANGE);

const fallbackCalls = [];
const transcodedLyrics = await fetchLyricsFromMultipleSources({
  fetchImpl: async (url, options) => {
    fallbackCalls.push([url, options]);
    if (url === 'endpoint') return textResponse('   ');
    if (url === 'original') return binaryResponse(new Uint8Array([0, 1, 2]).buffer, 200);
    return binaryResponse(flacWithComments({ UNSYNCEDLYRICS: 'Transcoded lyrics' }), 200);
  },
  endpointUrl: 'endpoint',
  originalAudioUrl: 'original',
  transcodedFlacUrl: 'transcoded',
});
assert.equal(transcodedLyrics, 'Transcoded lyrics');
assert.deepEqual(fallbackCalls.map(([url]) => url), ['endpoint', 'original', 'transcoded']);
assert.equal(fallbackCalls[2][1].headers.Range, LYRICS_AUDIO_RANGE);

const nothing = await fetchLyricsFromMultipleSources({
  fetchImpl: async url => url === 'endpoint'
    ? textResponse('<html>Not lyrics</html>')
    : binaryResponse(new Uint8Array([0, 1]).buffer),
  endpointUrl: 'endpoint',
  originalAudioUrl: 'original',
  transcodedFlacUrl: 'transcoded',
});
assert.equal(nothing, null);

assert.deepEqual(normalizeLyricsPayload({ Lyrics: '[00:02.00]Text' }).lines, [{ time: 2, text: 'Text' }]);
assert.deepEqual(normalizeLyricsPayload({ Lyrics: [{ StartTicks: 30000000, Text: 'Ticks' }] }).lines, [{ time: 3, text: 'Ticks' }]);
assert.deepEqual(normalizeLyricsPayload([{ Start: 40000000, Text: 'Direct' }, { Text: 'Untimed' }]).lines, [
  { time: 4, text: 'Direct' },
  { time: -1, text: 'Untimed' },
]);
assert.deepEqual(normalizeLyricsPayload([
  { StartTicks: 50000000, Text: 'Later' },
  { StartTicks: 10000000, Text: 'Earlier' },
]).lines, [
  { time: 1, text: 'Earlier' },
  { time: 5, text: 'Later' },
]);

const grouped = groupLyricsLines([
  { time: 1, text: 'Line one' },
  { time: 1, text: 'Line two' },
  { time: 3, text: 'Line three' },
  { time: -1, text: 'Plain' },
]);
assert.deepEqual(grouped, [
  { time: 1, lines: ['Line one', 'Line two'] },
  { time: 3, lines: ['Line three'] },
  { time: -1, lines: ['Plain'] },
]);
assert.equal(getCurrentLineIndex([{ time: -1, text: 'Plain' }], 10), -1);

console.log('library and lyrics smoke test passed');
