// "What this means" sentences. Rule-based: every number comes from computed data, and the
// thresholds used are stated. Nothing here is generated medical advice.
import { formatCount, formatPct, formatScore } from './format.js';
import {
  DENSITY_HALF_WINDOW,
  PLDDT_CONFIDENT,
  RARITY_THRESHOLDS,
  densityWindows,
} from './stats.js';

const PATHOGENIC = new Set(['Pathogenic', 'Likely pathogenic']);

// Finds the residue with the most pathogenic variants nearby; null if there are none.
export function densestRegion(variants, length) {
  const positions = variants
    .filter((v) => v.numberingOk && PATHOGENIC.has(v.classification))
    .map((v) => v.position);
  const { counts, max } = densityWindows(positions, length);
  if (max === 0) return null;
  const centre = counts.indexOf(max) + 1;
  return {
    centre,
    count: max,
    from: Math.max(1, centre - DENSITY_HALF_WINDOW),
    to: Math.min(length, centre + DENSITY_HALF_WINDOW),
  };
}

// Builds the list of sentences for the panel from the summary, variants, constraint and pLDDT.
export function buildSummarySentences({ gene, summary, variants, length, constraint, plddt }) {
  if (summary.total === 0) {
    return [
      `No missense variants with a usable ClinVar classification were available for ${gene}.`,
    ];
  }
  const sentences = [];
  const {
    pathogenicShare: p,
    pathogenicInConfidentRegions: c,
    pathogenicAbsentOrUltraRare: r,
  } = summary;

  sentences.push(
    `${formatCount(summary.total)} missense variants were analysed. ${formatCount(p.n)} (${formatPct(p)}) are classified Pathogenic or Likely pathogenic by ClinVar.`,
  );
  sentences.push(
    c.of === 0
      ? 'AlphaFold confidence scores are not available for the pathogenic variants.'
      : `${formatCount(c.n)} of ${formatCount(c.of)} pathogenic or likely pathogenic variants (${formatPct(c)}) lie in regions where AlphaFold's pLDDT is at least ${PLDDT_CONFIDENT} (a confident prediction).`,
  );
  sentences.push(
    r.of === 0
      ? 'gnomAD frequencies are not available for the pathogenic variants.'
      : `${formatCount(r.n)} of ${formatCount(r.of)} pathogenic or likely pathogenic variants (${formatPct(r)}) are absent from gnomAD or ultra-rare (allele frequency below ${RARITY_THRESHOLDS.ultraRare}).`,
  );

  const region = densestRegion(variants, length);
  if (region) {
    const score = plddt?.[region.centre - 1];
    sentences.push(
      `The densest cluster of pathogenic variants is around residue ${region.centre}: ${region.count} within ${DENSITY_HALF_WINDOW} residues either side${score === null || score === undefined ? '' : `, where pLDDT is ${formatScore(score, 3)}`}.`,
    );
  }
  if (constraint) {
    sentences.push(
      `gnomAD observed ${formatCount(constraint.obsMis)} of ${formatScore(constraint.expMis, 4)} expected missense variants in ${gene} (observed/expected ${formatScore(constraint.oeMis)}; missense Z ${formatScore(constraint.misZ)}).`,
    );
  }
  sentences.push(
    `VUS and conflicting records (${formatCount((summary.byClassification.VUS ?? 0) + (summary.byClassification.Conflicting ?? 0))}) are not counted as evidence either way. Rarity buckets: absent = not in gnomAD, ultra-rare < ${RARITY_THRESHOLDS.ultraRare}, rare < ${RARITY_THRESHOLDS.rare}, low-frequency < ${RARITY_THRESHOLDS.lowFrequency}, common at or above that.`,
  );
  return sentences;
}
