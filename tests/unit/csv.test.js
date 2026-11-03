// Tests for CSV export: quoting, formula safety, and missing values.
import { describe, expect, it } from 'vitest';
import { csvCell, variantsToCsv } from '../../src/core/csv.js';

describe('csvCell', () => {
  it('quotes cells with commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
  });
  it('neutralises spreadsheet formulas but keeps plain negative numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('1e-6')).toBe('1e-6');
  });
  it('writes missing values as empty (never a placeholder)', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('variantsToCsv', () => {
  const variant = {
    clinvarId: '12374',
    proteinChange: 'p.Arg175His',
    position: 175,
    classification: 'Pathogenic',
    clinvarLabel: 'Pathogenic',
    reviewStatus: 'reviewed by expert panel',
    rarity: 'ultra-rare',
    plddt: 96.6,
    numberingOk: true,
    gnomad: { found: true, af: 4.3e-6, ac: 7, an: 1600000, matchedBy: 'coordinates' },
  };
  it('writes a header and one row per variant', () => {
    const lines = variantsToCsv(
      [
        variant,
        {
          ...variant,
          plddt: null,
          gnomad: { found: false, af: null, ac: null, an: null, matchedBy: null },
        },
      ],
      { gene: 'TP53' },
    )
      .trim()
      .split('\n');
    expect(lines[0].startsWith('gene,clinvar_id,protein_change')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('TP53,12374,p.Arg175His,175,Pathogenic');
    expect(lines[2]).toContain(',,'); // missing values stay empty
  });
});
