// gnomAD: gene -> missense variant frequencies and gene-level constraint (GraphQL).
import { getJson } from './http.js';
import { parseProteinChange, proteinKey } from './parse.js';

const API_URL = 'https://gnomad.broadinstitute.org/api';
export const GNOMAD_DATASET = 'gnomad_r4';
export const GNOMAD_GENOME = 'GRCh38';

// Thrown when gnomAD answers with a GraphQL error (for example "Gene not found").
export class GnomadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GnomadError';
  }
}

// Sends one GraphQL query and returns its `data`, turning GraphQL errors into exceptions.
async function graphql(query, signal) {
  const { data, fetchedAt, fromCache, offline } = await getJson(API_URL, {
    method: 'POST',
    body: JSON.stringify({ query }),
    signal,
  });
  if (data.errors?.length) throw new GnomadError(data.errors[0].message);
  return { data: data.data, fetchedAt, fromCache, offline };
}

// Gets all missense variants of a gene. Frequencies use gnomAD's "joint" counts (exomes + genomes
// with overlapping samples already handled by gnomAD), so we never double count.
export async function fetchGnomadVariants(symbol, { signal } = {}) {
  const query = `{ gene(gene_symbol: ${JSON.stringify(symbol)}, reference_genome: ${GNOMAD_GENOME}) {
    variants(dataset: ${GNOMAD_DATASET}) { variant_id hgvsp hgvsc consequence joint { ac an } } } }`;
  const { data, fetchedAt, fromCache, offline } = await graphql(query, signal);

  const variants = data.gene.variants
    .filter((v) => v.consequence === 'missense_variant')
    .map((v) => {
      const parsed = parseProteinChange(v.hgvsp);
      return {
        variantId: v.variant_id,
        hgvsp: v.hgvsp,
        hgvsc: v.hgvsc,
        proteinKey: parsed.ok ? proteinKey(parsed.refAA, parsed.position, parsed.altAA) : null,
        ac: v.joint?.ac ?? null,
        an: v.joint?.an ?? null,
        af: v.joint && v.joint.an > 0 ? v.joint.ac / v.joint.an : null,
      };
    });
  return {
    datasetId: GNOMAD_DATASET,
    referenceGenome: GNOMAD_GENOME,
    variants,
    fetchedAt,
    fromCache,
    offline,
  };
}

// Gets gene-level constraint scores; returns null if gnomAD has none for this gene.
export async function fetchGnomadConstraint(symbol, { signal } = {}) {
  const query = `{ gene(gene_symbol: ${JSON.stringify(symbol)}, reference_genome: ${GNOMAD_GENOME}) {
    canonical_transcript_id mane_select_transcript { refseq_id }
    gnomad_constraint { pli oe_lof_upper mis_z oe_mis exp_mis obs_mis flags } } }`;
  const { data, fetchedAt, fromCache, offline } = await graphql(query, signal);
  const c = data.gene.gnomad_constraint;
  if (!c) return null;
  return {
    pli: c.pli,
    loeuf: c.oe_lof_upper,
    misZ: c.mis_z,
    oeMis: c.oe_mis,
    expMis: c.exp_mis,
    obsMis: c.obs_mis,
    flags: c.flags ?? [],
    maneRefseq: data.gene.mane_select_transcript?.refseq_id ?? null,
    canonicalTranscript: data.gene.canonical_transcript_id ?? null,
    fetchedAt,
    fromCache,
    offline,
  };
}
