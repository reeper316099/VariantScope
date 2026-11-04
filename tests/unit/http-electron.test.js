// Tests for the desktop path of the HTTP adapter (window.api.fetchJson through the main process).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, getJson, isElectron } from '../../src/core/http.js';

let fetchJson;
beforeEach(() => {
  fetchJson = vi.fn();
  vi.stubGlobal('window', { api: { fetchJson } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson (Electron path)', () => {
  it('detects the preload bridge', () => {
    expect(isElectron()).toBe(true);
    vi.stubGlobal('window', {});
    expect(isElectron()).toBe(false);
  });

  it('passes the request, including the gene tag, to the main process and returns freshness info', async () => {
    fetchJson.mockResolvedValue({
      ok: true,
      data: { a: 1 },
      cached: true,
      fetchedAt: 123,
      stale: false,
    });
    const result = await getJson('https://rest.uniprot.org/x', {
      method: 'POST',
      body: '{}',
      responseType: 'text',
      noCache: true,
      group: 'TP53',
    });
    expect(fetchJson).toHaveBeenCalledWith('https://rest.uniprot.org/x', {
      method: 'POST',
      body: '{}',
      responseType: 'text',
      noCache: true,
      group: 'TP53',
    });
    expect(result).toEqual({ data: { a: 1 }, fetchedAt: 123, fromCache: true, stale: false });
  });

  it('reports saved data that is out of date (stale)', async () => {
    fetchJson.mockResolvedValue({ ok: true, data: 1, cached: true, stale: true, fetchedAt: 5 });
    expect(await getJson('https://rest.uniprot.org/x')).toMatchObject({
      stale: true,
      fromCache: true,
    });
  });

  it('turns an HTTP error status into HttpError("http") with the status', async () => {
    fetchJson.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    await expect(getJson('https://rest.uniprot.org/x')).rejects.toMatchObject({
      kind: 'http',
      status: 404,
    });
  });

  it('distinguishes offline from blocked requests', async () => {
    fetchJson.mockResolvedValueOnce({
      ok: false,
      offline: true,
      error: 'net::ERR_NAME_NOT_RESOLVED',
    });
    await expect(getJson('https://rest.uniprot.org/x')).rejects.toMatchObject({ kind: 'offline' });
    fetchJson.mockResolvedValueOnce({
      ok: false,
      offline: false,
      error: 'Blocked: host "x" is not on the allowlist.',
    });
    await expect(getJson('https://example.com/')).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('rejects with kind "aborted" as soon as the signal fires, even if the main process is still busy', async () => {
    fetchJson.mockReturnValue(new Promise(() => {})); // never answers
    const controller = new AbortController();
    const pending = getJson('https://rest.uniprot.org/x', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(HttpError);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    fetchJson.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    controller.abort();
    await expect(
      getJson('https://rest.uniprot.org/x', { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
