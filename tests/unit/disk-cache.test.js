// Tests for the desktop disk cache: round trip, TTL expiry, stale reads, clearing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CACHE_TTL_MS, createDiskCache } from '../../electron/disk-cache.js';

let dir;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vs-cache-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe('disk cache', () => {
  it('returns what was stored', async () => {
    const cache = createDiskCache(dir);
    await cache.set('k', { a: 1 }, 200);
    const hit = await cache.get('k');
    expect(hit.data).toEqual({ a: 1 });
    expect(hit.status).toBe(200);
  });

  it('returns null for unknown keys', async () => {
    expect(await createDiskCache(dir).get('missing')).toBeNull();
  });

  it('expires after 7 days but can still be read as stale', async () => {
    const cache = createDiskCache(dir);
    await cache.set('k', 'v', 200);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_TTL_MS + 1000);
    expect(await cache.get('k')).toBeNull();
    const stale = await cache.get('k', { allowStale: true });
    expect(stale.data).toBe('v');
    expect(stale.stale).toBe(true);
  });

  it('clear() removes everything', async () => {
    const cache = createDiskCache(dir);
    await cache.set('k', 'v', 200);
    await cache.clear();
    expect(await cache.get('k')).toBeNull();
  });
});
