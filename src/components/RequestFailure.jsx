import { h } from 'preact';
import { safeRequestError } from '../utils/request.js';

export default function RequestFailure({ title = 'Unable to load', error, onRetry }) {
  return (
    <section class="request-failure" role="alert">
      <strong>{title}</strong>
      <p>{safeRequestError(error)}</p>
      <button class="action-button" onClick={onRetry}>Retry</button>
    </section>
  );
}
