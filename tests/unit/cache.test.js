// Tests for the browser cache: TTL, stale reads, never-expiring prefs, and storage failures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake localStorage (a plain Map with the same methods and enumerable keys).
function fakeStorage({ failSet = false, failGet = false } = {}) {
  const data = new Map();
  const storage = {
    getItem: (k) => {
      if (failGet) throw new Error('blocked');
      return data.has(k) ? data.get(k) : null;
    },
    setItem: (k, v) => {
      if (failSet) throw new DOMException('quota', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => data.delete(k),
    keys: () => [...data.keys()],
  };
  return new Proxy(storage, {
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

// Loads a fresh copy of the module (its in-memory Map starts empty) with the given storage.
async function load(storage) {
  vi.resetModules();
  vi.stubGlobal(
    'window',
    storage === 'throws'
      ? {
          get localStorage() {
            throw new Error('denied');
          },
        }
      : { localStorage: storage },
  );
  return import('../../src/core/cache.js');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cache', () => {
  it('stores and returns values with their save time', async () => {
    const { cacheGet, cacheSet } = await load(fakeStorage());
    cacheSet('k', { a: 1 });
    expect(cacheGet('k')).toMatchObject({ value: { a: 1 }, stale: false });
    expect(cacheGet('missing')).toBeNull();
  });

  it('expires after 7 days; allowStale still returns the old value and marks it stale', async () => {
    const { TTL_MS, cacheGet, cacheSet } = await load(fakeStorage());
    cacheSet('k', 'v');
    vi.advanceTimersByTime(TTL_MS + 1000);
    expect(cacheGet('k')).toBeNull();
    expect(cacheGet('k', { allowStale: true })).toMatchObject({ value: 'v', stale: true });
  });

  it('ttl null means the value never expires (used for preferences)', async () => {
    const { cacheGet, cacheSet } = await load(fakeStorage());
    cacheSet('theme', 'dark', null);
    vi.advanceTimersByTime(365 * 86_400_000);
    expect(cacheGet('theme')).toMatchObject({ value: 'dark', stale: false });
  });

  it('reads back from localStorage when the in-memory copy is gone (a new page load)', async () => {
    const storage = fakeStorage();
    const first = await load(storage);
    first.cacheSet('k', [1, 2, 3]);
    const second = await load(storage); // same storage, fresh memory
    expect(second.cacheGet('k').value).toEqual([1, 2, 3]);
  });

  it('keeps working in memory when storage is full, blocked on write, or unreadable', async () => {
    const full = await load(fakeStorage({ failSet: true }));
    full.cacheSet('k', 'v');
    expect(full.cacheGet('k').value).toBe('v');

    const unreadable = await load(fakeStorage({ failGet: true }));
    expect(unreadable.cacheGet('nothing')).toBeNull();

    const denied = await load('throws'); // even touching window.localStorage throws
    denied.cacheSet('k', 'v');
    expect(denied.cacheGet('k').value).toBe('v');
  });

  it('cacheClearResponses removes only API responses, not preferences', async () => {
    const storage = fakeStorage();
    const { cacheClearResponses, cacheGet, cacheSet } = await load(storage);
    cacheSet('http:GET\nhttps://x', { big: true });
    cacheSet('theme', 'dark', null);
    cacheClearResponses();
    expect(cacheGet('http:GET\nhttps://x')).toBeNull();
    expect(cacheGet('theme').value).toBe('dark');
    expect(storage.getItem('vs:theme')).not.toBeNull();
  });
});

describe('cache: saved data grouped by gene', () => {
  const key = (gene, n) => `http:${gene}:GET\nhttps://x/${n}\n`;

  it('lists the size and count of saved responses per gene, ignoring preferences', async () => {
    const { cacheListGroups, cacheSet } = await load(fakeStorage());
    cacheSet(key('TP53', 1), 'a'.repeat(100));
    cacheSet(key('TP53', 2), 'b'.repeat(100));
    cacheSet(key('BRCA1', 1), 'c');
    cacheSet('theme', 'dark', null);
    const groups = Object.fromEntries(cacheListGroups().map((g) => [g.group, g]));
    expect(Object.keys(groups).sort()).toEqual(['BRCA1', 'TP53']);
    expect(groups.TP53.entries).toBe(2);
    expect(groups.TP53.bytes).toBeGreaterThan(200);
  });

  it('deletes only the chosen genes and leaves everything else', async () => {
    const storage = fakeStorage();
    const { cacheDeleteGroups, cacheGet, cacheSet } = await load(storage);
    cacheSet(key('TP53', 1), 1);
    cacheSet(key('BRCA1', 1), 2);
    cacheSet('theme', 'dark', null);
    expect(cacheDeleteGroups(['TP53'])).toBe(1);
    expect(cacheGet(key('TP53', 1))).toBeNull();
    expect(cacheGet(key('BRCA1', 1)).value).toBe(2);
    expect(cacheGet('theme').value).toBe('dark');
    expect(storage.getItem(`vs:${key('TP53', 1)}`)).toBeNull(); // gone from storage too
  });

  it('"all" removes every saved response, and still works when storage is unavailable', async () => {
    const { cacheDeleteGroups, cacheListGroups, cacheSet } = await load('throws');
    cacheSet(key('TP53', 1), 1); // memory only
    expect(cacheListGroups().map((g) => g.group)).toEqual(['TP53']);
    expect(cacheDeleteGroups('all')).toBe(1);
    expect(cacheListGroups()).toEqual([]);
  });

  it('reads saved data from storage after a page reload', async () => {
    const storage = fakeStorage();
    (await load(storage)).cacheSet(key('TP53', 1), 'saved');
    const afterReload = await load(storage); // same storage, empty memory
    expect(afterReload.cacheListGroups().map((g) => g.group)).toEqual(['TP53']);
  });
});
