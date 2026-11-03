// Browser-side cache: an in-memory Map backed by localStorage (all storage access is try/catch).
export const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as the desktop disk cache
const PREFIX = 'vs:';
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

// Removes every cached API response (keeps preferences such as theme and recent searches).
export function cacheClearResponses() {
  for (const key of [...memory.keys()]) if (key.startsWith('http:')) memory.delete(key);
  try {
    const store = storage();
    if (!store) return;
    for (const name of Object.keys(store))
      if (name.startsWith(`${PREFIX}http:`)) store.removeItem(name);
  } catch {
    // Nothing else to clear.
  }
}
