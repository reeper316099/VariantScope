// Saved-data management for the home page: how much each gene uses, and deleting it.
// Desktop: the main process owns the disk cache. Browser: the localStorage cache.
import { cacheDeleteGroups, cacheListGroups } from './cache.js';
import { isElectron } from './http.js';

// Lists saved data per gene tag: [{group, bytes, entries}] (group "_" is data without a gene).
export async function listSaved() {
  return isElectron() ? window.api.listCache() : cacheListGroups();
}

// Deletes saved data for the given gene tags, or all of it when target is "all".
export async function deleteSaved(target) {
  return isElectron() ? window.api.deleteCache(target) : cacheDeleteGroups(target);
}
