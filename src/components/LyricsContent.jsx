import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  currentLyricsTrackId,
  isTranslated,
  parsedLyrics,
  playbackCurrentTrack,
  playbackPosition,
  trackTranslationCache,
  userId,
} from '../stores/state.js';
import { getLyrics } from '../utils/api.js';
import { groupLyricsLines, normalizeLyricsPayload } from '../utils/lrcParser.js';
import { artistText } from '../utils/metadata.js';
import { seekTo } from '../utils/playbackControls.js';

function currentGroupIndex(groups, position) {
  let activeIndex = -1;
  for (let index = 0; index < groups.length; index++) {
    const time = groups[index].time;
    if (time < 0) continue;
    if (time <= position) activeIndex = index;
    else break;
  }
  return activeIndex;
}

export default function LyricsContent({ active = true, layout = 'view' }) {
  const [lyrics, setLyrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);
  const groupRefs = useRef(new Map());

  const track = playbackCurrentTrack.value;
  const trackId = track?.Id || null;

  useEffect(() => {
    if (!active || !trackId) {
      setLyrics(null);
      setLoading(false);
      return undefined;
    }

    const cached = currentLyricsTrackId.value === trackId
      && parsedLyrics.value?.lines?.some(line => String(line.text || '').trim())
      ? parsedLyrics.value
      : null;
    if (cached) {
      setLyrics(cached);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLyrics(null);
    setLoading(true);

    getLyrics(userId.value, trackId, { signal: controller.signal })
      .then(payload => {
        if (controller.signal.aborted
          || sequence !== requestSequence.current
          || playbackCurrentTrack.value?.Id !== trackId) return;

        const normalized = normalizeLyricsPayload(payload);
        setLyrics(normalized);
        if (normalized.lines.some(line => String(line.text || '').trim())) {
          parsedLyrics.value = normalized;
          currentLyricsTrackId.value = trackId;
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn('Lyrics fetch failed:', error);
          setLyrics({ lines: [] });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && sequence === requestSequence.current) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [active, trackId]);

  const groups = groupLyricsLines(lyrics?.lines || []);
  const activeIndex = currentGroupIndex(groups, playbackPosition.value);

  useEffect(() => {
    if (!active || activeIndex < 0) return undefined;
    const frame = requestAnimationFrame(() => {
      groupRefs.current.get(activeIndex)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, activeIndex, trackId]);

  const translation = track && isTranslated.value
    ? trackTranslationCache.value[track.Id]
    : null;
  const title = track ? (translation?.title || track.Name || '—') : '—';
  const artist = track
    ? (translation?.artist || artistText(track, 'Unknown Artist'))
    : 'Nothing playing';

  const lyricsBody = !track ? (
    <div class="lyrics-line">Select a track and play it first.</div>
  ) : loading ? (
    <div class="lyrics-line">Loading lyrics…</div>
  ) : groups.length === 0 ? (
    <div class="lyrics-line">No lyrics available for this track.</div>
  ) : (
    <div class="lyrics-content">
      {groups.map((group, index) => {
        const timed = group.time >= 0;
        return (
          <div
            class={`lyrics-group ${index === activeIndex ? 'active' : ''} ${timed ? 'timed' : ''}`}
            key={`${group.time}:${index}`}
            data-time={group.time}
            ref={element => {
              if (element) groupRefs.current.set(index, element);
              else groupRefs.current.delete(index);
            }}
            onClick={timed ? () => seekTo(group.time) : undefined}
          >
            {group.lines.map((line, lineIndex) => (
              <span class="lyrics-line" key={lineIndex}>{line}</span>
            ))}
          </div>
        );
      })}
    </div>
  );

  const header = (
    <div class="lyrics-view-header">
      {layout === 'popup' ? <h3>{title}</h3> : <h2>{title}</h2>}
      <div class="lyrics-view-artist">{artist}</div>
    </div>
  );

  if (layout === 'popup') {
    return (
      <div class="popup-body" id="popupBody">
        {header}
        {lyricsBody}
      </div>
    );
  }

  return (
    <>
      {header}
      <div class="lyrics-view-body">{lyricsBody}</div>
    </>
  );
}
