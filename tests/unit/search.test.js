// Tests for gene-symbol validation in the search box.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_GENES, normalizeSymbol } from '../../src/ui/search.js';

describe('normalizeSymbol', () => {
  it('trims and uppercases valid symbols', () => {
    expect(normalizeSymbol('  brca1 ')).toEqual({ ok: true, symbol: 'BRCA1' });
    expect(normalizeSymbol('hla-a')).toEqual({ ok: true, symbol: 'HLA-A' });
  });
  it('rejects empty input with a helpful message', () => {
    expect(normalizeSymbol('   ')).toMatchObject({ ok: false });
    expect(normalizeSymbol(undefined).ok).toBe(false);
  });
  it('rejects anything except letters, digits and hyphens', () => {
    for (const bad of ['TP53;DROP', 'A B', 'x"y', 'a'.repeat(21), 'TP53 OR 1=1', '<script>']) {
      expect(normalizeSymbol(bad).ok, bad).toBe(false);
    }
  });
  it('accepts every example chip', () => {
    for (const gene of EXAMPLE_GENES) expect(normalizeSymbol(gene).ok).toBe(true);
  });
});
