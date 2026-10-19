import { h } from 'preact';
import { useState } from 'preact/hooks';
import { lyricsPreference, setLyricsPreference } from '../stores/lyrics.js';
import LyricsAppearance from './LyricsAppearance.jsx';

const tags = ['LYRICS', 'UNSYNCEDLYRICS', 'UNSYNCED LYRICS', 'COMMENT', 'DESCRIPTION'];
export default function LyricsSourcePicker() {
  const preference = lyricsPreference.value;
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(preference.tag);
  const value = custom || (preference.tag && !tags.includes(preference.tag)) ? 'custom'
    : preference.tag ? `tag:${preference.tag}` : preference.source;
  return <div class="lyrics-source-picker">
    <label class="setting-row">Lyric source
      <select aria-describedby="lyric-source-help" value={value} onChange={event => {
        const next = event.currentTarget.value;
        setCustom(next === 'custom');
        if (next !== 'custom') setLyricsPreference(next.startsWith('tag:') ? 'embedded' : next, next.startsWith('tag:') ? next.slice(4) : '');
      }}>
        <option value="auto">Auto</option>
        <option value="jellyfin">Jellyfin</option>
        <option value="embedded">Embedded FLAC — auto tag</option>
        {tags.map(tag => <option key={tag} value={`tag:${tag}`}>FLAC tag: {tag}</option>)}
        <option value="custom">Custom FLAC tag…</option>
      </select>
    </label>
    {value === 'custom' && <form onSubmit={event => {
      event.preventDefault();
      if (draft.trim()) setLyricsPreference('embedded', draft);
    }}>
      <input aria-label="Custom lyric tag" placeholder="Tag name" maxLength={100} value={draft} onInput={event => setDraft(event.currentTarget.value)} />
      <button class="action-button secondary" disabled={!draft.trim()}>Apply</button>
    </form>}
    <p id="lyric-source-help" class="settings-hint">{value === 'auto'
      ? 'Try Jellyfin first, then embedded lyrics when needed.'
      : value === 'jellyfin' ? 'Use lyrics supplied by your Jellyfin server.'
        : 'Read lyrics from your original FLAC files. Choose a tag if automatic detection misses them.'}</p>
    <p class="settings-hint">Saved automatically for all tracks. Custom tags are saved when you tap Apply.</p>
    <LyricsAppearance />
  </div>;
}
