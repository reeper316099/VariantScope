// Persistent API-response cache: one JSON file per request in the app's userData folder.
// Each file name starts with the gene it belongs to ("TP53~<hash>.json"), so a gene's files can be
// listed, sized and deleted without opening them.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Data older than this is flagged "stale" (out of date) but is never deleted for its age. Same rule
// as src/core/freshness.js; it is repeated here because src/ is not part of the packaged main process.
export const OUT_OF_DATE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UNTAGGED = '_';

// True for a safe gene tag (only these are ever used in file names).
export const isValidGroup = (group) => typeof group === 'string' && /^[A-Z0-9-]{1,20}$/.test(group);

// Creates a cache rooted at `dir`; nothing touches the disk until it is used.
export function createDiskCache(dir) {
  // Turns a request description into a safe file name: "<gene tag>~<hash>.json".
  const fileFor = (key, group) => {
    const hash = createHash('sha256').update(key).digest('hex');
    return path.join(dir, `${isValidGroup(group) ? group : UNTAGGED}~${hash}.json`);
  };
  // Reads the gene tag from a file name (files without one, from older versions, count as untagged).
  const tagOf = (name) => (name.includes('~') ? name.slice(0, name.indexOf('~')) : UNTAGGED);
  // Lists the cache files (an empty list if the folder does not exist yet).
  const files = async () => {
    try {
      return (await readdir(dir)).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
  };

  return {
    // Reads an entry of any age; returns null if missing or unreadable. `stale` says it is out of date.
    async get(key, group) {
      try {
        const entry = JSON.parse(await readFile(fileFor(key, group), 'utf8'));
        return { ...entry, stale: Date.now() - entry.fetchedAt > OUT_OF_DATE_MS };
      } catch {
        return null;
      }
    },

    // Writes an entry atomically (temp file + rename) so a crash can't leave half a file.
    async set(key, data, status, group) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key, group);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ fetchedAt: Date.now(), status, data }));
      await rename(tmp, file);
    },

    // Sizes per gene tag: [{group, bytes, entries}].
    async listGroups() {
      const totals = new Map();
      for (const name of await files()) {
        const group = tagOf(name);
        try {
          const { size } = await stat(path.join(dir, name));
          const now = totals.get(group) ?? { group, bytes: 0, entries: 0 };
          totals.set(group, { group, bytes: now.bytes + size, entries: now.entries + 1 });
        } catch {
          // The file disappeared while listing: skip it.
        }
      }
      return [...totals.values()];
    },

    // Deletes the files of the given gene tags, or everything when target is "all".
    // Returns how many files were removed.
    async deleteGroups(target) {
      const names = await files();
      if (target === 'all') {
        await rm(dir, { recursive: true, force: true });
        return names.length;
      }
      const wanted = new Set(target);
      let removed = 0;
      for (const name of names) {
        if (!wanted.has(tagOf(name))) continue;
        await rm(path.join(dir, name), { force: true });
        removed++;
      }
      return removed;
    },

    // Deletes every cached response (File > Clear cache).
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
