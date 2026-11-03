// Main-process HTTP client: allowlist, https-only, timeout, retry, size cap, rate limit, disk cache.
import { net } from 'electron';
import { checkApiUrl } from './allowlist.js';

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024; // largest expected response is ~1.5 MB; 25 MB is a safety cap
const RETRY_DELAY_MS = 800;
// Minimum gap between request starts per host. NCBI allows 3 requests/second without an API key.
const MIN_INTERVAL_MS = { 'eutils.ncbi.nlm.nih.gov': 340 };
const DEFAULT_INTERVAL_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lastStart = new Map();
const queues = new Map();

// Waits for this host's turn so requests are spaced out (queue per hostname).
function acquireSlot(host) {
  const interval = MIN_INTERVAL_MS[host] ?? DEFAULT_INTERVAL_MS;
  const turn = (queues.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (lastStart.get(host) ?? 0) + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart.set(host, Date.now());
  });
  queues.set(host, turn);
  return turn;
}

// Reads a response body as text but aborts if it grows past the size cap.
async function readCapped(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Response too large.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Performs one HTTP request with a timeout; returns {status, text}.
async function requestOnce(url, { method, body }, userAgent) {
  const headers = { 'User-Agent': userAgent, Accept: 'application/json, text/plain, */*' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await net.fetch(url.href, {
    method,
    headers,
    body,
    // Redirects are refused so a response can never send us to a host outside the allowlist.
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, text: await readCapped(res) };
}

// Fetches with one retry (network errors, 429 and 5xx); returns {status, text} or throws.
async function requestWithRetry(url, options, userAgent) {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot(url.hostname);
    try {
      const result = await requestOnce(url, options, userAgent);
      const retryable = result.status === 429 || result.status >= 500;
      if (!retryable || attempt === 1) return result;
    } catch (err) {
      if (attempt === 1 || String(err.message).startsWith('Blocked')) throw err;
    }
    await sleep(RETRY_DELAY_MS * 2);
  }
}

// Creates the fetchJson handler used by IPC; returns {ok, status, data, ...} or {ok:false, error}.
export function createFetcher({ cache, userAgent }) {
  return async function fetchJson(rawUrl, options = {}) {
    const check = checkApiUrl(rawUrl);
    if (!check.ok) return { ok: false, error: check.error };

    const method = options.method === 'POST' ? 'POST' : 'GET';
    const body = method === 'POST' && typeof options.body === 'string' ? options.body : undefined;
    const responseType = options.responseType === 'text' ? 'text' : 'json';
    const cacheKey = `${method}\n${check.url.href}\n${body ?? ''}`;

    if (!options.noCache) {
      const hit = await cache.get(cacheKey);
      if (hit)
        return {
          ok: true,
          status: hit.status,
          data: hit.data,
          cached: true,
          fetchedAt: hit.fetchedAt,
        };
    }

    try {
      const { status, text } = await requestWithRetry(check.url, { method, body }, userAgent);
      if (status < 200 || status >= 300) return { ok: false, status, error: `HTTP ${status}` };
      let data = text;
      if (responseType === 'json') {
        try {
          data = JSON.parse(text);
        } catch {
          return { ok: false, status, error: 'The server did not return valid JSON.' };
        }
      }
      await cache.set(cacheKey, data, status).catch(() => {}); // a cache write failure must not fail the request
      return { ok: true, status, data, cached: false, fetchedAt: Date.now() };
    } catch (err) {
      // Network failure: fall back to an expired cache entry so the app still works offline.
      const old = options.noCache ? null : await cache.get(cacheKey, { allowStale: true });
      if (old) {
        return {
          ok: true,
          status: old.status,
          data: old.data,
          cached: true,
          stale: true,
          offline: true,
          fetchedAt: old.fetchedAt,
        };
      }
      // Connection-level failures (not blocks or oversize responses) mean we are probably offline.
      const offline = err.name === 'TimeoutError' || /net::ERR_/.test(err.message ?? '');
      return { ok: false, offline, error: err.message || 'Network error.' };
    }
  };
}
