// Saves and loads the folder layout. Desktop app only: the web version never calls this, so it
// never writes a folder to the browser's storage. Stored beside the library list (no expiry).
import { cacheGet, cacheSet } from './cache.js';
import { sanitizeFolders } from './folders.js';

const KEY = 'folders';

// Reads the saved folders (anything unexpected counts as "no folders").
export function loadFolders() {
  return sanitizeFolders(cacheGet(KEY)?.value);
}

// Saves the folders.
export function saveFolders(state) {
  cacheSet(KEY, state, null);
}
