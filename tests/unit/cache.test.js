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
