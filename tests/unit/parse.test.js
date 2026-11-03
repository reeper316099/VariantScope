// Tests for protein-change parsing, ClinVar title parsing, classification mapping and coordinates.
import { describe, expect, it } from 'vitest';
import {
  AA1_TO_3,
  AA3_TO_1,
  formatProteinChange,
  normalizeClassification,
  parseClinvarTitle,
  parseProteinChange,
  proteinKey,
  spdiToVariantId,
} from '../../src/core/parse.js';

describe('parseProteinChange: amino-acid codes', () => {
  const codes = Object.entries(AA3_TO_1);

  it('knows all 20 standard amino acids', () => {
    expect(codes).toHaveLength(20);
  });

  it.each(codes)('converts %s (%s) in both reference and alternate position', (three, one) => {
    // Pair every code with Ala/Gly so ref and alt always differ.
    const other = one === 'A' ? 'Gly' : 'Ala';
    const otherOne = one === 'A' ? 'G' : 'A';
    expect(parseProteinChange(`p.${three}10${other}`)).toEqual({
      ok: true,
      refAA: one,
      position: 10,
      altAA: otherOne,
    });
    expect(parseProteinChange(`p.${other}10${three}`)).toEqual({
      ok: true,
      refAA: otherOne,
      position: 10,
      altAA: one,
    });
  });

  it('round-trips through formatProteinChange', () => {
    expect(formatProteinChange('R', 1699, 'W')).toBe('p.Arg1699Trp');
    expect(AA1_TO_3.W).toBe('Trp');
  });
});

describe('parseProteinChange: formats', () => {
  it('strips transcript prefixes, parentheses and the p. marker', () => {
    const expected = { ok: true, refAA: 'R', position: 1699, altAA: 'W' };
    expect(parseProteinChange('p.Arg1699Trp')).toEqual(expected);
    expect(parseProteinChange('NP_009225.1:p.Arg1699Trp')).toEqual(expected);
    expect(parseProteinChange('p.(Arg1699Trp)')).toEqual(expected);
    expect(parseProteinChange('Arg1699Trp')).toEqual(expected);
  });

  it('accepts one-letter codes', () => {
    expect(parseProteinChange('R1699W')).toEqual({
      ok: true,
      refAA: 'R',
      position: 1699,
      altAA: 'W',
    });
    expect(parseProteinChange('p.R1699W').ok).toBe(true);
  });
});

describe('parseProteinChange: changes that must be skipped, with a reason', () => {
  const cases = [
    ['p.Arg213Ter', 'nonsense (stop gained)'],
    ['p.Arg213*', 'nonsense (stop gained)'],
    ['p.Ter394Cys', 'stop-loss / extension'],
    ['p.Ter110GlnextTer17', 'stop-loss / extension'],
    ['p.Pro219fs', 'frameshift'],
    ['p.Glu23ValfsTer17', 'frameshift'],
    ['p.Asn239dup', 'duplication'],
    ['p.Thr170del', 'deletion'],
    ['p.Lys2_Gln3insGly', 'insertion'],
    ['p.Glu346delinsSerTer', 'in-frame deletion/insertion (delins)'],
    ['p.Cys238=', 'synonymous (no amino-acid change)'],
    ['p.Arg175Arg', 'synonymous (no amino-acid change)'],
    ['R175R', 'synonymous (no amino-acid change)'],
    ['p.Met1Val', 'start-loss (Met1)'],
    ['p.Met1?', 'start-loss (Met1)'],
    ['p.?', 'unknown effect'],
    ['p.Xaa10Ala', 'non-standard amino acid'],
    ['p.foo', 'unrecognised protein change format'],
    ['p.Sec10Ala', 'non-standard amino acid'],
    ['', 'no protein change'],
    [null, 'no protein change'],
  ];
  it.each(cases)('%s -> skipped as "%s"', (input, reason) => {
    expect(parseProteinChange(input)).toEqual({ ok: false, reason });
  });

  it('does not mistake Met12/Met100 for start-loss', () => {
    expect(parseProteinChange('p.Met12Val').ok).toBe(true);
    expect(parseProteinChange('p.Met100Val').ok).toBe(true);
  });
});

describe('parseClinvarTitle', () => {
  it('splits gene and protein change', () => {
    expect(parseClinvarTitle('NM_007294.4(BRCA1):c.5044G>A (p.Glu1682Lys)')).toEqual({
      gene: 'BRCA1',
      protein: 'p.Glu1682Lys',
    });
  });
  it('returns null protein when there is none (splice/intronic)', () => {
    expect(parseClinvarTitle('NM_000546.6(TP53):c.994-6_994-1del')).toEqual({
      gene: 'TP53',
      protein: null,
    });
  });
  it('keeps the gene of an overlapping-gene record', () => {
    expect(parseClinvarTitle('NM_001143992.2(WRAP53):c.1A>G (p.Met1Val)').gene).toBe('WRAP53');
  });
});

describe('normalizeClassification', () => {
  const cases = [
    ['Pathogenic', 'Pathogenic'],
    ['Pathogenic/Likely pathogenic', 'Pathogenic'],
    ['Pathogenic/Likely pathogenic/Pathogenic, low penetrance', 'Pathogenic'],
    ['Pathogenic; drug response', 'Pathogenic'],
    ['Likely pathogenic', 'Likely pathogenic'],
    ['Uncertain significance', 'VUS'],
    ['Likely benign', 'Likely benign'],
    ['Benign', 'Benign'],
    ['Benign/Likely benign', 'Benign'],
    ['Conflicting classifications of pathogenicity', 'Conflicting'],
    ['Conflicting interpretations of pathogenicity', 'Conflicting'],
    ['not provided', null],
    ['drug response', null],
    ['risk factor', null],
    ['', null],
    [undefined, null],
  ];
  it.each(cases)('"%s" -> %s', (input, expected) => {
    expect(normalizeClassification(input)).toBe(expected);
  });
});

describe('spdiToVariantId', () => {
  it('converts 0-based SPDI to 1-based gnomAD ids', () => {
    expect(spdiToVariantId('NC_000017.11:43067637:C:T')).toBe('17-43067638-C-T');
    expect(spdiToVariantId('NC_000007.14:117480098:A:C')).toBe('7-117480099-A-C');
  });
  it('maps chromosomes 23/24 to X/Y', () => {
    expect(spdiToVariantId('NC_000023.11:100:A:G')).toBe('X-101-A-G');
    expect(spdiToVariantId('NC_000024.10:5:T:C')).toBe('Y-6-T-C');
  });
  it('returns null for multi-base changes and junk', () => {
    expect(spdiToVariantId('NC_000017.11:43067637:CA:T')).toBeNull();
    expect(spdiToVariantId('NC_000017.11:43067637:C:')).toBeNull();
    expect(spdiToVariantId(undefined)).toBeNull();
  });
});

describe('proteinKey', () => {
  it('builds the comparison key', () => {
    expect(proteinKey('R', 175, 'H')).toBe('R175H');
  });
});
