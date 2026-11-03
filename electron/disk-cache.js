// Persistent API-response cache: one JSON file per request in the app's userData folder.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Creates a cache rooted at `dir`; nothing touches the disk until it is used.
export function createDiskCache(dir) {
  // Turns a request description into a safe, fixed-length file name.
  const fileFor = (key) => path.join(dir, `${createHash('sha256').update(key).digest('hex')}.json`);

  return {
    // Reads an entry; returns null if missing, unreadable, or expired (unless allowStale).
    async get(key, { allowStale = false } = {}) {
      try {
        const entry = JSON.parse(await readFile(fileFor(key), 'utf8'));
        const age = Date.now() - entry.fetchedAt;
        if (age > CACHE_TTL_MS && !allowStale) return null;
        return { ...entry, stale: age > CACHE_TTL_MS };
      } catch {
        return null;
      }
    },

    // Writes an entry atomically (temp file + rename) so a crash can't leave half a file.
    async set(key, data, status) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ fetchedAt: Date.now(), status, data }));
      await rename(tmp, file);
    },

    // Deletes every cached response (File > Clear cache).
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
