// Tests for the desktop disk cache: gene-tagged files, data of any age, listing and deleting by gene.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OUT_OF_DATE_MS, createDiskCache, isValidGroup } from '../../electron/disk-cache.js';

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
    await cache.set('k', { a: 1 }, 200, 'TP53');
    const hit = await cache.get('k', 'TP53');
    expect(hit.data).toEqual({ a: 1 });
    expect(hit.status).toBe(200);
    expect(hit.stale).toBe(false);
  });

  it('returns null for unknown keys', async () => {
    expect(await createDiskCache(dir).get('missing', 'TP53')).toBeNull();
  });

  it('keeps data of any age and only flags it stale (out of date) after 7 days', async () => {
    const cache = createDiskCache(dir);
    await cache.set('k', 'v', 200, 'TP53');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + OUT_OF_DATE_MS - 1000);
    expect((await cache.get('k', 'TP53')).stale).toBe(false);
    vi.setSystemTime(Date.now() + 2000);
    const old = await cache.get('k', 'TP53');
    expect(old.data).toBe('v'); // still there: nothing is deleted for its age
    expect(old.stale).toBe(true);
  });

  it('puts the gene tag at the start of each file name', async () => {
    const cache = createDiskCache(dir);
    await cache.set('a', 1, 200, 'TP53');
    await cache.set('b', 1, 200);
    const names = await readdir(dir);
    expect(names.filter((n) => n.startsWith('TP53~'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('_~'))).toHaveLength(1);
  });

  it('never uses an unsafe gene tag in a file name', async () => {
    const cache = createDiskCache(dir);
    for (const bad of ['../evil', 'a/b', 'tp53', '', 'X'.repeat(21), 42, null]) {
      await cache.set(`k-${String(bad)}`, 1, 200, bad);
    }
    const names = await readdir(dir);
    expect(names.every((n) => n.startsWith('_~'))).toBe(true);
    expect(isValidGroup('HLA-A')).toBe(true);
    expect(isValidGroup('../x')).toBe(false);
  });

  it('lists the size and file count per gene', async () => {
    const cache = createDiskCache(dir);
    await cache.set('a', 'x'.repeat(1000), 200, 'TP53');
    await cache.set('b', 'y'.repeat(500), 200, 'TP53');
    await cache.set('c', 'z', 200, 'BRCA1');
    const groups = Object.fromEntries((await cache.listGroups()).map((g) => [g.group, g]));
    expect(groups.TP53.entries).toBe(2);
    expect(groups.TP53.bytes).toBeGreaterThan(1500);
    expect(groups.BRCA1.entries).toBe(1);
    expect(await createDiskCache(path.join(dir, 'nope')).listGroups()).toEqual([]);
  });

  it('deletes only the chosen genes', async () => {
    const cache = createDiskCache(dir);
    await cache.set('a', 1, 200, 'TP53');
    await cache.set('b', 1, 200, 'TP53');
    await cache.set('c', 1, 200, 'BRCA1');
    expect(await cache.deleteGroups(['TP53'])).toBe(2);
    expect(await cache.get('a', 'TP53')).toBeNull();
    expect((await cache.get('c', 'BRCA1')).data).toBe(1);
    expect(await cache.deleteGroups(['NOPE'])).toBe(0);
  });

  it('"all" and clear() remove everything', async () => {
    const cache = createDiskCache(dir);
    await cache.set('a', 1, 200, 'TP53');
    await cache.set('b', 1, 200);
    expect(await cache.deleteGroups('all')).toBe(2);
    expect(await cache.listGroups()).toEqual([]);
    await cache.set('c', 1, 200, 'TP53');
    await cache.clear();
    expect(await cache.get('c', 'TP53')).toBeNull();
  });
});
