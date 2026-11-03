// Tests for the ClinVar fetcher: record parsing (real saved records), paging, cap, skip counts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/http.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getJson: vi.fn(),
}));
const { getJson, HttpError } = await import('../../src/core/http.js');
const { fetchClinvar, parseSummaryRecord } = await import('../../src/core/clinvar.js');
const { fixture } = await import('./fixture.js');

const esummary = fixture('clinvar-TP53-esummary.json').result;
const record = (re) => esummary.uids.map((u) => esummary[u]).find((r) => re.test(r.title));

describe('parseSummaryRecord (real ClinVar records)', () => {
  it('parses a pathogenic missense record with coordinates and review status', () => {
    const { variant } = parseSummaryRecord(record(/Arg175His/), 'TP53');
    expect(variant).toMatchObject({
      clinvarId: '12374',
      refAA: 'R',
      position: 175,
      altAA: 'H',
      classification: 'Pathogenic',
      clinvarLabel: 'Pathogenic',
    });
    expect(variant.reviewStatus).toBeTruthy();
    expect(variant.coordKey).toMatch(/^17-\d+-[ACGT]-[ACGT]$/);
  });

  it('maps combined labels but keeps ClinVar wording', () => {
    const { variant } = parseSummaryRecord(record(/Arg282Trp/), 'TP53');
    expect(variant.classification).toBe('Pathogenic');
    expect(variant.clinvarLabel).toBe('Pathogenic/Likely pathogenic');
  });

  it('maps VUS, Conflicting and Benign', () => {
    expect(parseSummaryRecord(record(/Arg174Thr/), 'TP53').variant.classification).toBe('VUS');
    expect(parseSummaryRecord(record(/Ala88Thr/), 'TP53').variant.classification).toBe(
      'Conflicting',
    );
    expect(parseSummaryRecord(record(/Glu51Asp/), 'TP53').variant.classification).toBe('Benign');
  });

  const skips = [
    [/Cys238=/, 'synonymous (no amino-acid change)'],
    [/Pro219fs/, 'frameshift'],
    [/Arg280Ter/, 'nonsense (stop gained)'],
    [/Asn239dup/, 'duplication'],
    [/Thr170del\)/, 'deletion'],
    [/Glu346delins/, 'in-frame deletion/insertion (delins)'],
    [/c\.994-6_994-1del/, 'no protein change (splice, intronic or non-coding)'],
    [/WRAP53/, 'record belongs to an overlapping gene'],
    [/Leu130Arg/, 'no usable ClinVar germline classification'],
    [/Ter394Cys/, 'stop-loss / extension'],
  ];
  it.each(skips)('skips %s with a reason', (re, reason) => {
    expect(parseSummaryRecord(record(re), 'TP53')).toEqual({ skip: reason });
  });

  it('uses the gene in the title: the WRAP53 record is not skipped as "overlapping" for WRAP53 itself', () => {
    // It is still skipped, but for its own reason (Met1 start-loss), proving the gene check passed.
    expect(parseSummaryRecord(record(/WRAP53/), 'WRAP53')).toEqual({ skip: 'start-loss (Met1)' });
  });
});

// Builds a fake NCBI: esearch returns ids by query type; esummary returns records for requested ids.
function fakeNcbi({ confident = [], rest = [], total = 0, failCounts = false } = {}) {
  const calls = [];
  getJson.mockImplementation(async (url) => {
    const u = new URL(url);
    calls.push(u);
    const params = u.searchParams;
    let data;
    if (u.pathname.endsWith('esearch.fcgi')) {
      const term = params.get('term');
      const retmax = Number(params.get('retmax'));
      const retstart = Number(params.get('retstart'));
      const isMissenseOnly =
        term.includes('"missense variant"[molecular consequence]') &&
        !term.includes('NOT "missense');
      let ids = [];
      let count;
      if (isMissenseOnly && term.includes('NOT ("clinsig')) [ids, count] = [rest, rest.length];
      else if (isMissenseOnly) [ids, count] = [confident, confident.length];
      else if (failCounts) throw new HttpError('http', 'HTTP 500', 500);
      else
        count =
          term.includes(' AND "') || term.includes('NOT "missense')
            ? term.includes('"frameshift variant"')
              ? 7
              : 0
            : total;
      data = {
        esearchresult: {
          count: String(count),
          idlist: ids.slice(retstart, retstart + retmax).map(String),
        },
      };
    } else {
      const wanted = params.get('id').split(',');
      data = { result: { uids: wanted } };
      for (const id of wanted) {
        data.result[id] = {
          uid: id,
          title: `NM_1.1(TP53):c.1A>G (p.Ala${Number(id) + 1}Gly)`,
          germline_classification: {
            description: 'Uncertain significance',
            review_status: 'criteria provided, single submitter',
          },
          variation_set: [{ canonical_spdi: `NC_000017.11:${id}:A:G` }],
        };
      }
    }
    return { data, fetchedAt: 1, fromCache: true, stale: false, offline: false };
  });
  return calls;
}

describe('fetchClinvar', () => {
  beforeEach(() => {
    getJson.mockReset();
  });

  it('rejects invalid gene symbols without any request', async () => {
    await expect(fetchClinvar('TP53 OR x')).rejects.toThrow(TypeError);
    expect(getJson).not.toHaveBeenCalled();
  });

  it('loads confident classes first, then the rest, and reports progress in batches', async () => {
    const calls = fakeNcbi({ confident: [1, 2, 3], rest: [4, 5], total: 20 });
    const progress = [];
    const r = await fetchClinvar('TP53', {
      onProgress: (p) => progress.push(p),
      includeSkipBreakdown: false,
    });
    expect(r.variants.map((v) => v.clinvarId)).toEqual(['1', '2', '3', '4', '5']);
    expect(r.totalAvailable).toBe(5);
    expect(r.capped).toBe(false);
    expect(progress[0]).toEqual({ loaded: 0, total: 5 });
    expect(progress.at(-1)).toEqual({ loaded: 5, total: 5 });
    expect(calls.some((u) => u.pathname.endsWith('esummary.fcgi'))).toBe(true);
  });

  it('applies the cap, keeps the confident classes, and says it was capped', async () => {
    fakeNcbi({ confident: [1, 2, 3], rest: [4, 5, 6, 7], total: 20 });
    const r = await fetchClinvar('TP53', { maxVariants: 4, includeSkipBreakdown: false });
    expect(r.variants.map((v) => v.clinvarId)).toEqual(['1', '2', '3', '4']);
    expect(r.loaded).toBe(4);
    expect(r.totalAvailable).toBe(7);
    expect(r.capped).toBe(true);
    expect(r.maxVariants).toBe(4);
  });

  it('splits esummary requests into batches of 200 ids', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const calls = fakeNcbi({ confident: ids, rest: [], total: 450 });
    const r = await fetchClinvar('TP53', { maxVariants: 1500, includeSkipBreakdown: false });
    expect(r.variants).toHaveLength(450);
    const summaries = calls.filter((u) => u.pathname.endsWith('esummary.fcgi'));
    expect(summaries.map((u) => u.searchParams.get('id').split(',').length)).toEqual([
      200, 200, 50,
    ]);
  });

  it('counts skipped variants with reasons, including a non-missense breakdown', async () => {
    fakeNcbi({ confident: [1], rest: [], total: 50 });
    const r = await fetchClinvar('TP53');
    expect(r.skipped.complete).toBe(true);
    expect(r.skipped.reasons.find((x) => x.reason === 'frameshift').count).toBe(7);
    expect(r.skipped.total).toBeGreaterThan(0);
  });

  it('merges equal skip reasons instead of listing them twice', async () => {
    fakeNcbi({ confident: [1], rest: [], total: 50 });
    const r = await fetchClinvar('TP53');
    const labels = r.skipped.reasons.map((x) => x.reason);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('still returns variants when the skip breakdown fails (marked incomplete)', async () => {
    fakeNcbi({ confident: [1, 2], rest: [], total: 50, failCounts: true });
    const r = await fetchClinvar('TP53');
    expect(r.variants).toHaveLength(2);
    expect(r.skipped.complete).toBe(false);
  });

  it('cancels when the signal is aborted', async () => {
    const controller = new AbortController();
    getJson.mockImplementation(async () => {
      controller.abort();
      throw new HttpError('aborted', 'Request cancelled.');
    });
    await expect(fetchClinvar('TP53', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});
