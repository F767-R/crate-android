import { h } from 'preact';
import { useState } from 'preact/hooks';
import { playbackError, translationBusy, translationError } from '../stores/state.js';
import { retryPlayback } from '../utils/playbackControls.js';
import { translateAllMetadata } from '../utils/translationControls.js';
import { safeRequestError } from '../utils/request.js';

export default function RecoveryBanner() {
  const [retryingPlayback, setRetryingPlayback] = useState(false);
  const playbackFailure = playbackError.value;
  const translationFailure = translationError.value;
  const translating = translationBusy.value;

  async function retry() {
    if (retryingPlayback) return;
    setRetryingPlayback(true);
    try {
      await retryPlayback();
    } catch (error) {
      playbackError.value = error;
    } finally {
      setRetryingPlayback(false);
    }
  }

  if (!playbackFailure && !translationFailure && !translating && !retryingPlayback) return null;
  return (
    <div class="recovery-strip">
      {(playbackFailure || retryingPlayback) && (
        <div class="recovery-notice" role="alert">
          <span>{retryingPlayback ? 'Retrying playback…' : safeRequestError(playbackFailure,
            'Playback could not continue. Check your tailnet connection, then retry.')}</span>
          <button class="action-button" onClick={retry} disabled={retryingPlayback}>Retry playback</button>
          <button class="notice-dismiss" aria-label="Dismiss playback error"
            onClick={() => { playbackError.value = null; }} disabled={retryingPlayback}>✕</button>
        </div>
      )}
      {translating ? (
        <div class="recovery-notice" role="status">Loading translations… Saved labels remain available.</div>
      ) : translationFailure && (
        <div class="recovery-notice" role="alert">
          <span>{translationFailure.message}</span>
          {translationFailure.retryable && (
            <button class="action-button" onClick={() => translateAllMetadata()}>Retry translation</button>
          )}
          <button class="notice-dismiss" aria-label="Dismiss translation message"
            onClick={() => { translationError.value = null; }}>✕</button>
        </div>
      )}
    </div>
  );
}
