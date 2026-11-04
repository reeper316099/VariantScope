// Tests for the library (the saved-genes list): recording, aliases, sizes, sorting, deleting.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLibrary,
  entryOutOfDate,
  groupsOfEntry,
  listLibrary,
  recordGene,
  removeFromLibrary,
  sizeOfEntry,
  sortEntries,
} from '../../src/core/library.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

// A minimal pipeline result: all four sources ok unless `failed` names one.
function result({ symbol = 'TP53', fetchedAt = NOW, failed = [], capped = false } = {}) {
  const status = (name) =>
    failed.includes(name) ? { status: 'failed', error: 'x' } : { status: 'ok' };
  return {
    gene: {
      geneSymbol: symbol,
      accession: 'P04637',
      proteinName: 'Cellular tumor antigen p53',
      length: 393,
    },
    freshness: { fetchedAt },
    summary: { total: 1456, pathogenicShare: { pct: 17.65 } },
    alphafold: status('alphafold'),
    clinvar: failed.includes('clinvar') ? status('clinvar') : { status: 'ok', value: { capped } },
    gnomadVariants: status('gnomad'),
    constraint: status('constraint'),
  };
}

beforeEach(() => clearLibrary());

describe('recordGene', () => {
  it('saves a summary of the gene', () => {
    const entry = recordGene(result({ capped: true }), 'tp53', NOW);
    expect(entry).toEqual({
      symbol: 'TP53',
      accession: 'P04637',
      proteinName: 'Cellular tumor antigen p53',
      length: 393,
      queries: [],
      savedAt: NOW,
      lastOpenedAt: NOW,
      partial: false,
      analysed: 1456,
      pathogenicPct: 17.65,
      capped: true,
    });
    expect(listLibrary()).toHaveLength(1);
  });

  it('remembers the alias that was typed, and marks the entry incomplete when a source failed', () => {
    const entry = recordGene(result({ failed: ['gnomad'] }), 'p53', NOW);
    expect(entry.queries).toEqual(['P53']);
    expect(entry.partial).toBe(true);
  });

  it('records "not available" numbers when ClinVar failed', () => {
    const r = result({ failed: ['clinvar'] });
    r.summary = null;
    const entry = recordGene(r, 'TP53', NOW);
    expect(entry.analysed).toBeNull();
    expect(entry.pathogenicPct).toBeNull();
    expect(entry.capped).toBe(false);
  });

  it('updates an existing entry instead of adding a second one, and keeps every alias', () => {
    recordGene(result({ fetchedAt: NOW - 9 * DAY }), 'P53', NOW - 9 * DAY);
    recordGene(result({ fetchedAt: NOW }), 'TP53', NOW);
    recordGene(result({ fetchedAt: NOW }), 'p53', NOW);
    const [entry] = listLibrary();
    expect(listLibrary()).toHaveLength(1);
    expect(entry.queries).toEqual(['P53']); // the official symbol is not listed as an alias
    expect(entry.savedAt).toBe(NOW);
    expect(entry.lastOpenedAt).toBe(NOW);
  });
});

describe('removing', () => {
  it('removeFromLibrary returns the removed entry so its data can be deleted', () => {
    recordGene(result(), 'P53', NOW);
    const entry = removeFromLibrary('TP53');
    expect(groupsOfEntry(entry)).toEqual(['TP53', 'P53']);
    expect(listLibrary()).toEqual([]);
    expect(removeFromLibrary('TP53')).toBeNull();
  });

  it('clearLibrary empties the list', () => {
    recordGene(result(), 'TP53', NOW);
    recordGene(result({ symbol: 'BRCA1' }), 'BRCA1', NOW);
    clearLibrary();
    expect(listLibrary()).toEqual([]);
  });
});

describe('groupsOfEntry and sizeOfEntry', () => {
  it('lists the official symbol plus aliases once, dropping unsafe names', () => {
    expect(groupsOfEntry({ symbol: 'TP53', queries: ['P53', 'P53', 'bad name', 'TP53'] })).toEqual([
      'TP53',
      'P53',
    ]);
  });
  it('adds up the saved sizes of a gene and its aliases only', () => {
    const entry = { symbol: 'TP53', queries: ['P53'] };
    const saved = [
      { group: 'TP53', bytes: 1000, entries: 4 },
      { group: 'P53', bytes: 24, entries: 1 },
      { group: 'BRCA1', bytes: 99999, entries: 9 },
    ];
    expect(sizeOfEntry(entry, saved)).toBe(1024);
    expect(sizeOfEntry(entry, [])).toBe(0);
  });
});

describe('entryOutOfDate', () => {
  it('flags genes whose oldest data is more than 7 days old', () => {
    expect(entryOutOfDate({ savedAt: NOW - 6 * DAY }, NOW)).toBe(false);
    expect(entryOutOfDate({ savedAt: NOW - 8 * DAY }, NOW)).toBe(true);
  });
});

describe('sortEntries', () => {
  const a = { symbol: 'BRCA1', lastOpenedAt: 3, savedAt: 30 };
  const b = { symbol: 'CFTR', lastOpenedAt: 1, savedAt: 10 };
  const c = { symbol: 'TP53', lastOpenedAt: 2, savedAt: 20 };
  const sizes = new Map([
    ['BRCA1', 5],
    ['CFTR', 50],
    ['TP53', 500],
  ]);
  const names = (list) => list.map((e) => e.symbol);

  it('sorts by recently opened (default), name, size and oldest data', () => {
    expect(names(sortEntries([b, c, a]))).toEqual(['BRCA1', 'TP53', 'CFTR']);
    expect(names(sortEntries([c, b, a], 'name'))).toEqual(['BRCA1', 'CFTR', 'TP53']);
    expect(names(sortEntries([a, b, c], 'size', sizes))).toEqual(['TP53', 'CFTR', 'BRCA1']);
    expect(names(sortEntries([a, b, c], 'oldest'))).toEqual(['CFTR', 'TP53', 'BRCA1']);
  });
  it('falls back to recent for an unknown key and never changes the input', () => {
    const input = [b, c, a];
    expect(names(sortEntries(input, 'bogus'))).toEqual(['BRCA1', 'TP53', 'CFTR']);
    expect(names(input)).toEqual(['CFTR', 'TP53', 'BRCA1']);
  });
});
