// Tests for the saved-data adapter used by the home page (desktop bridge or browser storage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheListGroups, cacheSet } from '../../src/core/cache.js';
import { deleteSaved, listSaved } from '../../src/core/saved.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saved data in the desktop app', () => {
  let api;
  beforeEach(() => {
    api = { fetchJson: vi.fn(), listCache: vi.fn(), deleteCache: vi.fn() };
    vi.stubGlobal('window', { api });
  });

  it('asks the main process for sizes and for deletion', async () => {
    api.listCache.mockResolvedValue([{ group: 'TP53', bytes: 10, entries: 1 }]);
    api.deleteCache.mockResolvedValue(3);
    expect(await listSaved()).toEqual([{ group: 'TP53', bytes: 10, entries: 1 }]);
    expect(await deleteSaved(['TP53'])).toBe(3);
    expect(api.deleteCache).toHaveBeenCalledWith(['TP53']);
    await deleteSaved('all');
    expect(api.deleteCache).toHaveBeenLastCalledWith('all');
  });
});

describe('saved data in the browser', () => {
  it('lists and deletes from the browser cache', async () => {
    cacheSet('http:ZSAVED:GET\nhttps://x/1\n', 'data');
    expect((await listSaved()).map((g) => g.group)).toContain('ZSAVED');
    await deleteSaved(['ZSAVED']);
    expect(cacheListGroups().map((g) => g.group)).not.toContain('ZSAVED');
  });
});
