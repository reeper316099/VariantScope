// Tests for the browser path of the HTTP adapter: caching, errors, cancellation, offline fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, getJson } from '../../src/core/http.js';

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
let n = 0;
// A fresh URL per test so the module-level cache never leaks between tests.
const url = () => `https://rest.uniprot.org/test/${++n}`;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson (browser path)', () => {
  it('fetches JSON and then serves the second call from the cache', async () => {
    const u = url();
    fetch.mockResolvedValueOnce(ok({ a: 1 }));
    const first = await getJson(u);
    expect(first).toMatchObject({ data: { a: 1 }, fromCache: false });
    const second = await getJson(u);
    expect(second).toMatchObject({ data: { a: 1 }, fromCache: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('noCache bypasses the cache', async () => {
    const u = url();
    fetch.mockImplementation(async () => ok({ a: 1 }));
    await getJson(u);
    await getJson(u, { noCache: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns text for responseType "text"', async () => {
    fetch.mockResolvedValueOnce(new Response('ATOM  ...', { status: 200 }));
    expect((await getJson(url(), { responseType: 'text' })).data).toBe('ATOM  ...');
  });

  it('turns a 404 into an HttpError with its status and does not retry', async () => {
    fetch.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(getJson(url())).rejects.toMatchObject({ kind: 'http', status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports invalid JSON', async () => {
    fetch.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(getJson(url())).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('reports "offline" when fetch itself fails (network down or blocked by CORS)', async () => {
    vi.useFakeTimers();
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const promise = getJson(url());
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'offline' });
    await vi.advanceTimersByTimeAsync(2000); // covers the one retry delay
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2); // one retry
    vi.useRealTimers();
  });

  it('rejects immediately with kind "aborted" when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    fetch.mockImplementation((_u, init) => Promise.reject(init.signal.reason));
    await expect(getJson(url(), { signal: controller.signal })).rejects.toBeInstanceOf(HttpError);
    await expect(getJson(url(), { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});
