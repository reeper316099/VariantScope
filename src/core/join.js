// Joins ClinVar variants to gnomAD frequencies and checks numbering against the UniProt sequence.
import { proteinKey, formatProteinChange } from './parse.js';
import { rarityOf } from './stats.js';

// Numbering is trusted only if at least this share of variants match the UniProt residue.
export const NUMBERING_MIN_RATE = 0.95;

// True if the UniProt sequence has `refAA` at 1-based `position` (the numbering sanity check).
export function checkNumbering(sequence, refAA, position) {
  return sequence[position - 1] === refAA;
}

// Reports how well ClinVar numbering agrees with the UniProt sequence across all variants.
export function numberingReport(variants) {
  const matching = variants.filter((v) => v.numberingOk).length;
  const rate = variants.length === 0 ? null : matching / variants.length;
  return {
    checked: variants.length,
    matching,
    rate,
    flagged: rate !== null && rate < NUMBERING_MIN_RATE,
  };
}

// Indexes gnomAD missense variants by genomic id and by protein change (a key can have several).
function indexGnomad(gnomadVariants) {
  const byVariantId = new Map();
  const byProtein = new Map();
  for (const v of gnomadVariants) {
    byVariantId.set(v.variantId, v);
    if (v.proteinKey) byProtein.set(v.proteinKey, [...(byProtein.get(v.proteinKey) ?? []), v]);
  }
  return { byVariantId, byProtein };
}

// Picks the gnomAD record for one ClinVar variant. Coordinates first; the protein-change
// fallback is used ONLY when ClinVar has no coordinates, and only if exactly one gnomAD variant
// has that protein change (a different DNA change with the same amino-acid change is a different
// variant, so guessing would attach the wrong frequency).
// Returns {record, matchedBy, ambiguous}.
function findGnomad(clinvarVariant, index) {
  if (clinvarVariant.coordKey) {
    const record = index.byVariantId.get(clinvarVariant.coordKey) ?? null;
    return { record, matchedBy: record ? 'coordinates' : null, ambiguous: false };
  }
  const key = proteinKey(clinvarVariant.refAA, clinvarVariant.position, clinvarVariant.altAA);
  const candidates = index.byProtein.get(key) ?? [];
  if (candidates.length === 1)
    return { record: candidates[0], matchedBy: 'protein-change', ambiguous: false };
  return { record: null, matchedBy: null, ambiguous: candidates.length > 1 };
}

// Builds the gnomAD part of the unified schema from a match result.
// A record with zero observed alleles counts as "not found" (nobody in gnomAD carries it).
// A record with no counts at all (ac null) is found but its frequency stays unknown.
function gnomadPart({ record, matchedBy }) {
  if (!record || record.ac === 0) {
    return { found: false, af: null, ac: record?.ac ?? null, an: record?.an ?? null, matchedBy };
  }
  return { found: true, af: record.af, ac: record.ac, an: record.an, matchedBy };
}

// Joins ClinVar variants with gnomAD and UniProt/AlphaFold context into the unified schema.
// `gnomad` is {ok:true, variants} or {ok:false} (query failed): failure gives rarity "unknown",
// never "absent". `plddt` is an array indexed by residue-1, or null if AlphaFold is unavailable.
export function joinVariants({ clinvar, gnomad, sequence, plddt }) {
  const index = gnomad.ok ? indexGnomad(gnomad.variants) : null;
  return clinvar.map((v) => {
    let gnomadResult = { found: false, af: null, ac: null, an: null, matchedBy: null };
    let unknown = !gnomad.ok;
    if (gnomad.ok) {
      const match = findGnomad(v, index);
      gnomadResult = gnomadPart(match);
      unknown = match.ambiguous;
    }
    return {
      clinvarId: v.clinvarId,
      proteinChange: formatProteinChange(v.refAA, v.position, v.altAA),
      refAA: v.refAA,
      position: v.position,
      altAA: v.altAA,
      classification: v.classification,
      // Extra field (not in the core schema): ClinVar's own wording, shown next to the class.
      clinvarLabel: v.clinvarLabel,
      reviewStatus: v.reviewStatus,
      gnomad: gnomadResult,
      rarity: rarityOf(gnomadResult, { unknown }),
      plddt: plddt?.[v.position - 1] ?? null,
      numberingOk: checkNumbering(sequence, v.refAA, v.position),
    };
  });
}
