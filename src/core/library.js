// The library: the list of genes the person has opened (and so saved). Each gene's data is saved
// automatically when it loads; this list remembers a short summary so the home page can show it
// without loading anything. The big API responses live in the cache, tagged with the gene.
import { cacheGet, cacheSet } from './cache.js';
import { groupFor, isOutOfDate } from './freshness.js';

const KEY = 'library';
export const SORT_OPTIONS = ['recent', 'name', 'size', 'oldest'];

// Reads the saved list as {SYMBOL: entry}; anything unexpected counts as empty.
function readAll() {
  const saved = cacheGet(KEY)?.value;
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

// Writes the saved list (preferences-style storage: it never expires).
function writeAll(all) {
  cacheSet(KEY, all, null);
}

// Adds or updates a gene after it loaded. `typedSymbol` is what the person typed (it may be an
// alias such as "P53"); it is remembered so deleting the gene also removes that lookup.
export function recordGene(result, typedSymbol, now = Date.now()) {
  const { gene, freshness, summary, clinvar, alphafold, gnomadVariants, constraint } = result;
  const all = readAll();
  const previous = all[gene.geneSymbol];
  const queries = new Set([...(previous?.queries ?? []), groupFor(typedSymbol)].filter(Boolean));
  queries.delete(gene.geneSymbol);
  all[gene.geneSymbol] = {
    symbol: gene.geneSymbol,
    accession: gene.accession,
    proteinName: gene.proteinName,
    length: gene.length,
    queries: [...queries],
    savedAt: freshness.fetchedAt, // when the oldest piece of its data was downloaded
    lastOpenedAt: now,
    // A source that failed was not saved, so the entry is marked incomplete.
    partial: [alphafold, clinvar, gnomadVariants, constraint].some((s) => s.status === 'failed'),
    analysed: summary?.total ?? null,
    pathogenicPct: summary?.pathogenicShare.pct ?? null,
    capped: clinvar.status === 'ok' && Boolean(clinvar.value.capped),
  };
  writeAll(all);
  return all[gene.geneSymbol];
}

// Returns every saved gene entry (unsorted).
export function listLibrary() {
  return Object.values(readAll());
}

// Removes one gene from the list; returns the removed entry (or null) so the caller can delete its data.
export function removeFromLibrary(symbol) {
  const all = readAll();
  const entry = all[symbol] ?? null;
  if (entry) {
    delete all[symbol];
    writeAll(all);
  }
  return entry;
}

// Empties the list (the saved data itself is deleted separately).
export function clearLibrary() {
  writeAll({});
}

// The storage tags that belong to a gene: its official symbol plus every alias typed for it.
export function groupsOfEntry(entry) {
  return [...new Set([entry.symbol, ...entry.queries].map(groupFor).filter(Boolean))];
}

// Adds up the bytes saved for a gene, given the sizes from listSaved().
export function sizeOfEntry(entry, saved) {
  const mine = new Set(groupsOfEntry(entry));
  return saved.filter((s) => mine.has(s.group)).reduce((sum, s) => sum + s.bytes, 0);
}

// True if the gene's oldest data is more than 7 days old.
export function entryOutOfDate(entry, now = Date.now()) {
  return isOutOfDate(entry.savedAt, now);
}

// Returns a sorted copy: 'recent' (last opened first), 'oldest' (oldest data first), 'name' (A to Z)
// or 'size' (biggest first). `sizes` maps symbol -> bytes and is only needed for 'size'.
export function sortEntries(entries, key = 'recent', sizes = new Map()) {
  const by = {
    recent: (a, b) => b.lastOpenedAt - a.lastOpenedAt,
    oldest: (a, b) => a.savedAt - b.savedAt,
    name: (a, b) => a.symbol.localeCompare(b.symbol),
    size: (a, b) => (sizes.get(b.symbol) ?? 0) - (sizes.get(a.symbol) ?? 0),
  };
  return [...entries].sort(by[key] ?? by.recent);
}
