// Gene overview: what the gene does, where it is active, and where it sits on the genome.
// Three public sources, each allowed to fail on its own (the card then says what is missing):
//   UniProt   the curated "Function" and "Tissue specificity" text, plus the NCBI Gene ID
//   NCBI Gene the cytogenetic band (such as 17p13.1) and other names
//   gnomAD    the gene's full name, chromosome, start, end and strand on GRCh38
// Nothing here is written or guessed by this app: text is UniProt's own wording.
import { ncbiGet } from './clinvar.js';
import { GNOMAD_GENOME } from './gnomad.js';
import { HttpError, getJson } from './http.js';

const UNIPROT_URL = 'https://rest.uniprot.org/uniprotkb/search';
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const GNOMAD_URL = 'https://gnomad.broadinstitute.org/api';
export const SHORT_TEXT_CHARS = 320; // how much of a long description is shown before "Show more"

// Removes UniProt's inline literature references such as "(PubMed:11279501, PubMed:11279502)".
// Other notes in brackets, like "(By similarity)", are kept because they change the meaning.
export function cleanUniprotText(text) {
  if (typeof text !== 'string') return null;
  const clean = text
    .replace(/\s*\(PubMed:[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean === '' ? null : clean;
}

// Splits a long text into a short start (ending at a sentence end when possible) and the rest.
// Short texts come back whole with rest = null.
export function splitSummary(text, max = SHORT_TEXT_CHARS) {
  if (text === null || text.length <= max + 60) return { short: text, rest: null };
  const window = text.slice(0, max);
  const end = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '));
  const cut = end > 40 ? end + 1 : window.lastIndexOf(' ');
  const short = text.slice(0, cut > 0 ? cut : max).trim();
  const rest = text.slice(short.length).trim();
  return { short: end > 40 ? short : `${short}…`, rest: rest === '' ? null : rest };
}

// Reads one comment type (e.g. "FUNCTION") from a UniProt entry; isoform-specific notes are ignored.
function commentText(hit, type) {
  const comments = (hit.comments ?? []).filter((c) => c.commentType === type && !c.molecule);
  const text = comments.flatMap((c) => (c.texts ?? []).map((t) => t.value)).join(' ');
  return cleanUniprotText(text);
}

// Pulls the function text, tissue text and NCBI Gene ID out of a UniProt entry.
export function parseUniprotOverview(hit) {
  const geneId = (hit?.uniProtKBCrossReferences ?? []).find((x) => x.database === 'GeneID')?.id;
  return {
    function: commentText(hit ?? {}, 'FUNCTION'),
    tissue: commentText(hit ?? {}, 'TISSUE SPECIFICITY'),
    geneId: typeof geneId === 'string' && /^\d{1,10}$/.test(geneId) ? geneId : null,
  };
}

// Pulls the cytogenetic band and other names out of an NCBI Gene esummary record.
export function parseNcbiGene(record) {
  const band = typeof record?.maplocation === 'string' ? record.maplocation.trim() : '';
  const aliases = String(record?.otheraliases ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  return { band: band === '' ? null : band, aliases };
}

// Checks gnomAD's gene record and keeps only well-formed fields.
export function parseGnomadGene(gene) {
  const isPos = (n) => Number.isInteger(n) && n > 0;
  return {
    geneName: typeof gene?.name === 'string' && gene.name !== '' ? gene.name : null,
    chromosome:
      typeof gene?.chrom === 'string' && /^[0-9XYM]{1,2}$/.test(gene.chrom) ? gene.chrom : null,
    start: isPos(gene?.start) ? gene.start : null,
    stop: isPos(gene?.stop) ? gene.stop : null,
    strand: gene?.strand === '+' || gene?.strand === '-' ? gene.strand : null,
  };
}

// Runs one part; returns {ok:true, value, meta} or {ok:false, error}. Cancellation re-throws.
async function part(source, task) {
  try {
    const { value, fetchedAt, fromCache } = await task();
    return { ok: true, value, meta: { source, fetchedAt, fromCache: Boolean(fromCache) } };
  } catch (err) {
    if (err instanceof HttpError && err.kind === 'aborted') throw err;
    return { ok: false, source, error: err instanceof Error ? err.message : String(err) };
  }
}

// UniProt: function and tissue text for a protein accession.
async function fetchText(accession, { signal, group, refresh }) {
  const params = new URLSearchParams({
    query: `accession:${accession}`,
    fields: 'accession,cc_function,cc_tissue_specificity,xref_geneid',
    format: 'json',
    size: '1',
  });
  const { data, fetchedAt, fromCache } = await getJson(`${UNIPROT_URL}?${params}`, {
    signal,
    group,
    noCache: refresh,
  });
  const hit = data.results?.[0];
  if (!hit) throw new Error('UniProt returned no entry.');
  return { value: parseUniprotOverview(hit), fetchedAt, fromCache };
}

// NCBI Gene: cytogenetic band and other names for a Gene ID (shares ClinVar's NCBI rate limit).
async function fetchNcbi(geneId, { signal, group, refresh }) {
  const params = new URLSearchParams({ db: 'gene', id: geneId, retmode: 'json' });
  const { data, fetchedAt, fromCache } = await ncbiGet(`${EUTILS}/esummary.fcgi?${params}`, {
    signal,
    group,
    noCache: refresh,
  });
  const record = data.result?.[geneId];
  if (!record || record.error) throw new Error('NCBI Gene returned no record.');
  return { value: parseNcbiGene(record), fetchedAt, fromCache };
}

// gnomAD: name and genomic position of the gene on GRCh38.
async function fetchLocation(symbol, { signal, group, refresh }) {
  const query = `{ gene(gene_symbol: ${JSON.stringify(symbol)}, reference_genome: ${GNOMAD_GENOME}) {
    name chrom start stop strand } }`;
  const { data, fetchedAt, fromCache } = await getJson(GNOMAD_URL, {
    method: 'POST',
    body: JSON.stringify({ query }),
    signal,
    group,
    noCache: refresh,
  });
  if (data.errors?.length) throw new Error(data.errors[0].message);
  if (!data.data?.gene) throw new Error('gnomAD returned no gene record.');
  return { value: parseGnomadGene(data.data.gene), fetchedAt, fromCache };
}

// Loads the overview for a gene. Throws only if every source failed; otherwise `problems` lists the
// sources that could not be reached and their fields stay null ("not available" on screen).
export async function fetchOverview(symbol, accession, { signal, group, refresh = false } = {}) {
  const request = { signal, group, refresh };
  const [location, text] = await Promise.all([
    part('gnomAD', () => fetchLocation(symbol, request)),
    part('UniProt', () => fetchText(accession, request)),
  ]);
  const geneId = text.ok ? text.value.geneId : null;
  const ncbi = geneId ? await part('NCBI Gene', () => fetchNcbi(geneId, request)) : null;

  const parts = [text, location, ncbi].filter(Boolean);
  const good = parts.filter((p) => p.ok);
  if (good.length === 0) throw new Error(parts.map((p) => `${p.source}: ${p.error}`).join('; '));

  const value = (p) => (p?.ok ? p.value : null);
  return {
    geneName: value(location)?.geneName ?? null,
    chromosome: value(location)?.chromosome ?? null,
    start: value(location)?.start ?? null,
    stop: value(location)?.stop ?? null,
    strand: value(location)?.strand ?? null,
    build: location.ok ? GNOMAD_GENOME : null,
    function: value(text)?.function ?? null,
    tissue: value(text)?.tissue ?? null,
    band: value(ncbi)?.band ?? null,
    aliases: value(ncbi)?.aliases ?? [],
    accession,
    problems: parts.filter((p) => !p.ok).map((p) => ({ source: p.source, error: p.error })),
    parts: good.map((p) => p.meta),
    fetchedAt: Math.min(...good.map((p) => p.meta.fetchedAt)),
    fromCache: good.every((p) => p.meta.fromCache),
  };
}
