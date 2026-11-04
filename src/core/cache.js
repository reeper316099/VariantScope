// Browser-side cache: an in-memory Map backed by localStorage (all storage access is try/catch).
import { OUT_OF_DATE_MS } from './freshness.js';

export const TTL_MS = OUT_OF_DATE_MS; // after this, an entry is flagged stale (see cacheGet)
const PREFIX = 'vs:';
const HTTP = 'http:'; // saved API responses use keys like "http:TP53:GET\n<url>"
const memory = new Map();

// Returns localStorage, or null when storage is blocked (private mode, quota, sandboxed frame).
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Reads an entry {value, savedAt} from memory first, then localStorage; null if absent.
function read(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// Gets a cached value; expired entries are only returned when allowStale is true.
export function cacheGet(key, { allowStale = false } = {}) {
  const entry = read(key);
  if (!entry) return null;
  const stale = entry.ttl !== null && Date.now() - entry.savedAt > entry.ttl;
  if (stale && !allowStale) return null;
  return { value: entry.value, savedAt: entry.savedAt, stale };
}

// Stores a value; ttl null means "never expires" (used for small preferences).
export function cacheSet(key, value, ttl = TTL_MS) {
  const entry = { value, savedAt: Date.now(), ttl };
  memory.set(key, entry);
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the in-memory copy still works for this session.
  }
}

// Returns the group (gene tag) inside a saved-response key, e.g. "http:TP53:GET..." -> "TP53".
const groupOf = (key) => key.slice(HTTP.length, key.indexOf(':', HTTP.length));

// Lists saved API data per group: [{group, bytes, entries}]. Sizes are the stored text length.
export function cacheListGroups() {
  const sizes = new Map(); // key -> size
  try {
    const store = storage();
    if (store) {
      for (const name of Object.keys(store)) {
        if (name.startsWith(PREFIX + HTTP)) {
          sizes.set(name.slice(PREFIX.length), (store.getItem(name) ?? '').length);
        }
      }
    }
  } catch {
    // Fall back to what is in memory.
  }
  for (const [key, entry] of memory) {
    if (key.startsWith(HTTP) && !sizes.has(key)) sizes.set(key, JSON.stringify(entry).length);
  }
  const groups = new Map();
  for (const [key, size] of sizes) {
    const group = groupOf(key);
    const total = groups.get(group) ?? { group, bytes: 0, entries: 0 };
    groups.set(group, { group, bytes: total.bytes + size, entries: total.entries + 1 });
  }
  return [...groups.values()];
}

// Deletes saved API data for the given groups, or for everything when target is "all".
// Preferences (theme, recent searches, the library list) are never touched. Returns how many were removed.
export function cacheDeleteGroups(target) {
  const wanted = (key) => target === 'all' || target.includes(groupOf(key));
  let removed = 0;
  for (const key of [...memory.keys()]) {
    if (key.startsWith(HTTP) && wanted(key)) {
      memory.delete(key);
      removed++;
    }
  }
  try {
    const store = storage();
    if (!store) return removed;
    for (const name of Object.keys(store)) {
      const key = name.slice(PREFIX.length);
      if (name.startsWith(PREFIX + HTTP) && wanted(key)) store.removeItem(name);
    }
  } catch {
    // Nothing else to delete.
  }
  return removed;
}

// Removes every cached API response (keeps preferences such as theme and recent searches).
export function cacheClearResponses() {
  cacheDeleteGroups('all');
}
