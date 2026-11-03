// Tests for the ClinVar <-> gnomAD join (both strategies, no match, failed query) and numbering.
import { describe, expect, it } from 'vitest';
import {
  NUMBERING_MIN_RATE,
  checkNumbering,
  joinVariants,
  numberingReport,
} from '../../src/core/join.js';
import { parseSummaryRecord } from '../../src/core/clinvar.js';
import { parseProteinChange, proteinKey } from '../../src/core/parse.js';
import { fixture } from './fixture.js';

// Hand-made inputs for small, readable cases (the fixture-based test below uses real data).
const SEQUENCE = 'MKRHAGLQ'; // residue 1=M ... 4=H, 6=G
const clinvar = (over = {}) => ({
  clinvarId: '1',
  refAA: 'H',
  position: 4,
  altAA: 'R',
  classification: 'Pathogenic',
  clinvarLabel: 'Pathogenic',
  reviewStatus: 'criteria provided, single submitter',
  coordKey: '17-100-A-G',
  ...over,
});
const gn = (over = {}) => ({
  variantId: '17-100-A-G',
  proteinKey: 'H4R',
  ac: 3,
  an: 3000,
  af: 0.001,
  ...over,
});
const join = (clinvarVariants, gnomad, plddt = null) =>
  joinVariants({ clinvar: clinvarVariants, gnomad, sequence: SEQUENCE, plddt });

describe('join by coordinates', () => {
  it('matches on chr-pos-ref-alt and copies the frequency', () => {
    const [row] = join([clinvar()], { ok: true, variants: [gn()] });
    expect(row.gnomad).toEqual({
      found: true,
      af: 0.001,
      ac: 3,
      an: 3000,
      matchedBy: 'coordinates',
    });
    expect(row.rarity).toBe('low-frequency');
  });

  it('does NOT fall back to protein change when ClinVar has coordinates but gnomAD has no such variant', () => {
    // Same amino-acid change from a different DNA change is a different variant.
    const other = gn({ variantId: '17-101-C-T' });
    const [row] = join([clinvar()], { ok: true, variants: [other] });
    expect(row.gnomad).toEqual({ found: false, af: null, ac: null, an: null, matchedBy: null });
    expect(row.rarity).toBe('absent');
  });

  it('treats a gnomAD record with zero observed alleles as not found', () => {
    const [row] = join([clinvar()], { ok: true, variants: [gn({ ac: 0, af: 0 })] });
    expect(row.gnomad.found).toBe(false);
    expect(row.gnomad.matchedBy).toBe('coordinates');
    expect(row.rarity).toBe('absent');
  });

  it('keeps found variants with missing counts as "unknown"', () => {
    const [row] = join([clinvar()], { ok: true, variants: [gn({ ac: null, an: null, af: null })] });
    expect(row.gnomad.found).toBe(true);
    expect(row.rarity).toBe('unknown');
  });
});

describe('join by protein change (only when ClinVar has no coordinates)', () => {
  it('matches a unique protein change', () => {
    const [row] = join([clinvar({ coordKey: null })], {
      ok: true,
      variants: [gn({ variantId: '17-555-T-C' })],
    });
    expect(row.gnomad.matchedBy).toBe('protein-change');
    expect(row.gnomad.found).toBe(true);
    expect(row.rarity).toBe('low-frequency');
  });

  it('refuses an ambiguous match (two DNA changes, same protein change) and reports "unknown"', () => {
    const two = [gn({ variantId: '17-1-A-G' }), gn({ variantId: '17-1-A-C' })];
    const [row] = join([clinvar({ coordKey: null })], { ok: true, variants: two });
    expect(row.gnomad).toEqual({ found: false, af: null, ac: null, an: null, matchedBy: null });
    expect(row.rarity).toBe('unknown');
  });

  it('no coordinates and no protein match is "absent"', () => {
    const [row] = join([clinvar({ coordKey: null })], {
      ok: true,
      variants: [gn({ proteinKey: 'A9G' })],
    });
    expect(row.gnomad.matchedBy).toBeNull();
    expect(row.rarity).toBe('absent');
  });
});

describe('join when the gnomAD query failed', () => {
  it('gives rarity "unknown" (never "absent") and no matches', () => {
    const rows = join([clinvar(), clinvar({ coordKey: null })], { ok: false });
    for (const row of rows) {
      expect(row.gnomad).toEqual({ found: false, af: null, ac: null, an: null, matchedBy: null });
      expect(row.rarity).toBe('unknown');
    }
  });

  it('distinguishes failure ("unknown") from a genuine miss ("absent")', () => {
    const miss = join([clinvar()], { ok: true, variants: [] })[0];
    const failed = join([clinvar()], { ok: false })[0];
    expect(miss.rarity).toBe('absent');
    expect(failed.rarity).toBe('unknown');
  });
});

describe('unified schema output', () => {
  it('fills the unified fields, pLDDT and numbering', () => {
    const plddt = [10, 20, 30, 88.5, 50];
    const [row] = join([clinvar()], { ok: true, variants: [gn()] }, plddt);
    expect(row).toMatchObject({
      clinvarId: '1',
      proteinChange: 'p.His4Arg',
      refAA: 'H',
      position: 4,
      altAA: 'R',
      classification: 'Pathogenic',
      reviewStatus: 'criteria provided, single submitter',
      plddt: 88.5,
      numberingOk: true,
    });
  });
  it('plddt is null when AlphaFold is unavailable or the residue is missing', () => {
    expect(join([clinvar()], { ok: true, variants: [] }, null)[0].plddt).toBeNull();
    expect(
      join([clinvar({ position: 8 })], { ok: true, variants: [] }, [1, 2])[0].plddt,
    ).toBeNull();
  });
});

describe('numbering check', () => {
  it('compares the reference residue with the UniProt sequence', () => {
    expect(checkNumbering(SEQUENCE, 'M', 1)).toBe(true);
    expect(checkNumbering(SEQUENCE, 'H', 4)).toBe(true);
    expect(checkNumbering(SEQUENCE, 'H', 5)).toBe(false);
    expect(checkNumbering(SEQUENCE, 'H', 99)).toBe(false); // beyond the sequence
  });

  it('marks mismatching variants with numberingOk = false', () => {
    const [row] = join([clinvar({ refAA: 'W' })], { ok: true, variants: [] });
    expect(row.numberingOk).toBe(false);
  });

  it('flags a gene when fewer than 95% of variants match', () => {
    const make = (matching, total) =>
      numberingReport(Array.from({ length: total }, (_, i) => ({ numberingOk: i < matching })));
    expect(NUMBERING_MIN_RATE).toBe(0.95);
    expect(make(95, 100).flagged).toBe(false); // exactly 95% is acceptable
    expect(make(94, 100).flagged).toBe(true);
    expect(make(100, 100)).toEqual({ checked: 100, matching: 100, rate: 1, flagged: false });
    expect(numberingReport([])).toEqual({ checked: 0, matching: 0, rate: null, flagged: false });
  });
});

describe('join with real saved TP53 data (fixtures)', () => {
  const uniprot = fixture('uniprot-TP53.json').results[0];
  const esummary = fixture('clinvar-TP53-esummary.json').result;
  const parsed = esummary.uids
    .map((uid) => parseSummaryRecord(esummary[uid], 'TP53'))
    .filter((r) => r.variant);
  const gnomadVariants = fixture('gnomad-TP53-variants.json').data.gene.variants.map((v) => {
    const p = parseProteinChange(v.hgvsp);
    return {
      variantId: v.variant_id,
      proteinKey: p.ok ? proteinKey(p.refAA, p.position, p.altAA) : null,
      ac: v.joint.ac,
      an: v.joint.an,
      af: v.joint.an > 0 ? v.joint.ac / v.joint.an : null,
    };
  });
  const rows = joinVariants({
    clinvar: parsed.map((r) => r.variant),
    gnomad: { ok: true, variants: gnomadVariants },
    sequence: uniprot.sequence.value,
    plddt: null,
  });
  const byChange = Object.fromEntries(rows.map((r) => [r.proteinChange, r]));

  it('puts the well-known hotspot variants on the right residues with matching numbering', () => {
    for (const [change, position] of [
      ['p.Arg175His', 175],
      ['p.Arg248Gln', 248],
      ['p.Arg273His', 273],
      ['p.Arg282Trp', 282],
    ]) {
      expect(byChange[change].position, change).toBe(position);
      expect(byChange[change].numberingOk, change).toBe(true);
    }
  });

  it('joins at least the R175H hotspot to gnomAD by coordinates, as a very rare variant', () => {
    expect(byChange['p.Arg175His'].gnomad.matchedBy).toBe('coordinates');
    expect(byChange['p.Arg175His'].gnomad.found).toBe(true);
    expect(['ultra-rare', 'rare']).toContain(byChange['p.Arg175His'].rarity);
  });

  it('every variant that survived parsing has numbering consistent with UniProt', () => {
    expect(rows.every((r) => r.numberingOk)).toBe(true);
    expect(numberingReport(rows).flagged).toBe(false);
  });

  it('records ClinVar wording, mapped class and review status', () => {
    expect(byChange['p.Arg282Trp'].clinvarLabel).toBe('Pathogenic/Likely pathogenic');
    expect(byChange['p.Arg282Trp'].classification).toBe('Pathogenic');
    expect(byChange['p.Arg175His'].reviewStatus).not.toBe('');
  });
});
