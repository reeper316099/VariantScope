// Tests for the rule-based "What this means" sentences and the display formatters.
import { describe, expect, it } from 'vitest';
import { formatAf, formatAge, formatPct, formatScore } from '../../src/core/format.js';
import { buildSummarySentences, densestRegion } from '../../src/core/summaryText.js';
import { summarize } from '../../src/core/stats.js';

const variant = (position, classification, rarity = 'absent', plddt = 90) => ({
  position,
  classification,
  rarity,
  plddt,
  numberingOk: true,
});
const variants = [
  variant(10, 'Pathogenic'),
  variant(12, 'Pathogenic', 'ultra-rare'),
  variant(14, 'Likely pathogenic', 'common', 40),
  variant(80, 'Benign', 'common'),
  variant(60, 'VUS'),
];
const summary = summarize(variants, { skippedCount: 0 });

describe('densestRegion', () => {
  it('finds the residue with the most pathogenic variants nearby', () => {
    const r = densestRegion(variants, 100);
    expect(r.count).toBe(3);
    expect(r.centre).toBeGreaterThanOrEqual(4); // first residue whose +/-10 window holds all three
    expect(r.centre).toBeLessThanOrEqual(10);
  });
  it('returns null when there are no pathogenic variants', () => {
    expect(densestRegion([variant(5, 'Benign')], 100)).toBeNull();
  });
});

describe('buildSummarySentences', () => {
  const sentences = buildSummarySentences({
    gene: 'TP53',
    summary,
    variants,
    length: 100,
    constraint: { obsMis: 464, expMis: 524.2, oeMis: 0.885, misZ: 1.12 },
    plddt: Array(100).fill(88),
  });
  const text = sentences.join(' ');

  it('states counts and percentages computed from the data', () => {
    expect(text).toContain('5 missense variants were analysed');
    expect(text).toContain('3 (60.0%) are classified Pathogenic or Likely pathogenic');
    expect(text).toContain(
      '2 of 3 pathogenic or likely pathogenic variants (66.7%) lie in regions where AlphaFold',
    );
    expect(text).toContain(
      '2 of 3 pathogenic or likely pathogenic variants (66.7%) are absent from gnomAD or ultra-rare',
    );
  });
  it('states the thresholds used', () => {
    expect(text).toContain('at least 70');
    expect(text).toContain('below 0.00001');
    expect(text).toContain('low-frequency < 0.01');
  });
  it('includes the constraint numbers and the cluster', () => {
    expect(text).toContain('464 of 524.2 expected missense variants');
    expect(text).toContain('densest cluster of pathogenic variants');
  });
  it('says "not available" instead of inventing numbers', () => {
    const none = buildSummarySentences({
      gene: 'X',
      summary: summarize([variant(1, 'Pathogenic', 'unknown', null)]),
      variants: [variant(1, 'Pathogenic', 'unknown', null)],
      length: 10,
      constraint: null,
      plddt: null,
    }).join(' ');
    expect(none).toContain('AlphaFold confidence scores are not available');
    expect(none).toContain('gnomAD frequencies are not available');
    expect(none).not.toContain('expected missense');
  });
  it('handles a gene with nothing to analyse', () => {
    expect(
      buildSummarySentences({
        gene: 'X',
        summary: summarize([]),
        variants: [],
        length: 10,
        constraint: null,
        plddt: null,
      }),
    ).toEqual(['No missense variants with a usable ClinVar classification were available for X.']);
  });
});

describe('formatters', () => {
  it('formats allele frequencies in scientific notation', () => {
    expect(formatAf(4.336e-6)).toBe('4.34e-6');
    expect(formatAf(0)).toBe('0');
    expect(formatAf(null)).toBe('not available');
  });
  it('formats shares, scores and ages', () => {
    expect(formatPct({ pct: 17.651 })).toBe('17.7%');
    expect(formatPct({ pct: null })).toBe('not available');
    expect(formatScore(0.9996, 4)).toBe('0.9996');
    expect(formatScore(0.9996)).toBe('1'); // 3 significant digits
    expect(formatScore(5.5e-38)).toBe('5.50e-38');
    expect(formatScore(null)).toBe('not available');
    const day = 86_400_000;
    expect(formatAge(1000, 1000 + 3600_000)).toBe('today');
    expect(formatAge(0, day)).toBe('1 day ago');
    expect(formatAge(0, 5 * day + 5)).toBe('5 days ago');
  });
});
