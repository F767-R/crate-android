// Local-only lyrics fixture. No real music, server credentials, or native calls.
import { h, render } from 'preact';
import '../src/styles.css';
import LyricsView from '../src/components/LyricsView.jsx';
import PlayerBar from '../src/components/PlayerBar.jsx';
import MiniPlayer from '../src/components/MiniPlayer.jsx';
import SettingsPanel from '../src/components/SettingsPanel.jsx';
import * as state from '../src/stores/state.js';
import { setLyricsPreference, setKaraokeEnabled, karaokeEnabled, setLyricsFontScale, setAccentEnabled, setRomajiEnabled } from '../src/stores/lyrics.js';
import { audioShim } from '../src/utils/playerShim.js';
import { config } from '../src/config.js';
const sample = '[00:01]<00:01>君<00:02>と <00:03>歌う<00:05>\n[00:01]A translation stays readable\n[00:05]\n[00:07]<00:07>One <00:08>word <00:09>at a time<00:11>\n' + Array.from({length: 16}, (_, i) => `[00:${12 + i * 2}]${i % 2 ? 'A long lyric line that wraps naturally without changing size' : '今ここから始まる物語'}`).join('\n');
const normal = '[00:01]Normal line timing\n[00:07]No invented word timing';
const plain = 'Plain lyrics with no timestamps';
let fixturePayload = sample;
let artRequests = 0;
config.SERVER = location.origin;
config.API_KEY = 'karaoke-fixture-only';
window.fetch = async input => {
  if (new URL(input, location.href).pathname.endsWith('/Lyrics')) return new Response(fixturePayload);
  if (new URL(input, location.href).pathname.endsWith('/Images/Primary')) {
    artRequests++;
    if (String(input).includes('missing-art')) return new Response('', {status:404});
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ee4488"/></svg>', {headers:{'Content-Type':'image/svg+xml'}});
  }
  throw new Error('Unexpected fixture request');
};
audioShim.seek = async time => { state.playbackPosition.value = time; return true; };
audioShim.pause = async () => { state.playbackPlaying.value = false; return true; };
audioShim.resume = async () => { state.playbackPlaying.value = true; return true; };
const track = { Id: 'karaoke-fixture', AlbumId: 'fixture-album', Name: '君と歌う — A song for the evening', Artists: ['Fixture Artist'], RunTimeTicks: 600000000 };
state.playbackCurrentTrack.value = track;
state.playbackTrackId.value = track.Id;
state.playbackDuration.value = 60;
state.playbackPosition.value = 1.5;
state.playbackPlaying.value = false;
state.userId.value = 'fixture-user';
state.currentViewState.value = { type: 'lyrics' };
setLyricsPreference('jellyfin');
setKaraokeEnabled(true);
setLyricsFontScale(1);
setAccentEnabled(true);
setRomajiEnabled(true);
function Fixture() {
  return <div class={`app ${state.currentViewState.value.type === 'lyrics' ? 'lyrics-mode' : ''}`}>
    <div class="lyrics-backdrop" aria-hidden="true" style="background:radial-gradient(at 15% 15%,#66465f,#253941 60%,#14191f)" />
    <main id="main"><div class="view-stage"><LyricsView /></div></main>
    <SettingsPanel /><PlayerBar /><MiniPlayer />
  </div>;
}
render(<Fixture />, document.getElementById('app'));

if (new URL(location.href).searchParams.has('test')) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async predicate => { for(let i=0;i<100;i++){if(predicate()) return; await wait(30);} throw new Error('Fixture did not settle'); };
  const word = () => document.querySelector('.lyrics-group.active .lyric-word');
  const fill = () => parseFloat(word()?.style.getPropertyValue('--word-fill'));
  const load = async (payload, id) => {
    fixturePayload = payload;
    state.playbackCurrentTrack.value = {...track, Id:id};
    state.playbackTrackId.value = id;
    await ready(() => state.currentLyricsTrackId.value === id && document.querySelector('.lyrics-content')?.textContent.includes(payload === normal ? 'Normal line' : payload === plain ? 'Plain lyrics' : '君'));
  };
  try {
    await ready(() => fill() === 50);
    const lyricHost = () => document.querySelector('.lyrics-view-body');
    await ready(() => lyricHost().style.getPropertyValue('--lyrics-accent').startsWith('hsl('));
    check(artRequests === 1, 'artwork fetched more than once');
    setAccentEnabled(false);
    await ready(() => lyricHost().style.getPropertyValue('--lyrics-accent') === '#fff');
    setAccentEnabled(true);
    await ready(() => lyricHost().style.getPropertyValue('--lyrics-accent').startsWith('hsl('));
    check(artRequests === 1, 'artwork preference toggle bypassed the shared image cache');
    const words = document.querySelectorAll('.lyrics-group.active .lyric-word');
    check(words[1].tagName === 'BUTTON' && words[1].getAttribute('aria-label'), 'word seek is not an accessible button');
    words[1].click();
    await ready(() => state.playbackPosition.value === 2);
    check(!state.playbackPlaying.value, 'word seek resumed a paused track');
    state.playbackPosition.value = 1.5;
    await ready(() => fill() === 50);
    const secondaryToggle = document.querySelector('.secondary-lyrics-toggle');
    check(secondaryToggle?.getAttribute('aria-label') === 'Romaji / translations', 'missing shared secondary-line toggle');
    secondaryToggle.click();
    await ready(() => !document.querySelector('.lyrics-group.active .secondary-lyric'));
    check(!document.querySelector('.lyrics-group.active').getAttribute('aria-label').includes('A translation'), 'hidden secondary line remains in accessible name');
    document.querySelector('.karaoke-toggle').click();
    await ready(() => !document.querySelector('.lyric-word'));
    check(document.querySelector('.lyrics-group.active .secondary-lyric')?.textContent === 'A translation stays readable', 'normal mode hides translations when preference is off');
    document.querySelector('.karaoke-toggle').click();
    await ready(() => !!document.querySelector('.secondary-lyrics-toggle'));
    document.querySelector('.secondary-lyrics-toggle').click();
    await ready(() => !!document.querySelector('.lyrics-group.active .secondary-lyric'));
    state.settingsVisible.value = true;
    await ready(() => !!document.querySelector('.lyrics-appearance input[type="range"]'));
    const sizeInput = document.querySelector('.lyrics-appearance input[type="range"]');
    const sliderWidth = sizeInput.getBoundingClientRect().width;
    check(sizeInput.min === '0.7' && sizeInput.max === '1.3', 'wrong text-size bounds');
    sizeInput.value = '1.3';
    sizeInput.dispatchEvent(new Event('input', {bubbles:true}));
    await ready(() => lyricHost().style.getPropertyValue('--lyrics-scale') === '1.3');
    check(localStorage.getItem('crateLyricsFontScale') === '1.3', 'font size is not saved');
    check(parseFloat(getComputedStyle(document.querySelector('.lyrics-content')).fontSize) > parseFloat(getComputedStyle(lyricHost()).fontSize) * 1.29, 'font-size CSS is not applied');
    for (const size of ['0.95', '0.8', '0.7', '1.3']) {
      sizeInput.value = size;
      sizeInput.dispatchEvent(new Event('input', {bubbles:true}));
      await ready(() => lyricHost().style.getPropertyValue('--lyrics-scale') === size);
      check(Math.abs(sizeInput.getBoundingClientRect().width - sliderWidth) < 1, 'slider width changes with percentage label');
    }
    sizeInput.value = '1';
    sizeInput.dispatchEvent(new Event('input', {bubbles:true}));
    state.settingsVisible.value = false;
    await ready(() => fill() === 50);
    await wait(250);
    check(fill() === 50, 'paused karaoke moved');
    state.playbackPosition.value = 2.5;
    await ready(() => document.querySelectorAll('.lyrics-group.active .lyric-word')[1]?.style.getPropertyValue('--word-fill') === '50%');
    state.playbackPosition.value = 1.25;
    await ready(() => fill() === 25);
    state.playbackBuffering.value = true;
    state.playbackPlaying.value = true;
    await wait(250);
    check(fill() === 25, 'buffering karaoke moved');
    state.playbackPlaying.value = false;
    state.playbackBuffering.value = false;
    document.querySelector('.karaoke-toggle').click();
    await ready(() => !document.querySelector('.lyric-word'));
    check(document.querySelector('.lyrics-group.active').textContent.includes('君と 歌う'), 'normal text changed');
    check(parseFloat(getComputedStyle(document.querySelector('.lyrics-group[data-time="12"]')).opacity) === 1,
      'depth-of-field dimming leaks into non-karaoke mode');
    // A translated or romaji line must survive with Karaoke off: it arrives in
    // exactly this shape, so hiding it would drop the translation.
    check(document.querySelector('.lyrics-group.active').textContent.includes('A translation stays readable'),
      'non-karaoke mode hides the translated line');
    document.querySelector('.karaoke-toggle').click();
    await ready(() => fill() === 25);
    check(localStorage.getItem('crateKaraokeEnabled') === 'true', 'toggle was not saved');
    const stateOf = () => [...document.querySelectorAll('.lyrics-group.active .lyric-word')].map(node => node.dataset.state);
    const progressOf = node => parseFloat(node.style.getPropertyValue('--word-progress'));
    await ready(() => stateOf().join() === 'active,upcoming,upcoming');
    check(progressOf(document.querySelector('.lyrics-group.active .lyric-word')) > 0, 'active word is missing --word-progress');
    check(stateOf().filter(value => value === 'sung').length === 0, 'nothing is sung before the first word ends');
    state.playbackPosition.value = 3.5;
    await ready(() => stateOf().join() === 'sung,sung,active');
    check(progressOf(document.querySelectorAll('.lyrics-group.active .lyric-word')[2]) > 0
      && progressOf(document.querySelectorAll('.lyrics-group.active .lyric-word')[2]) < 1, 'partly sung word is not interpolating');
    state.playbackPosition.value = 1.25;
    await ready(() => fill() === 25);
    const activeGroup = document.querySelector('.lyrics-group.active');
    const dist = row => parseFloat(row.style.getPropertyValue('--dist'));
    check(dist(activeGroup) === 0, 'the active line is not at zero distance');
    const distant = document.querySelector('.lyrics-group[data-time="12"]');
    check(dist(distant) > 0, 'a distant line carries no --dist');
    check(parseFloat(getComputedStyle(distant).opacity) < 1, 'distant lines are not dimmed in karaoke mode');
    const gap = document.querySelector('.lyrics-group.instrumental .gap-dots');
    check(gap?.children.length === 3, 'the instrumental line has no three gap dots');
    const romaji = activeGroup.querySelector('.lyrics-line.secondary-lyric');
    check(romaji?.textContent === 'A translation stays readable', 'the stacked line is not marked as romaji');
    check(activeGroup.getAttribute('aria-label')?.includes('A translation stays readable'),
      'the accessible name drops the translated line');
    // Specificity guard: the chorus rule sets .82em on the second line of a
    // group, so an unscoped .lyrics-line.secondary-lyric would silently lose its size.
    check(parseFloat(getComputedStyle(romaji).fontSize) < parseFloat(getComputedStyle(activeGroup.querySelector('.lyrics-line')).fontSize),
      'the romaji line is not smaller than the original');
    state.playbackPosition.value = 7;
    await ready(() => document.querySelector('.lyrics-group.active')?.dataset.time === '7');
    state.playbackPosition.value = 7.5;
    await ready(() => document.querySelector('.lyrics-group[data-time="7"] .lyric-word')?.dataset.state === 'active');
    state.playbackPosition.value = 1.25;
    await ready(() => fill() === 25);
    check(!document.querySelector('.lyrics-group[data-time="7"] .lyric-word[data-state="active"]'),
      'backward seek leaves a future word glowing');
    state.playbackPosition.value = 7;
    await ready(() => document.querySelector('.lyrics-group.active')?.dataset.time === '7');
    const host = document.querySelector('.lyrics-view-body');
    host.dispatchEvent(new WheelEvent('wheel', {deltaY: 80}));
    await ready(() => !!document.querySelector('.lyrics-follow button'));
    await wait(3000);
    host.dispatchEvent(new WheelEvent('wheel', {deltaY: 80}));
    await wait(2200);
    check(!!document.querySelector('.lyrics-follow button'), 'follow resumed before five seconds after latest interaction');
    await wait(3100);
    await ready(() => !document.querySelector('.lyrics-follow button'));
    const row = document.querySelector('.lyrics-group[data-time="12"]');
    row.click();
    await ready(() => state.playbackPosition.value === 12);
    check(!state.playbackPlaying.value, 'lyric seek started paused playback');
    await load(normal, 'normal-fixture');
    check(karaokeEnabled.value && !document.querySelector('.lyric-word'), 'normal lyrics did not fall back');
    check(document.querySelector('.lyrics-mode-hint')?.textContent === 'Line timing only', 'missing fallback hint');
    await load(plain, 'plain-fixture');
    check(!document.querySelector('.lyrics-group[role="button"]'), 'untimed lyric seeks');
    await load('[00:01]<00:01>' + '君と歌う長い言葉'.repeat(13) + '<00:05>', 'long-word-fixture');
    const longHost = document.querySelector('.lyrics-view-body');
    check(longHost.scrollWidth <= longHost.clientWidth + 1, 'a long timed segment overflows horizontally');
    const rapid = '[00:01]' + Array.from({length:12}, (_, i) => `<00:${(1+i*.08).toFixed(2)}>君`).join('') + '<00:01.96>';
    await load(rapid, 'rapid-fixture');
    await ready(() => document.querySelectorAll('.lyric-word').length === 12);
    for (let i=0; i<12; i++) {
      state.playbackPosition.value = 1 + i * .08 + .04;
      await ready(() => document.querySelectorAll('.lyrics-group.active .lyric-word')[i]?.dataset.state === 'active');
      const activeWords = document.querySelectorAll('.lyrics-group.active .lyric-word[data-state="active"]');
      check(activeWords.length === 1, 'rapid words leave extra active highlights');
      const transform = new DOMMatrixReadOnly(getComputedStyle(activeWords[0]).transform);
      check(Math.abs(transform.a - 1.05) < .001 && Math.abs(transform.d - 1.05) < .001, 'fast syllable does not reach 105%');
      check(transform.e === 0 && transform.f === 0, 'highlight translates instead of scaling in place');
      check(Number(activeWords[0].style.getPropertyValue('--word-scale')) === 1.05, 'incorrect rapid scale');
      check(Number(activeWords[0].style.getPropertyValue('--word-glow')) === 0, 'rapid word flashes');
    }
    await load(sample, 'restored-fixture');
    state.playbackPosition.value = 1.5;
    await ready(() => fill() === 50);
    const bottom = document.querySelector('.lyrics-view-body').getBoundingClientRect().bottom;
    check(bottom <= document.querySelector('#playerBar').getBoundingClientRect().top + 1, 'lyrics overlap player');
    check(document.querySelector('#miniPlayer').inert, 'duplicate mini-player is accessible');
    state.playbackCurrentTrack.value = {...track, Id:'missing-cover-fixture', AlbumId:'missing-art'};
    await ready(() => lyricHost().style.getPropertyValue('--lyrics-accent') === '#fff');
    check(!lyricHost().style.getPropertyValue('--lyrics-accent').startsWith('hsl('), 'stale cover color leaked across tracks');
    await load(sample, 'final-fixture');
    await ready(() => lyricHost().style.getPropertyValue('--lyrics-accent').startsWith('hsl('));
    document.body.dataset.testResult = 'passed';
  } catch (error) { document.body.dataset.testResult = `failed: ${error.message}`; }
}
