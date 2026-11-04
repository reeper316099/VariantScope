// ClinVar (NCBI E-utilities): gene -> missense variants with classification and review status.
import { getJson, HttpError } from './http.js';
import { isValidGeneSymbol } from './uniprot.js';
import {
  normalizeClassification,
  parseClinvarTitle,
  parseProteinChange,
  spdiToVariantId,
} from './parse.js';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export const MAX_VARIANTS = 1500; // cap on variants loaded per gene (the UI shows a notice)
const BATCH_SIZE = 200; // ids per esummary request
const ESEARCH_PAGE = 5000; // esearch returns at most this many ids per request
const NCBI_GAP_MS = 400; // NCBI allows 3 requests/second without an API key; stay safely below

// ClinVar's "clinsig" properties: the four confident classes we load first when capping.
const CONFIDENT_CLASSES =
  '("clinsig pathogenic"[Properties] OR "clinsig likely pathogenic"[Properties] OR ' +
  '"clinsig benign"[Properties] OR "clinsig likely benign"[Properties])';

// Consequence groups used to explain what was skipped (each excludes the groups before it).
const SKIP_GROUPS = [
  ['frameshift', '"frameshift variant"[molecular consequence]'],
  ['nonsense (stop gained)', '"nonsense"[molecular consequence]'],
  ['synonymous', '"synonymous variant"[molecular consequence]'],
  [
    'splice site',
    '("splice donor variant"[molecular consequence] OR "splice acceptor variant"[molecular consequence])',
  ],
  [
    'in-frame insertion/deletion',
    '("inframe_deletion"[molecular consequence] OR "inframe_insertion"[molecular consequence] OR "inframe_indel"[molecular consequence])',
  ],
  [
    'start-loss / stop-loss',
    '("initiator codon variant"[molecular consequence] OR "stop lost"[molecular consequence])',
  ],
];

// Waits `ms` milliseconds but rejects early if the search was cancelled.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new HttpError('aborted', 'Request cancelled.'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new HttpError('aborted', 'Request cancelled.'));
      },
      { once: true },
    );
  });
}

// All NCBI calls run one at a time, at least NCBI_GAP_MS apart. Cached replies cost no network
// time, so they do not count toward the gap.
let queue = Promise.resolve();
let lastNetworkCall = 0;
// `req` is {signal, group, noCache}: cancellation, the gene tag for saved data, and Refresh.
function ncbiGet(url, req, track) {
  const run = queue.then(async () => {
    await sleep(Math.max(0, lastNetworkCall + NCBI_GAP_MS - Date.now()), req.signal);
    const started = Date.now();
    const reply = await getJson(url, {
      signal: req.signal,
      group: req.group,
      noCache: req.noCache,
    });
    if (!reply.fromCache) lastNetworkCall = started;
    track?.(reply);
    return reply;
  });
  queue = run.catch(() => {});
  return run;
}

// Runs an esearch and returns {count, ids} (ids limited to `retmax`). `track` sees every reply.
async function esearch(term, retmax, req, track) {
  const ids = [];
  let count;
  // Page through the results; the first request also tells us the total count (even if retmax is 0).
  do {
    const params = new URLSearchParams({
      db: 'clinvar',
      term,
      retmode: 'json',
      retstart: String(ids.length),
      retmax: String(Math.min(ESEARCH_PAGE, retmax - ids.length)),
    });
    const { data } = await ncbiGet(`${EUTILS}/esearch.fcgi?${params}`, req, track);
    count = Number(data.esearchresult.count);
    if (data.esearchresult.idlist.length === 0) break;
    ids.push(...data.esearchresult.idlist);
  } while (ids.length < Math.min(count, retmax));
  return { count, ids };
}

// Fetches esummary records for a list of ids, in batches, reporting progress after each batch.
async function esummaryAll(ids, req, onProgress, track) {
  const records = [];
  onProgress?.({ loaded: 0, total: ids.length });
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const params = new URLSearchParams({
      db: 'clinvar',
      retmode: 'json',
      id: ids.slice(i, i + BATCH_SIZE).join(','),
    });
    const { data } = await ncbiGet(`${EUTILS}/esummary.fcgi?${params}`, req, track);
    for (const uid of data.result.uids) records.push(data.result[uid]);
    onProgress?.({ loaded: Math.min(i + BATCH_SIZE, ids.length), total: ids.length });
  }
  return records;
}

// Converts one esummary record to a variant, or {skip: reason} if it cannot be plotted.
export function parseSummaryRecord(record, gene) {
  const { gene: titleGene, protein } = parseClinvarTitle(record.title);
  // The gene named in the title decides the numbering; overlapping genes share records.
  if (titleGene?.toUpperCase() !== gene.toUpperCase())
    return { skip: 'record belongs to an overlapping gene' };
  if (!protein) return { skip: 'no protein change (splice, intronic or non-coding)' };
  const parsed = parseProteinChange(protein);
  if (!parsed.ok) return { skip: parsed.reason };

  const germline = record.germline_classification ?? {};
  const classification = normalizeClassification(germline.description);
  if (!classification) return { skip: 'no usable ClinVar germline classification' };

  return {
    variant: {
      clinvarId: String(record.uid),
      title: record.title,
      refAA: parsed.refAA,
      position: parsed.position,
      altAA: parsed.altAA,
      classification,
      clinvarLabel: germline.description,
      reviewStatus: germline.review_status ?? '',
      coordKey: spdiToVariantId(record.variation_set?.[0]?.canonical_spdi),
    },
  };
}

// Counts why non-missense records exist (frameshift, splice, ...). Returns null if it fails;
// this is an explanation only, so a failure must not break loading.
async function countNonMissense(gene, missenseTotal, req) {
  try {
    const geneTerm = `${gene}[gene]`;
    const { count: total } = await esearch(geneTerm, 0, req);
    const reasons = [];
    let excluded = '';
    let counted = 0;
    for (const [reason, term] of SKIP_GROUPS) {
      const { count } = await esearch(
        `${geneTerm} NOT "missense variant"[molecular consequence]${excluded} AND ${term}`,
        0,
        req,
      );
      if (count > 0) reasons.push({ reason, count });
      counted += count;
      excluded += ` NOT ${term}`;
    }
    const other = total - missenseTotal - counted;
    if (other > 0)
      reasons.push({ reason: 'other (non-coding or unclassified consequence)', count: other });
    return { total: total - missenseTotal, reasons };
  } catch (err) {
    if (err instanceof HttpError && err.kind === 'aborted') throw err;
    return null;
  }
}

// Loads missense variants for a gene. If there are more than maxVariants, confident classes
// (pathogenic/likely pathogenic/benign/likely benign) are loaded first, then the rest.
export async function fetchClinvar(
  gene,
  {
    signal,
    onProgress,
    maxVariants = MAX_VARIANTS,
    includeSkipBreakdown = true,
    group,
    refresh = false,
  } = {},
) {
  if (!isValidGeneSymbol(gene)) throw new TypeError('Invalid gene symbol.');
  const req = { signal, group, noCache: refresh };
  const missense = `${gene}[gene] AND "missense variant"[molecular consequence]`;

  // Every data reply is recorded so we can report how fresh the data is (saved copy or new?).
  const replies = [];
  const track = (reply) => replies.push(reply);

  const confident = await esearch(`${missense} AND ${CONFIDENT_CLASSES}`, maxVariants, req, track);
  const rest = await esearch(
    `${missense} NOT ${CONFIDENT_CLASSES}`,
    Math.max(0, maxVariants - confident.ids.length),
    req,
    track,
  );
  const ids = [...confident.ids, ...rest.ids];
  const totalAvailable = confident.count + rest.count;

  const records = await esummaryAll(ids, req, onProgress, track);
  const variants = [];
  const dropped = new Map();
  for (const record of records) {
    const result = parseSummaryRecord(record, gene);
    if (result.variant) variants.push(result.variant);
    else dropped.set(result.skip, (dropped.get(result.skip) ?? 0) + 1);
  }

  const breakdown = includeSkipBreakdown ? await countNonMissense(gene, totalAvailable, req) : null;
  // The two reason lists cover different records (non-missense vs. unplottable missense), so equal
  // labels are added together rather than listed twice.
  const merged = new Map();
  for (const { reason, count } of breakdown?.reasons ?? []) merged.set(reason, count);
  for (const [reason, count] of dropped) merged.set(reason, (merged.get(reason) ?? 0) + count);
  const reasons = [...merged].map(([reason, count]) => ({ reason, count }));
  const droppedTotal = [...dropped.values()].reduce((a, b) => a + b, 0);

  return {
    gene,
    variants,
    totalAvailable, // all missense records ClinVar has for this gene
    loaded: ids.length,
    capped: totalAvailable > ids.length, // some missense records were not loaded (cap)
    maxVariants,
    skipped: {
      total: (breakdown?.total ?? 0) + droppedTotal,
      reasons,
      // false when the non-missense explanation could not be fetched: total is then a lower bound
      complete: breakdown !== null,
    },
    // Freshness of the data: the oldest reply decides the age.
    fetchedAt: replies.length ? Math.min(...replies.map((r) => r.fetchedAt)) : Date.now(),
    fromCache: replies.length > 0 && replies.every((r) => r.fromCache),
  };
}
