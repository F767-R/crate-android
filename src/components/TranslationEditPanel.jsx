import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  isTranslated,
  playbackCurrentTrack,
  trackTranslationCache,
  translationEditVisible,
} from '../stores/state.js';
import { config, DEEPL_API_URL, SOURCE_LANG, TARGET_LANG, GLOSSARY_ID } from '../config.js';
import { artistText } from '../utils/metadata.js';
import { audioShim } from '../utils/playerShim.js';

export default function TranslationEditPanel() {
  const [pending, setPending] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', error: false });
  const firstInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const visible = translationEditVisible.value;
  const track = playbackCurrentTrack.value;

  useEffect(() => {
    if (!visible) return;
    if (!track) {
      showToast('No track playing', true);
      translationEditVisible.value = false;
      return;
    }

    const translation = trackTranslationCache.value[track.Id] || {};
    const originalArtist = artistText(track, '');
    const fields = [{
      kind: 'title',
      original: track.Name || '',
      translated: translation.title || track.Name || '',
      source_lang: SOURCE_LANG,
      target_lang: TARGET_LANG,
      glossary_id: GLOSSARY_ID || null,
      dirty: false,
    }];
    if (originalArtist) {
      fields.push({
        kind: 'artist',
        original: originalArtist,
        translated: translation.artist || originalArtist,
        source_lang: SOURCE_LANG,
        target_lang: TARGET_LANG,
        glossary_id: GLOSSARY_ID || null,
        dirty: false,
      });
    }
    setPending(fields);
    requestAnimationFrame(() => {
      firstInputRef.current?.focus();
      firstInputRef.current?.select();
    });
  }, [visible, track?.Id]);

  function overrideUrl() {
    try {
      const base = new URL(DEEPL_API_URL, config.SERVER);
      base.pathname = base.pathname.replace(/\/translate\/?$/, '/translate/override');
      return base.toString();
    } catch (_) {
      return DEEPL_API_URL.replace(/\/translate(\?.*)?(#.*)?$/, '/translate/override');
    }
  }

  function close() {
    translationEditVisible.value = false;
  }

  async function save() {
    const dirty = pending.filter(field =>
      field.dirty && field.translated && field.translated !== field.original
    );
    if (!dirty.length) {
      close();
      return;
    }

    setSaving(true);
    let failed = 0;
    for (const field of dirty) {
      try {
        const response = await fetch(overrideUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            original: field.original,
            translated: field.translated,
            source_lang: field.source_lang,
            target_lang: field.target_lang,
            glossary_id: field.glossary_id,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        failed++;
        console.error('[translation-edit] save failed', field.original, error);
      }
    }
    setSaving(false);

    if (failed) {
      showToast(`Failed to save ${failed} change(s)`, true);
      return;
    }

    const activeTrack = playbackCurrentTrack.value;
    if (activeTrack) {
      const next = {
        title: activeTrack.Name || '',
        artist: artistText(activeTrack, ''),
        ...(trackTranslationCache.value[activeTrack.Id] || {}),
      };
      for (const field of dirty) next[field.kind] = field.translated;
      trackTranslationCache.value = {
        ...trackTranslationCache.value,
        [activeTrack.Id]: next,
      };
      isTranslated.value = true;
      audioShim.updateMetadata();
    }

    close();
    showToast(`Saved ${dirty.length} change(s)`);
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, error });
    toastTimerRef.current = setTimeout(() => {
      setToast({ show: false, message: '', error: false });
    }, 1800);
  }

  const toastNode = toast.show
    ? <div class={`tedit-toast show ${toast.error ? 'error' : ''}`}>{toast.message}</div>
    : null;

  if (!visible) return toastNode;

  return (
    <>
      <div id="teditPanel" class="tedit-panel open">
        <div class="tedit-container">
          <div class="tedit-header">
            <h4>Edit translation</h4>
            <button id="teditCloseBtn" title="Close" aria-label="Close" onClick={close}>✕</button>
          </div>
          <div class="tedit-body" id="teditBody">
            {pending.map((field, index) => (
              <div class="tedit-field" key={field.kind}>
                <div class="tedit-label">{field.kind === 'title' ? 'Title' : 'Artist'}</div>
                <div class="tedit-original">{field.original}</div>
                <input
                  ref={index === 0 ? firstInputRef : null}
                  type="text"
                  class="tedit-input"
                  value={field.translated}
                  placeholder="Translation"
                  onInput={event => {
                    const translated = event.currentTarget.value;
                    setPending(values => values.map((value, itemIndex) =>
                      itemIndex === index ? { ...value, translated, dirty: true } : value
                    ));
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      save();
                    } else if (event.key === 'Escape') {
                      close();
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div class="tedit-footer">
            <button id="teditCancelBtn" onClick={close}>Cancel</button>
            <button id="teditSaveBtn" class="tedit-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      {toastNode}
    </>
  );
}
