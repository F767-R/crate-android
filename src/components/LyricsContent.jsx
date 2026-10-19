import { h } from 'preact';
import { effect } from '@preact/signals';
import { currentGroupIndex, createLyricClock, wordProgress, wordGlow, wordScale, LYRIC_FOLLOW_DELAY } from '../utils/lyricsTiming.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  currentLyricsTrackId,
  isTranslated,
  parsedLyrics,
  playbackCurrentTrack,
  playbackPosition,
  playbackPlaying,
  playbackBuffering,
  trackTranslationCache,
  userId,
  settingsVisible,
  allAlbums,
} from '../stores/state.js';
import { getLyrics } from '../utils/api.js';
import { groupLyricsLines, normalizeLyricsPayload, prepareKaraokeGroups } from '../utils/lrcParser.js';
import { artistText } from '../utils/metadata.js';
import { seekTo } from '../utils/playbackControls.js';
import { safeRequestError } from '../utils/request.js';
import {
  lyricsPreference, cachedLyricsSource, karaokeEnabled, setKaraokeEnabled,
  lyricsFontScale, romajiEnabled, setRomajiEnabled, accentEnabled,
} from '../stores/lyrics.js';
import { accentFromImage } from '../utils/accentColor.js';
import { useArtwork } from '../utils/useArtwork.js';
import { hideLyricsView } from '../utils/navigation.js';

export default function LyricsContent({ active = true, layout = 'view' }) {
  const [lyrics, setLyrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const requestSequence = useRef(0);
  const groupRefs = useRef(new Map());
  const wordRefs = useRef(new Map());
  const bodyRef = useRef(null);
  const lastScroll = useRef(null);
  const [following, setFollowing] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [viewportSize, setViewportSize] = useState('');

  const track = playbackCurrentTrack.value;
  const trackId = track?.Id || null;
  const preference = lyricsPreference.value;
  const sourceKey = JSON.stringify(preference);
  const karaoke = karaokeEnabled.value;
  const scale = lyricsFontScale.value;
  const romajiOn = romajiEnabled.value;
  const accentOn = accentEnabled.value;
  const album = allAlbums.value.find(item => item.Id === track?.AlbumId);
  const { url: artworkUrl } = useArtwork({
    itemId: track?.AlbumId || trackId,
    imageTag: album?.ImageTags?.Primary || track?.AlbumPrimaryImageTag || '',
    lazy: false,
    enabled: active && accentOn && karaoke,
  });
  const [accent, setAccent] = useState({ url: '', color: null });
  const bodyStyle = {
    '--lyrics-scale': scale,
    '--lyrics-accent': accentOn && accent.url === artworkUrl ? accent.color || '#fff' : '#fff',
  };

  useEffect(() => {
    if (!artworkUrl) return;
    const controller = new AbortController();
    accentFromImage(artworkUrl, { signal: controller.signal }).then(color => {
      if (!controller.signal.aborted) setAccent({ url: artworkUrl, color });
    });
    return () => controller.abort();
  }, [artworkUrl]);

  useEffect(() => {
    setError('');
    if (!active || !trackId) {
      setLyrics(null);
      setLoading(false);
      return undefined;
    }

    const cached = currentLyricsTrackId.value === trackId
      && cachedLyricsSource.value === sourceKey
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

    getLyrics(userId.value, trackId, { signal: controller.signal, ...preference })
      .then(payload => {
        if (controller.signal.aborted
          || sequence !== requestSequence.current
          || playbackCurrentTrack.value?.Id !== trackId) return;

        const normalized = normalizeLyricsPayload(payload);
        setLyrics(normalized);
        if (normalized.lines.some(line => String(line.text || '').trim())) {
          parsedLyrics.value = normalized;
          currentLyricsTrackId.value = trackId;
          cachedLyricsSource.value = sourceKey;
        }
      })
      .catch(error => {
        if (!controller.signal.aborted
          && sequence === requestSequence.current
          && playbackCurrentTrack.value?.Id === trackId) {
          setError(safeRequestError(error, 'Lyrics could not be loaded. Check your connection and retry.'));
          setLyrics({ lines: [] });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && sequence === requestSequence.current) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [active, trackId, retryCount, sourceKey]);

  const baseGroups = useMemo(() => groupLyricsLines(lyrics?.lines || []), [lyrics]);
  const groups = useMemo(() => prepareKaraokeGroups(baseGroups), [baseGroups]);
  const hasWords = groups.some(group => group.wordLines?.some(words => words?.length));
  const hasText = groups.some(group => group.lines.some(line => line.trim()));
  const hasSecondaryLines = groups.some(group => group.lines.length > 1);

  // Update the highlighted group only at a boundary, not the whole view each frame.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let playing = false, buffering = false;
    const clock = createLyricClock();
    let previous = -2;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const setWords = (index, time) => {
      for (const { node, word } of wordRefs.current.get(index)?.values() || []) {
        const p = wordProgress(word, time, reducedMotion.matches);
        node.style.setProperty('--word-fill', `${p * 100}%`);
        node.style.setProperty('--word-progress', p.toFixed(3));
        node.style.setProperty('--word-scale', wordScale(p, reducedMotion.matches).toFixed(4));
        node.style.setProperty('--word-glow', wordGlow(word, p, reducedMotion.matches).toFixed(3));
        const state = p >= 1 ? 'sung' : p > 0 ? 'active' : 'upcoming';
        if (node.dataset.state !== state) node.dataset.state = state;
      }
    };
    const update = () => {
      const time = clock.read(performance.now());
      const next = currentGroupIndex(groups, time);
      if (next !== previous) {
        // Finish a passed line, or clear it when seeking backward so a future
        // word cannot retain its glow from the previous playback position.
        if (karaoke && previous >= 0) setWords(previous, next > previous ? Infinity : -Infinity);
        previous = next;
        setActiveIndex(next);
      }
      if (karaoke) setWords(next, time);

      // Instrumental gap: publish 0-1 progress for the dots.
      const group = groups[next];
      if (group && !group.lines.some(line => line.trim())) {
        const end = groups[next + 1]?.time;
        if (end > group.time) {
          const p = Math.min(1, Math.max(0, (time - group.time) / (end - group.time)));
          groupRefs.current.get(next)?.style.setProperty('--gap-progress', p.toFixed(3));
        }
      }
    };
    const tick = () => { update(); frame = requestAnimationFrame(tick); };
    const schedule = () => {
      cancelAnimationFrame(frame);
      update();
      // A boundary update can mount word spans after this signal effect runs.
      // Paint once after that commit even when playback is paused.
      if (!document.hidden) frame = requestAnimationFrame(playing && !buffering ? tick : update);
    };
    const dispose = effect(() => {
      const position = playbackPosition.value;
      playing = playbackPlaying.value;
      buffering = playbackBuffering.value;
      clock.sample(position, performance.now(), playing, buffering);
      schedule();
    });
    document.addEventListener('visibilitychange', schedule);
    reducedMotion.addEventListener('change', schedule);
    return () => { dispose(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', schedule); reducedMotion.removeEventListener('change', schedule); };
  }, [active, groups, trackId, karaoke, romajiOn]);

  useEffect(() => {
    setFollowing(true);
    lastScroll.current = null;
  }, [trackId, sourceKey, active]);

  useEffect(() => {
    const host = bodyRef.current;
    if (!active || !host) return;
    const observer = new ResizeObserver(() => {
      host.style.setProperty('--lyrics-anchor', `${host.clientHeight * .3}px`);
      host.style.setProperty('--lyrics-tail', `${host.clientHeight * .7}px`);
      lastScroll.current = null;
      setViewportSize(`${host.clientWidth}:${host.clientHeight}`);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, layout]);

  useEffect(() => {
    const host = bodyRef.current;
    if (!active || !host) return;
    let timer;
    let touching = false;
    let focused = false;
    const resumeLater = () => {
      clearTimeout(timer);
      if (!touching && !focused) timer = setTimeout(() => {
        lastScroll.current = null;
        setFollowing(true);
      }, LYRIC_FOLLOW_DELAY);
    };
    const pause = () => {
      host.scrollTo({ top: host.scrollTop, behavior: 'instant' });
      setFollowing(false);
      resumeLater();
    };
    const touchStart = () => { touching = true; pause(); };
    const touchEnd = () => { touching = false; resumeLater(); };
    const focusIn = event => { if (event.target.matches(':focus-visible')) { focused = true; pause(); } };
    const focusOut = () => { focused = false; resumeLater(); };
    const key = event => {
      if (event.target.closest('input, select, textarea, button, [role="button"]')) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) pause();
    };
    host.addEventListener('wheel', pause, { passive: true });
    host.addEventListener('touchstart', touchStart, { passive: true });
    host.addEventListener('touchmove', pause, { passive: true });
    host.addEventListener('touchend', touchEnd, { passive: true });
    host.addEventListener('touchcancel', touchEnd, { passive: true });
    host.addEventListener('focusin', focusIn);
    host.addEventListener('focusout', focusOut);
    host.addEventListener('keydown', key);
    return () => {
      host.removeEventListener('wheel', pause);
      clearTimeout(timer);
      host.removeEventListener('touchstart', touchStart);
      host.removeEventListener('touchmove', pause);
      host.removeEventListener('touchend', touchEnd);
      host.removeEventListener('touchcancel', touchEnd);
      host.removeEventListener('focusin', focusIn);
      host.removeEventListener('focusout', focusOut);
      host.removeEventListener('keydown', key);
    };
  }, [active, layout, trackId, sourceKey]);

  useEffect(() => {
    if (!active || !following || activeIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const host = bodyRef.current;
      const line = groupRefs.current.get(activeIndex);
      if (!host || !line) return;
      const previous = lastScroll.current;
      const snap = !previous || previous.trackId !== trackId || Math.abs(previous.index - activeIndex) > 1
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const top = host.scrollTop + line.getBoundingClientRect().top - host.getBoundingClientRect().top
        - host.clientHeight * .3;
      host.scrollTo({ top: Math.max(0, top), behavior: snap ? 'instant' : 'smooth' });
      lastScroll.current = { trackId, index: activeIndex };
    });
    return () => cancelAnimationFrame(frame);
  }, [active, activeIndex, trackId, following, layout, groups, viewportSize, karaoke, romajiOn, scale]);

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
  ) : !hasText ? (
    <div class="lyrics-empty" role={error ? 'alert' : 'status'}>
      <p class="lyrics-line">{error || 'No lyrics were found, or the server could not be reached.'}</p>
      <button onClick={() => setRetryCount(value => value + 1)}>Retry lyrics</button>
    </div>
  ) : (
    <div class={`lyrics-content ${karaoke && hasWords ? 'karaoke' : ''}`}>
      {groups.map((group, index) => {
        const rest = !group.lines.some(line => line.trim());
        const timed = group.time >= 0 && !rest;
        const showLine = (_, lineIndex) => lineIndex === 0 || !karaoke || romajiOn;
        const wordButtons = karaoke && group.wordLines?.some((words, lineIndex) => showLine(null, lineIndex) && words?.length);
        return (
          <div
            class={`lyrics-group ${index === activeIndex ? 'active' : ''} ${index < activeIndex ? 'past' : ''} ${timed ? 'timed' : ''} ${rest ? 'instrumental' : ''}`}
            key={`${group.time}:${index}`}
            data-time={group.time}
            style={{ '--dist': Math.min(Math.abs(index - activeIndex), 6) }}
            aria-current={index === activeIndex ? 'true' : undefined}
            role={timed ? wordButtons ? 'group' : 'button' : undefined}
            tabIndex={timed && !wordButtons ? 0 : undefined}
            aria-label={timed ? group.lines.filter(showLine).join('\n') : rest ? 'Instrumental' : undefined}
            onKeyDown={timed ? event => {
              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault(); seekTo(group.time); setFollowing(true);
              }
            } : undefined}
            ref={element => {
              if (element) groupRefs.current.set(index, element);
              else groupRefs.current.delete(index);
            }}
            onClick={timed ? () => { seekTo(group.time); setFollowing(true); } : undefined}
          >
            {rest ? <span class="gap-dots" aria-hidden="true"><i /><i /><i /></span> : group.lines.map((line, lineIndex) => {
              // LRC carries no reliable language/romaji labels. Control the
              // secondary lines together, and always show them in normal mode.
              if (!showLine(line, lineIndex)) return null;
              return (
              <span class={`lyrics-line ${lineIndex > 0 ? 'secondary-lyric' : ''}`} key={lineIndex} aria-hidden={timed && !wordButtons ? 'true' : undefined}>
                {karaoke && group.wordLines?.[lineIndex]?.length ? group.wordLines[lineIndex].map((word, wordIndex) => (
                  !word.text.trim() ? <span key={wordIndex}>{word.text}</span> : <button type="button" class="lyric-word" key={wordIndex}
                  aria-label={word.text.trim()} title={`Seek to ${word.start.toFixed(2)} seconds`}
                  onClick={event => {
                    event.stopPropagation();
                    seekTo(word.start);
                    setFollowing(true);
                  }} ref={node => {
                    const key = `${lineIndex}:${wordIndex}`;
                    if (node) {
                      if (!wordRefs.current.has(index)) wordRefs.current.set(index, new Map());
                      wordRefs.current.get(index).set(key, { node, word });
                    } else {
                      const entries = wordRefs.current.get(index);
                      entries?.delete(key);
                      if (!entries?.size) wordRefs.current.delete(index);
                    }
                  }}>{word.text}</button>
                )) : line}
              </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  const header = (
    <div class="lyrics-view-header">
      <div class="lyrics-heading-row">
      {layout !== 'popup' && <button class="lyrics-icon-button" aria-label="Close lyrics" onClick={hideLyricsView}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>}
      <div class="lyrics-track-heading">
      {layout === 'popup' ? <h3>{title}</h3> : <h2>{title}</h2>}
      <div class="lyrics-view-artist">{artist}</div>
      </div>
      {layout !== 'popup' && <button class="lyrics-icon-button" aria-label="Settings" onClick={() => { settingsVisible.value = true; }}>
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--panel)"/><circle cx="15" cy="17" r="3" fill="var(--panel)"/></svg>
      </button>}
      </div>
      <div class="lyrics-mode-row">
        <button class="karaoke-toggle" aria-pressed={karaoke} onClick={() => setKaraokeEnabled(!karaoke)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/><circle cx="12" cy="12" r="3"/></svg>
          Karaoke <span>{karaoke ? 'On' : 'Off'}</span>
        </button>
        {karaoke && hasSecondaryLines && <button class="karaoke-toggle secondary-lyrics-toggle" aria-label="Romaji / translations" aria-pressed={romajiOn} onClick={() => setRomajiEnabled(!romajiOn)}>
          Romaji / translations <span>{romajiOn ? 'On' : 'Off'}</span>
        </button>}
        {karaoke && !loading && hasText && !hasWords && <span class="lyrics-mode-hint">{groups.some(group => group.time >= 0) ? 'Line timing only' : 'Untimed lyrics'}</span>}
      </div>
    </div>
  );

  const followControl = !following && groups.some(group => group.time >= 0) ? (
    <div class="lyrics-follow"><button onClick={() => { lastScroll.current = null; setFollowing(true); }}>Back to current line</button></div>
  ) : null;

  if (layout === 'popup') {
    return (
      <div class="lyrics-reader">
        {header}
        {followControl}
        <div class="popup-body" id="popupBody" ref={bodyRef} style={bodyStyle}>{lyricsBody}</div>
      </div>
    );
  }

  return (
    <>
      {header}
      {followControl}
      <div class="lyrics-view-body" ref={bodyRef} style={bodyStyle}>{lyricsBody}</div>
    </>
  );
}
