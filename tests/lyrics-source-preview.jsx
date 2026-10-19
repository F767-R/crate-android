// Isolated integration fixture: no real server requests or playback.
import { h, render } from 'preact';
import '../src/styles.css';
import { playbackCurrentTrack, userId } from '../src/stores/state.js';
import { setLyricsPreference } from '../src/stores/lyrics.js';
import LyricsContent from '../src/components/LyricsContent.jsx';
import { config } from '../src/config.js';

config.SERVER = location.origin;
config.API_KEY = 'lyrics-fixture-only';
const encoder = new TextEncoder();
const fields = ['LYRICS=[00:01]Embedded verse', 'COMMENT=[00:02]Comment verse', 'MY_TEXT=[00:03]Custom verse'];
const parts = fields.map(field => encoder.encode(field));
const size = 8 + parts.reduce((total, part) => total + 4 + part.length, 0);
const buffer = new Uint8Array(8 + size);
buffer.set(encoder.encode('fLaC'));
buffer.set([0x84, size >>> 16, (size >>> 8) & 255, size & 255], 4);
const view = new DataView(buffer.buffer);
view.setUint32(12, parts.length, true);
let offset = 16;
for (const part of parts) { view.setUint32(offset, part.length, true); offset += 4; buffer.set(part, offset); offset += part.length; }
window.fetch = async input => {
  const url = new URL(input);
  if (url.pathname.endsWith('/Lyrics')) return new Response('[00:01]Jellyfin verse');
  if (url.pathname.endsWith('/stream') && url.searchParams.get('Static') === 'true') return new Response(buffer, { status: 206 });
  throw new Error('Unexpected fixture request');
};
setLyricsPreference('auto');
userId.value = 'fixture-user';
playbackCurrentTrack.value = { Id: 'fixture-track', Name: 'Lyric source preview', Artists: ['Fixture artist'] };
render(<div class="app" style={{ width: '390px', maxWidth: '100%' }}><main id="main"><div class="lyrics-view"><LyricsContent /></div></main></div>, document.getElementById('app'));

// Exercise actual component events and effects for headless verification.
if (new URL(location.href).searchParams.has('test')) {
  const waitFor = async text => {
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('.lyrics-content')?.textContent.includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Missing lyric: ${text}`);
  };
  const select = value => {
    const element = document.querySelector('.lyrics-source-picker select');
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  try {
    await waitFor('Jellyfin verse');
    select('tag:COMMENT');
    await waitFor('Comment verse');
    select('embedded');
    await waitFor('Embedded verse');
    select('custom');
    await new Promise(resolve => setTimeout(resolve, 40));
    const input = document.querySelector('.lyrics-source-picker input');
    input.value = 'MY_TEXT';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    document.querySelector('.lyrics-source-picker form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor('Custom verse');
    select('jellyfin');
    await waitFor('Jellyfin verse');
    document.body.dataset.viewport = `${innerWidth}/${document.documentElement.clientWidth}/${document.querySelector('.lyrics-source-picker').getBoundingClientRect().right}`;
    document.body.dataset.testResult = 'passed';
  } catch (error) { document.body.dataset.testResult = `failed: ${error.message}`; }
}
