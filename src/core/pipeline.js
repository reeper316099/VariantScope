// Pipeline: loads everything for one gene and joins it. Each source can fail on its own (partial
// results); only the UniProt lookup is fatal because it defines the sequence and numbering.
import { fetchUniprot } from './uniprot.js';
import { fetchAlphaFold } from './alphafold.js';
import { fetchClinvar } from './clinvar.js';
import { fetchGnomadConstraint, fetchGnomadVariants } from './gnomad.js';
import { joinVariants, numberingReport } from './join.js';
import { summarize } from './stats.js';
import { HttpError } from './http.js';

// Runs one source; returns {status:'ok', value} or {status:'failed', error}. Cancellation re-throws.
async function settle(task) {
  try {
    return { status: 'ok', value: await task() };
  } catch (err) {
    if (err instanceof HttpError && err.kind === 'aborted') throw err;
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      kind: err.kind ?? null,
    };
  }
}

// Loads and joins data for a gene symbol. Pass an AbortSignal to cancel when a new search starts.
// `onProgress` receives {phase: 'clinvar', loaded, total}.
export async function loadGene(symbol, { signal, onProgress, maxVariants } = {}) {
  const uniprot = await fetchUniprot(symbol, { signal });
  const gene = uniprot.geneSymbol;

  const [alphafold, clinvar, gnomadVariants, constraint] = await Promise.all([
    settle(() => fetchAlphaFold(uniprot.accession, { signal })),
    settle(() =>
      fetchClinvar(gene, {
        signal,
        maxVariants,
        onProgress: (p) => onProgress?.({ phase: 'clinvar', ...p }),
      }),
    ),
    settle(() => fetchGnomadVariants(gene, { signal })),
    settle(() => fetchGnomadConstraint(gene, { signal })),
  ]);

  let variants = [];
  let numbering = null;
  let summary = null;
  if (clinvar.status === 'ok') {
    // A failed gnomAD query is passed on as {ok:false}, so rarity becomes "unknown", not "absent".
    const gnomad =
      gnomadVariants.status === 'ok'
        ? { ok: true, variants: gnomadVariants.value.variants }
        : { ok: false };
    const plddt = alphafold.status === 'ok' ? (alphafold.value?.plddt ?? null) : null;
    variants = joinVariants({
      clinvar: clinvar.value.variants,
      gnomad,
      sequence: uniprot.sequence,
      plddt,
    });
    numbering = numberingReport(variants);
    summary = summarize(variants, { skippedCount: clinvar.value.skipped.total });
  }

  const provenance = buildProvenance({ uniprot, alphafold, clinvar, gnomadVariants, constraint });
  return {
    gene: uniprot,
    alphafold,
    clinvar,
    gnomadVariants,
    constraint,
    variants,
    numbering,
    summary,
    provenance,
    freshness: summarizeFreshness(provenance),
  };
}

// Lists where each piece of data came from and when it was fetched (for the About box).
function buildProvenance({ uniprot, alphafold, clinvar, gnomadVariants, constraint }) {
  const entries = [{ source: 'UniProt', detail: uniprot.accession, ...pickMeta(uniprot) }];
  if (alphafold.status === 'ok' && alphafold.value) {
    const { entryId, modelVersion } = alphafold.value;
    entries.push({
      source: 'AlphaFold DB',
      detail: `${entryId}, model v${modelVersion}`,
      ...pickMeta(alphafold.value),
    });
  }
  if (clinvar.status === 'ok')
    entries.push({ source: 'ClinVar', detail: 'NCBI E-utilities', ...pickMeta(clinvar.value) });
  if (gnomadVariants.status === 'ok') {
    const { datasetId, referenceGenome } = gnomadVariants.value;
    entries.push({
      source: 'gnomAD',
      detail: `${datasetId}, ${referenceGenome}`,
      ...pickMeta(gnomadVariants.value),
    });
  }
  if (constraint.status === 'ok' && constraint.value) {
    entries.push({
      source: 'gnomAD constraint',
      detail: 'gene-level scores',
      ...pickMeta(constraint.value),
    });
  }
  return entries;
}

// Keeps only the freshness fields of a source result.
function pickMeta({ fetchedAt, fromCache, offline }) {
  return { fetchedAt, fromCache: Boolean(fromCache), offline: Boolean(offline) };
}

// Overall freshness: the oldest fetch time; "cached" only if every source came from the cache.
function summarizeFreshness(provenance) {
  return {
    fetchedAt: Math.min(...provenance.map((p) => p.fetchedAt)),
    fromCache: provenance.every((p) => p.fromCache),
    offline: provenance.some((p) => p.offline),
  };
}
