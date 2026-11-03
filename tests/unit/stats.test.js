// Tests for rarity buckets (exact boundaries), density windows and summary statistics.
import { describe, expect, it } from 'vitest';
import {
  RARITY_THRESHOLDS,
  densityWindows,
  rarityFromAf,
  rarityOf,
  summarize,
} from '../../src/core/stats.js';

describe('rarityFromAf: exact threshold boundaries', () => {
  it('uses the documented thresholds', () => {
    expect(RARITY_THRESHOLDS).toEqual({ ultraRare: 1e-5, rare: 1e-4, lowFrequency: 1e-2 });
  });

  const cases = [
    [0, 'absent'],
    [Number.MIN_VALUE, 'ultra-rare'],
    [9.999999e-6, 'ultra-rare'],
    [1e-5, 'rare'], // exactly at the threshold moves up one bucket
    [9.99999e-5, 'rare'],
    [1e-4, 'low-frequency'],
    [9.9999e-3, 'low-frequency'],
    [1e-2, 'common'],
    [0.5, 'common'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    [Number.NaN, 'unknown'],
  ];
  it.each(cases)('AF %s -> %s', (af, bucket) => {
    expect(rarityFromAf(af)).toBe(bucket);
  });
});

describe('rarityOf', () => {
  it('not found in gnomAD is "absent"', () => {
    expect(rarityOf({ found: false, af: null })).toBe('absent');
  });
  it('a failed or ambiguous lookup is "unknown", never "absent"', () => {
    expect(rarityOf({ found: false, af: null }, { unknown: true })).toBe('unknown');
  });
  it('found with no frequency is "unknown"', () => {
    expect(rarityOf({ found: true, af: null })).toBe('unknown');
  });
  it('uses the allele frequency when found', () => {
    expect(rarityOf({ found: true, af: 5e-5 })).toBe('rare');
  });
});

describe('densityWindows', () => {
  it('counts variants within +/- half window of every residue', () => {
    const { counts, max } = densityWindows([5, 6, 20], 25, 2);
    expect(counts).toHaveLength(25);
    expect(counts[4]).toBe(2); // residue 5 sees 5 and 6
    expect(counts[2]).toBe(1); // residue 3 window 1..5 includes 5 only (6 is 3 away)
    expect(counts[0]).toBe(0); // residue 1 window 1..3
    expect(counts[19]).toBe(1); // residue 20
    expect(counts[21]).toBe(1); // residue 22 reaches 20
    expect(counts[22]).toBe(0); // residue 23 window 21..25
    expect(max).toBe(2);
  });

  it('clips windows at both ends of the protein', () => {
    const { counts } = densityWindows([1, 10], 10, 3);
    expect(counts[0]).toBe(1); // residue 1: window 1..4
    expect(counts[9]).toBe(1); // residue 10: window 7..10
  });

  it('counts several variants on the same residue and ignores out-of-range ones', () => {
    const { counts, max } = densityWindows([3, 3, 3, 0, 99, -1, 2.5], 10, 0);
    expect(counts[2]).toBe(3);
    expect(max).toBe(3);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('handles no variants', () => {
    expect(densityWindows([], 5)).toEqual({ counts: [0, 0, 0, 0, 0], max: 0 });
  });
});

describe('summarize', () => {
  // Builds a minimal unified variant for the statistics.
  const v = (classification, rarity, plddt, numberingOk = true) => ({
    classification,
    rarity,
    plddt,
    numberingOk,
  });

  const variants = [
    v('Pathogenic', 'absent', 95),
    v('Pathogenic', 'ultra-rare', 80),
    v('Likely pathogenic', 'common', 40),
    v('Likely pathogenic', 'unknown', 90), // unknown rarity: excluded from the rarity share
    v('Pathogenic', 'rare', null), // no pLDDT: excluded from the pLDDT share
    v('Benign', 'common', 90),
    v('VUS', 'absent', 60),
    v('Pathogenic', 'absent', 99, false), // numbering mismatch: not analysed at all
  ];
  const s = summarize(variants, { skippedCount: 42 });

  it('analyses only variants whose numbering matches', () => {
    expect(s.total).toBe(7);
  });
  it('computes the pathogenic share (Pathogenic + Likely pathogenic)', () => {
    expect(s.pathogenicShare).toEqual({ n: 5, of: 7, pct: (100 * 5) / 7 });
  });
  it('computes the share of pathogenic variants in regions with pLDDT >= 70', () => {
    // pathogenic with pLDDT: 95, 80, 40, 90 -> 3 of 4
    expect(s.pathogenicInConfidentRegions).toEqual({ n: 3, of: 4, pct: 75 });
  });
  it('computes the share absent/ultra-rare among pathogenic with known rarity', () => {
    // known rarity: absent, ultra-rare, common, rare -> 2 of 4
    expect(s.pathogenicAbsentOrUltraRare).toEqual({ n: 2, of: 4, pct: 50 });
  });
  it('passes through the skipped count and tallies', () => {
    expect(s.skipped).toBe(42);
    expect(s.byClassification).toEqual({
      Pathogenic: 3,
      'Likely pathogenic': 2,
      Benign: 1,
      VUS: 1,
    });
    expect(s.byRarity.absent).toBe(2);
  });

  it('gives pct null ("not available") when there is nothing to divide by', () => {
    const empty = summarize([]);
    expect(empty.total).toBe(0);
    expect(empty.pathogenicShare.pct).toBeNull();
    expect(empty.pathogenicInConfidentRegions.pct).toBeNull();
    expect(empty.pathogenicAbsentOrUltraRare.pct).toBeNull();
  });

  it('treats pLDDT exactly 70 as confident', () => {
    expect(summarize([v('Pathogenic', 'absent', 70)]).pathogenicInConfidentRegions.n).toBe(1);
    expect(summarize([v('Pathogenic', 'absent', 69.99)]).pathogenicInConfidentRegions.n).toBe(0);
  });
});
