export class RequestError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = 'RequestError';
    this.code = code;
    this.status = status;
  }
}

export function httpError(status) {
  return new RequestError('http', status);
}

// Keep the timeout active through body consumption, not just response headers.
// No automatic retries: replaying a POST could duplicate a user action.
export async function fetchWithTimeout(input, options = {}, {
  timeoutMs = 15000,
  consume = response => response,
  fetchImpl = globalThis.fetch,
} = {}) {
  const controller = new AbortController();
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw new RequestError('aborted');
  let timer;
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new RequestError('aborted'));
    };
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestError('timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl(input, { ...options, signal: controller.signal });
        return consume(response);
      }),
      cancelled,
    ]);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (callerSignal?.aborted) throw new RequestError('aborted');
    if (error instanceof SyntaxError) throw new RequestError('invalid_response');
    throw new RequestError('network');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}

// Deliberately never echo raw exception text: native/network errors may include
// authenticated URLs. Only fixed, actionable messages reach the UI or logs.
export function safeRequestError(error, fallback = 'Request failed. Please try again.') {
  if (error?.code === 'native_unavailable') return 'This feature requires the updated Android app.';
  if (error?.code === 'timeout' || error?.name === 'TimeoutError') {
    return 'The server took too long to respond. Check your tailnet connection and retry.';
  }
  if (error?.status === 401 || error?.status === 403) {
    return 'Access was denied. Check the server credentials in your build configuration.';
  }
  if (error?.status === 429) return 'The server is busy. Wait a moment, then retry.';
  if (error?.status >= 500) return 'The server is unavailable. Please try again shortly.';
  if (error?.code === 'network' || error instanceof TypeError) {
    return 'Cannot reach the server. Check Wi-Fi or mobile data and your tailnet connection.';
  }
  if (error?.code === 'no_user') return 'No Jellyfin user was returned. Check your server account.';
  if (error?.code === 'no_library') return 'No music library was found for this Jellyfin user.';
  if (error?.code === 'invalid_response') return 'The server returned an unreadable response. Please retry.';
  if (error?.code === 'aborted' || error?.name === 'AbortError') return 'The request was cancelled.';
  return fallback;
}
