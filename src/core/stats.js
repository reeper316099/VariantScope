// Statistics: rarity buckets, density windows and summary numbers. All pure functions.

// Rarity thresholds (allele frequency). Shown in the UI legend, so change them here only.
export const RARITY_THRESHOLDS = Object.freeze({
  ultraRare: 1e-5, // AF below this: ultra-rare
  rare: 1e-4, // AF below this: rare
  lowFrequency: 1e-2, // AF below this: low-frequency; at or above: common
});
export const RARITY_LABELS = ['absent', 'ultra-rare', 'rare', 'low-frequency', 'common', 'unknown'];

// pLDDT at or above this counts as "confidently predicted" (AlphaFold's own "confident" band).
export const PLDDT_CONFIDENT = 70;
// Half-width (in residues) of the window used to smooth variant density along the sequence.
export const DENSITY_HALF_WINDOW = 10;

const PATHOGENIC = new Set(['Pathogenic', 'Likely pathogenic']);

// Puts an allele frequency into a bucket; null/undefined means we do not know.
export function rarityFromAf(af) {
  if (af === null || af === undefined || Number.isNaN(af)) return 'unknown';
  if (af <= 0) return 'absent';
  if (af < RARITY_THRESHOLDS.ultraRare) return 'ultra-rare';
  if (af < RARITY_THRESHOLDS.rare) return 'rare';
  if (af < RARITY_THRESHOLDS.lowFrequency) return 'low-frequency';
  return 'common';
}

// Rarity of a joined gnomAD record. `unknown` is true when the answer could not be determined
// (gnomAD query failed, or the match was ambiguous), which is different from "absent".
export function rarityOf(gnomad, { unknown = false } = {}) {
  if (unknown) return 'unknown';
  if (!gnomad.found) return 'absent';
  return rarityFromAf(gnomad.af);
}

// Counts pathogenic variants within +/- halfWindow residues of every residue 1..length.
// Returns {counts, max}; counts[i] belongs to residue i + 1.
export function densityWindows(positions, length, halfWindow = DENSITY_HALF_WINDOW) {
  const perResidue = new Array(length + 2).fill(0);
  for (const position of positions) {
    if (Number.isInteger(position) && position >= 1 && position <= length)
      perResidue[position] += 1;
  }
  // Prefix sums make each window an O(1) lookup instead of re-scanning.
  const prefix = new Array(length + 2).fill(0);
  for (let i = 1; i <= length; i++) prefix[i] = prefix[i - 1] + perResidue[i];
  const counts = [];
  let max = 0;
  for (let residue = 1; residue <= length; residue++) {
    const from = Math.max(1, residue - halfWindow);
    const to = Math.min(length, residue + halfWindow);
    const count = prefix[to] - prefix[from - 1];
    counts.push(count);
    if (count > max) max = count;
  }
  return { counts, max };
}

// Builds {n, of, pct} where pct is null (not available) when the denominator is zero.
function share(n, of) {
  return { n, of, pct: of === 0 ? null : (100 * n) / of };
}

// Counts how many items fall into each key (used for classification and rarity tallies).
function tally(items, keyOf) {
  const counts = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] ?? 0) + 1;
  return counts;
}

// Summary numbers for the stat cards. Only variants with matching numbering are analysed.
export function summarize(variants, { skippedCount = 0 } = {}) {
  const analysed = variants.filter((v) => v.numberingOk);
  const pathogenic = analysed.filter((v) => PATHOGENIC.has(v.classification));
  const withPlddt = pathogenic.filter((v) => v.plddt !== null);
  const withKnownRarity = pathogenic.filter((v) => v.rarity !== 'unknown');
  return {
    total: analysed.length,
    pathogenicShare: share(pathogenic.length, analysed.length),
    pathogenicInConfidentRegions: share(
      withPlddt.filter((v) => v.plddt >= PLDDT_CONFIDENT).length,
      withPlddt.length,
    ),
    pathogenicAbsentOrUltraRare: share(
      withKnownRarity.filter((v) => v.rarity === 'absent' || v.rarity === 'ultra-rare').length,
      withKnownRarity.length,
    ),
    skipped: skippedCount,
    byClassification: tally(analysed, (v) => v.classification),
    byRarity: tally(analysed, (v) => v.rarity),
  };
}
