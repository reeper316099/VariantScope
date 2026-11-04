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

describe('getJson (browser path): saved data, out-of-date flag and Refresh', () => {
  it('tags saved responses with the gene so they can be found and deleted', async () => {
    const { cacheDeleteGroups, cacheListGroups } = await import('../../src/core/cache.js');
    fetch.mockImplementation(async () => ok({ a: 1 }));
    await getJson(url(), { group: 'ZZTAG' });
    await getJson(url()); // no group: saved under "_"
    const groups = cacheListGroups().map((g) => g.group);
    expect(groups).toContain('ZZTAG');
    expect(groups).toContain('_');
    cacheDeleteGroups(['ZZTAG']);
    expect(cacheListGroups().map((g) => g.group)).not.toContain('ZZTAG');
  });

  it('serves saved data of ANY age without asking the network, and flags it out of date', async () => {
    const u = url();
    fetch.mockImplementation(async () => ok({ v: 'old' }));
    await getJson(u, { group: 'TP53' });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 30 * 86_400_000); // a month later
    const result = await getJson(u, { group: 'TP53' });
    vi.useRealTimers();
    expect(result).toMatchObject({ data: { v: 'old' }, fromCache: true, stale: true });
    expect(fetch).toHaveBeenCalledTimes(1); // nothing was refetched
  });

  it('Refresh (noCache) downloads again and replaces the saved copy', async () => {
    const u = url();
    fetch.mockImplementation(async () => ok({ v: 'old' }));
    await getJson(u, { group: 'TP53' });
    fetch.mockImplementation(async () => ok({ v: 'new' }));
    const refreshed = await getJson(u, { group: 'TP53', noCache: true });
    expect(refreshed).toMatchObject({ data: { v: 'new' }, fromCache: false, stale: false });
    expect((await getJson(u, { group: 'TP53' })).data).toEqual({ v: 'new' });
  });

  it('a failed Refresh reports the error and leaves the saved copy untouched', async () => {
    vi.useFakeTimers();
    const u = url();
    fetch.mockImplementation(async () => ok({ v: 'saved' }));
    await getJson(u, { group: 'TP53' });
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const refresh = getJson(u, { group: 'TP53', noCache: true });
    const assertion = expect(refresh).rejects.toMatchObject({ kind: 'offline' });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    vi.useRealTimers();
    expect((await getJson(u, { group: 'TP53' })).data).toEqual({ v: 'saved' });
  });

  it('ignores an unsafe gene tag instead of putting it in a storage key', async () => {
    const { cacheListGroups } = await import('../../src/core/cache.js');
    fetch.mockImplementation(async () => ok(1));
    await getJson(url(), { group: 'bad:tag/../' });
    expect(
      cacheListGroups()
        .map((g) => g.group)
        .some((g) => g.includes('bad')),
    ).toBe(false);
  });
});
