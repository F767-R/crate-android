import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  playbackCurrentTrack,
  trackTranslationCache,
  translationEditVisible,
} from '../stores/state.js';
import { getTranslationContext, getTranslationScope, saveTranslationOverride } from '../config.js';
import { artistText } from '../utils/metadata.js';
import { applySavedTranslationEdits } from '../utils/translationControls.js';
import { safeTranslationError } from '../utils/translationClient.js';

export default function TranslationEditPanel() {
  const [pending, setPending] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', error: false });
  const firstInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const editSessionRef = useRef(null);
  const savingRef = useRef(false);
  const visible = translationEditVisible.value;
  const track = playbackCurrentTrack.value;

  useEffect(() => {
    if (!visible) return;
    if (!track) {
      showToast('No track playing', true);
      translationEditVisible.value = false;
      return;
    }

    editSessionRef.current = { track, context: getTranslationContext(), scope: getTranslationScope() };
    const translation = trackTranslationCache.value[track.Id] || {};
    const originalArtist = artistText(track, '');
    const fields = [{
      kind: 'title',
      original: track.Name || '',
      translated: translation.title || track.Name || '',
      dirty: false,
    }];
    if (originalArtist) {
      fields.push({
        kind: 'artist',
        original: originalArtist,
        translated: translation.artist || originalArtist,
        dirty: false,
      });
    }
    setPending(fields);
    requestAnimationFrame(() => {
      firstInputRef.current?.focus();
      firstInputRef.current?.select();
    });
  }, [visible, track?.Id]);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  function close() {
    translationEditVisible.value = false;
  }

  async function save() {
    if (savingRef.current) return;
    const session = editSessionRef.current;
    if (!session) return;
    const dirty = pending.filter(field =>
      field.dirty && field.translated?.trim()
    );
    if (!dirty.length) {
      close();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const saved = [];
    let failure = null;
    let persistenceWarning = null;
    for (const field of dirty) {
      try {
        const result = await saveTranslationOverride(field.original, field.translated, { context: session.context });
        persistenceWarning = result.persistenceWarning;
        saved.push(field);
      } catch (error) {
        failure = safeTranslationError(error);
      }
    }
    savingRef.current = false;
    setSaving(false);

    // Commit to the track and translation scope captured at Save, never a new song.
    applySavedTranslationEdits(session, saved);

    if (editSessionRef.current === session) {
      setPending(fields => fields.map(field => saved.some(value => value.kind === field.kind) ? { ...field, dirty: false } : field));
      if (!failure) close();
    }
    const message = failure
      ? `${saved.length ? 'Some changes were saved on the proxy. ' : ''}${failure.message}${persistenceWarning ? ` ${persistenceWarning.message}` : ''}`
      : persistenceWarning
        ? `Saved on the proxy. ${persistenceWarning.message}`
        : `Saved ${saved.length} change(s)`;
    showToast(message, Boolean(failure || persistenceWarning));
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, error });
    toastTimerRef.current = setTimeout(() => {
      setToast({ show: false, message: '', error: false });
    }, error ? 7000 : 1800);
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
                  disabled={saving}
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
