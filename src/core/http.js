// The HTTP adapter: every network call in the app goes through getJson().
// Electron: window.api.fetchJson (main process: no CORS, rate limits, allowlist, disk cache).
// Browser: plain fetch() plus the localStorage cache. Nothing else in src/ knows which one runs.
import { cacheGet, cacheSet } from './cache.js';

const TIMEOUT_MS = 20_000;

// Error with a `kind` the UI can act on: "blocked" | "offline" | "http" | "aborted" | "invalid".
export class HttpError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = status;
  }
}

// True when running inside the Electron preload bridge.
export const isElectron = () =>
  typeof window !== 'undefined' && typeof window.api?.fetchJson === 'function';

// Rejects as soon as `signal` aborts, so a new search can cancel in-flight work.
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new HttpError('aborted', 'Request cancelled.'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// Desktop path: ask the main process, then translate its reply into data or an HttpError.
async function viaElectron(url, options) {
  const { method, body, responseType, noCache } = options;
  const reply = await abortable(
    window.api.fetchJson(url, { method, body, responseType, noCache }),
    options.signal,
  );
  if (!reply.ok) {
    if (reply.status) throw new HttpError('http', reply.error, reply.status);
    throw new HttpError(reply.offline ? 'offline' : 'blocked', reply.error);
  }
  return {
    data: reply.data,
    fetchedAt: reply.fetchedAt,
    fromCache: Boolean(reply.cached),
    stale: Boolean(reply.stale),
    offline: Boolean(reply.offline),
  };
}

// Browser path: cache lookup, fetch with timeout + one retry, stale fallback when offline.
async function viaBrowser(url, options) {
  const { method, body, responseType, noCache, signal } = options;
  const key = `http:${method}\n${url}\n${body ?? ''}`;
  if (!noCache) {
    const hit = cacheGet(key);
    if (hit)
      return {
        data: hit.value,
        fetchedAt: hit.savedAt,
        fromCache: true,
        stale: false,
        offline: false,
      };
  }

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const res = await fetch(url, {
        method,
        body,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (res.status === 429 || res.status >= 500)
        throw new HttpError('http', `HTTP ${res.status}`, res.status);
      if (!res.ok) throw new HttpError('http', `HTTP ${res.status}`, res.status);
      let data;
      try {
        data = responseType === 'text' ? await res.text() : await res.json();
      } catch {
        throw new HttpError('invalid', 'The server did not return valid JSON.');
      }
      cacheSet(key, data);
      return { data, fetchedAt: Date.now(), fromCache: false, stale: false, offline: false };
    } catch (err) {
      if (signal?.aborted) throw new HttpError('aborted', 'Request cancelled.');
      lastError = err;
      const retryable = !(err instanceof HttpError) || err.status === 429 || err.status >= 500;
      if (!retryable) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  // A failed fetch (no HttpError) in a browser means offline, blocked by CORS, or a timeout.
  const old = noCache ? null : cacheGet(key, { allowStale: true });
  if (old && !(lastError instanceof HttpError)) {
    return { data: old.value, fetchedAt: old.savedAt, fromCache: true, stale: true, offline: true };
  }
  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError('offline', 'Could not reach the data source from the browser.');
}

// Fetches JSON (or text) and returns {data, fetchedAt, fromCache, stale, offline}; throws HttpError.
export function getJson(url, options = {}) {
  const normalized = { method: 'GET', responseType: 'json', ...options };
  return isElectron() ? viaElectron(url, normalized) : viaBrowser(url, normalized);
}
