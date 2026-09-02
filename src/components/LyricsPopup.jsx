import { h } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import {
  lyricsVisible,
  currentLyricsTrackId,
  previousViewState,
  playbackCurrentTrack,
  isTranslated,
  trackTranslationCache,
  playbackPosition,
  userId
} from '../stores/state.js';
import { getLyrics } from '../utils/api.js';
import { audioShim } from '../utils/playerShim.js';
import { armClickSuppression } from '../utils/clickSuppression.js';
import { parseLRC, getCurrentLineIndex } from '../utils/lrcParser.js';
import { artistText } from '../utils/metadata.js';
import { navigateToView } from '../utils/navigation.js';

export default function LyricsPopup() {
  const [lyrics, setLyrics] = useState(null);
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(false);
  const groupRefs = useRef(new Map()); // idx -> DOM element

  const open = lyricsVisible.value;

  useEffect(() => {
    if (!open) return;
    const t = playbackCurrentTrack.value;
    if (!t) return;

    if (currentLyricsTrackId.value === t.Id && lyrics && lyrics.trackId === t.Id) {
      setTrack(t);
      return;
    }
    setTrack(t);
    setLoading(true);
    getLyrics(userId.value, t.Id)
      .then(data => {
        if (!data) {
          setLyrics({ trackId: t.Id, lines: [] });
          currentLyricsTrackId.value = t.Id;
          setLoading(false);
          return;
        }
        let parsed;
        if (typeof data === 'string') {
          parsed = parseLRC(data);
        } else if (data.Lyrics && typeof data.Lyrics === 'string') {
          parsed = parseLRC(data.Lyrics);
        } else if (Array.isArray(data.Lyrics)) {
          parsed = {
            lines: data.Lyrics.map(line => ({
              time: Number(line.Start ?? line.StartTicks ?? 0) / 10000000,
              text: line.Text || '',
            })),
          };
        } else if (Array.isArray(data)) {
          parsed = { lines: data.map(l => ({ time: (l.Start || 0) / 1e7, text: l.Text || '' })) };
        } else {
          parsed = { lines: [] };
        }
        setLyrics({ trackId: t.Id, lines: parsed.lines });
        currentLyricsTrackId.value = t.Id;
        setLoading(false);
      })
      .catch(err => {
        console.warn('Lyrics fetch failed:', err);
        setLyrics({ trackId: t.Id, lines: [] });
        currentLyricsTrackId.value = t.Id;
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, playbackCurrentTrack.value?.Id]);

  // Scroll active line into view
  useEffect(() => {
    if (!open || !lyrics || !lyrics.lines || lyrics.lines.length === 0) return;
    const idx = getCurrentLineIndex(lyrics.lines, playbackPosition.value);
    if (idx < 0) return;
    const el = groupRefs.current.get(idx);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [playbackPosition.value, open, lyrics]);

  const close = () => {
    lyricsVisible.value = false;
    armClickSuppression();
  };

  const goBack = () => {
    const prev = previousViewState.value;
    previousViewState.value = null;
    navigateToView(prev || { type: 'grid' });
  };

  const handleLyricsClick = (e) => {
    const group = e.target.closest('.lyrics-group.timed');
    if (!group) return;
    const idx = parseInt(group.dataset.idx, 10);
    if (!isFinite(idx) || !lyrics || !lyrics.lines[idx]) return;
    const t = lyrics.lines[idx].time;
    if (typeof t === 'number' && t >= 0) {
      audioShim.seek(t);
    }
  };

  if (!open) return null;

  const title = track
    ? (isTranslated.value && trackTranslationCache.value[track.Id] ? trackTranslationCache.value[track.Id].title : track.Name)
    : '—';
  const artist = track
    ? (isTranslated.value && trackTranslationCache.value[track.Id] ? trackTranslationCache.value[track.Id].artist : artistText(track, ''))
    : 'Nothing playing';

  return (
    <div id="lyricsPopup" class="popup-overlay open">
      <div class="popup-header">
        <h4 id="popupTitle">Lyrics</h4>
        <button id="closePopupBtn" title="Close lyrics" onClick={close}>✕</button>
      </div>
      <div class="popup-body" id="popupBody" onClick={handleLyricsClick}>
        <div class="lyrics-view-header">
          <h3>{title}</h3>
          <div class="lyrics-view-artist">{artist}</div>
        </div>
        {loading ? (
          <div>Loading lyrics…</div>
        ) : !lyrics || !lyrics.lines || lyrics.lines.length === 0 ? (
          <div>No lyrics available for this track.</div>
        ) : (
          <div class="lyrics-content">
            {lyrics.lines.map((line, i) => {
              const current = playbackPosition.value;
              const nextTime = lyrics.lines[i + 1]?.time ?? Infinity;
              const isTimed = typeof line.time === 'number' && line.time >= 0;
              const isActive = isTimed && current >= line.time && current < nextTime;
              return (
                <div
                  class={`lyrics-group ${isActive ? 'active' : ''} ${isTimed ? 'timed' : ''}`}
                  key={i}
                  data-idx={i}
                  data-time={line.time}
                  ref={el => { if (el) groupRefs.current.set(i, el); else groupRefs.current.delete(i); }}
                >
                  <span class="lyrics-line">{line.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div class="popup-footer">
        <button onClick={goBack}>← Back</button>
      </div>
    </div>
  );
}
