// Pipeline: loads everything for one gene and joins it. Each source can fail on its own (partial
// results); only the UniProt lookup is fatal because it defines the sequence and numbering.
import { fetchUniprot } from './uniprot.js';
import { fetchAlphaFold } from './alphafold.js';
import { fetchClinvar } from './clinvar.js';
import { fetchGnomadConstraint, fetchGnomadVariants } from './gnomad.js';
import { fetchOverview } from './overview.js';
import { joinVariants, numberingReport } from './join.js';
import { summarize } from './stats.js';
import { HttpError } from './http.js';
import { groupFor, isOutOfDate } from './freshness.js';

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
// `onProgress` receives {phase: 'clinvar', loaded, total}. Saved data is used when there is any,
// whatever its age; `refresh: true` skips it and downloads everything again.
export async function loadGene(symbol, { signal, onProgress, maxVariants, refresh = false } = {}) {
  // The UniProt lookup is saved under the typed symbol (it may be an alias such as "P53"); the
  // rest is saved under the official symbol. Deleting a gene removes both.
  const uniprot = await fetchUniprot(symbol, { signal, group: groupFor(symbol), refresh });
  const gene = uniprot.geneSymbol;
  const request = { signal, group: groupFor(gene), refresh };

  const [alphafold, clinvar, gnomadVariants, constraint, overview] = await Promise.all([
    settle(() => fetchAlphaFold(uniprot.accession, request)),
    settle(() =>
      fetchClinvar(gene, {
        ...request,
        maxVariants,
        onProgress: (p) => onProgress?.({ phase: 'clinvar', ...p }),
      }),
    ),
    settle(() => fetchGnomadVariants(gene, request)),
    settle(() => fetchGnomadConstraint(gene, request)),
    settle(() => fetchOverview(gene, uniprot.accession, request)),
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

  const provenance = buildProvenance({
    uniprot,
    alphafold,
    clinvar,
    gnomadVariants,
    constraint,
    overview,
  });
  return {
    gene: uniprot,
    alphafold,
    clinvar,
    gnomadVariants,
    constraint,
    overview,
    variants,
    numbering,
    summary,
    provenance,
    freshness: summarizeFreshness(provenance),
  };
}

// Lists where each piece of data came from and when it was fetched (for the About box).
function buildProvenance({ uniprot, alphafold, clinvar, gnomadVariants, constraint, overview }) {
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
  if (overview.status === 'ok') {
    const detail = {
      UniProt: 'function text',
      'NCBI Gene': 'band and names',
      gnomAD: 'gene location',
    };
    for (const p of overview.value.parts) {
      entries.push({ source: `${p.source} (overview)`, detail: detail[p.source], ...pickMeta(p) });
    }
  }
  return entries;
}

// Keeps only the freshness fields of a source result.
function pickMeta({ fetchedAt, fromCache }) {
  return { fetchedAt, fromCache: Boolean(fromCache) };
}

// Overall freshness: the oldest fetch time decides; "cached" only if every source came from saved
// data; "outOfDate" when that oldest copy is more than 7 days old (a Refresh would get newer data).
function summarizeFreshness(provenance) {
  const fetchedAt = Math.min(...provenance.map((p) => p.fetchedAt));
  return {
    fetchedAt,
    fromCache: provenance.every((p) => p.fromCache),
    outOfDate: isOutOfDate(fetchedAt),
  };
}
