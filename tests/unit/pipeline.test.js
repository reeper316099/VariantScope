// Tests for the pipeline: success, partial results (one source failing) and cancellation.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/uniprot.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUniprot: vi.fn(),
}));
vi.mock('../../src/core/alphafold.js', () => ({ fetchAlphaFold: vi.fn() }));
vi.mock('../../src/core/clinvar.js', () => ({ fetchClinvar: vi.fn() }));
vi.mock('../../src/core/gnomad.js', () => ({
  fetchGnomadVariants: vi.fn(),
  fetchGnomadConstraint: vi.fn(),
}));

const { fetchUniprot, GeneNotFoundError } = await import('../../src/core/uniprot.js');
const { fetchAlphaFold } = await import('../../src/core/alphafold.js');
const { fetchClinvar } = await import('../../src/core/clinvar.js');
const { fetchGnomadVariants, fetchGnomadConstraint } = await import('../../src/core/gnomad.js');
const { HttpError } = await import('../../src/core/http.js');
const { loadGene } = await import('../../src/core/pipeline.js');

const SEQUENCE = 'MKRHAGLQ';
const clinvarResult = {
  variants: [
    {
      clinvarId: '1',
      refAA: 'H',
      position: 4,
      altAA: 'R',
      classification: 'Pathogenic',
      clinvarLabel: 'Pathogenic',
      reviewStatus: 'x',
      coordKey: '17-1-A-G',
    },
  ],
  skipped: { total: 3, reasons: [], complete: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  fetchUniprot.mockResolvedValue({
    accession: 'P1',
    geneSymbol: 'GENE1',
    sequence: SEQUENCE,
    length: 8,
  });
  fetchAlphaFold.mockResolvedValue({ plddt: [10, 20, 30, 95, 50, 60, 70, 80] });
  fetchClinvar.mockResolvedValue(clinvarResult);
  fetchGnomadVariants.mockResolvedValue({
    variants: [{ variantId: '17-1-A-G', proteinKey: 'H4R', ac: 1, an: 1_000_000, af: 1e-6 }],
  });
  fetchGnomadConstraint.mockResolvedValue({ pli: 0.9 });
});

describe('loadGene', () => {
  it('joins everything when all sources succeed', async () => {
    const r = await loadGene('gene1');
    expect(
      ['alphafold', 'clinvar', 'gnomadVariants', 'constraint'].map((k) => r[k].status),
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]).toMatchObject({ plddt: 95, rarity: 'ultra-rare', numberingOk: true });
    expect(r.numbering.flagged).toBe(false);
    expect(r.summary.skipped).toBe(3);
  });

  it('uses the official gene symbol from UniProt for the other sources', async () => {
    await loadGene('alias');
    expect(fetchClinvar.mock.calls[0][0]).toBe('GENE1');
    expect(fetchGnomadVariants.mock.calls[0][0]).toBe('GENE1');
  });

  it('partial: gnomAD failure still shows ClinVar + structure, rarity "unknown" (not "absent")', async () => {
    fetchGnomadVariants.mockRejectedValue(new Error('gnomAD down'));
    const r = await loadGene('gene1');
    expect(r.gnomadVariants).toEqual({ status: 'failed', error: 'gnomAD down', kind: null });
    expect(r.clinvar.status).toBe('ok');
    expect(r.variants[0].rarity).toBe('unknown');
    expect(r.variants[0].plddt).toBe(95);
  });

  it('partial: AlphaFold failure leaves pLDDT null but keeps the rest', async () => {
    fetchAlphaFold.mockRejectedValue(new Error('no structure'));
    const r = await loadGene('gene1');
    expect(r.alphafold.status).toBe('failed');
    expect(r.variants[0].plddt).toBeNull();
    expect(r.variants[0].rarity).toBe('ultra-rare');
  });

  it('partial: AlphaFold with no model (null) is OK but gives no pLDDT', async () => {
    fetchAlphaFold.mockResolvedValue(null);
    const r = await loadGene('gene1');
    expect(r.alphafold).toEqual({ status: 'ok', value: null });
    expect(r.variants[0].plddt).toBeNull();
  });

  it('partial: ClinVar failure gives no variants but keeps the other sources', async () => {
    fetchClinvar.mockRejectedValue(new Error('NCBI down'));
    const r = await loadGene('gene1');
    expect(r.clinvar.status).toBe('failed');
    expect(r.variants).toEqual([]);
    expect(r.summary).toBeNull();
    expect(r.constraint.status).toBe('ok');
  });

  it('flags numbering when the ClinVar residues do not match the UniProt sequence', async () => {
    fetchClinvar.mockResolvedValue({
      ...clinvarResult,
      variants: [{ ...clinvarResult.variants[0], refAA: 'W' }],
    });
    const r = await loadGene('gene1');
    expect(r.numbering.flagged).toBe(true);
    expect(r.summary.total).toBe(0); // mismatching variants are not analysed
  });

  it('forwards ClinVar progress to the caller', async () => {
    fetchClinvar.mockImplementation(async (_g, { onProgress }) => {
      onProgress({ loaded: 2, total: 4 });
      return clinvarResult;
    });
    const seen = [];
    await loadGene('gene1', { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([{ phase: 'clinvar', loaded: 2, total: 4 }]);
  });

  it('a missing gene is fatal', async () => {
    fetchUniprot.mockRejectedValue(new GeneNotFoundError('NOPE', 'UniProt'));
    await expect(loadGene('NOPE')).rejects.toBeInstanceOf(GeneNotFoundError);
    expect(fetchClinvar).not.toHaveBeenCalled();
  });

  it('cancellation propagates instead of being reported as a failed source', async () => {
    fetchClinvar.mockRejectedValue(new HttpError('aborted', 'Request cancelled.'));
    await expect(loadGene('gene1')).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('passes the abort signal to every source', async () => {
    const controller = new AbortController();
    await loadGene('gene1', { signal: controller.signal });
    for (const fn of [
      fetchUniprot,
      fetchAlphaFold,
      fetchClinvar,
      fetchGnomadVariants,
      fetchGnomadConstraint,
    ]) {
      expect(fn.mock.calls[0].at(-1).signal).toBe(controller.signal);
    }
  });
});

describe('loadGene: saved data, groups and Refresh', () => {
  it('tags saved data with the gene: the typed symbol for the UniProt lookup, the official one for the rest', async () => {
    await loadGene('alias');
    expect(fetchUniprot.mock.calls[0][1]).toMatchObject({ group: 'ALIAS', refresh: false });
    for (const fn of [fetchAlphaFold, fetchClinvar, fetchGnomadVariants, fetchGnomadConstraint]) {
      expect(fn.mock.calls[0].at(-1)).toMatchObject({ group: 'GENE1', refresh: false });
    }
  });

  it('Refresh is passed to every source', async () => {
    await loadGene('gene1', { refresh: true });
    for (const fn of [
      fetchUniprot,
      fetchAlphaFold,
      fetchClinvar,
      fetchGnomadVariants,
      fetchGnomadConstraint,
    ]) {
      expect(fn.mock.calls[0].at(-1).refresh).toBe(true);
    }
  });

  it('reports data older than 7 days as out of date, and fresh data as current', async () => {
    const DAY = 86_400_000;
    const stamp = (daysAgo) => ({ fetchedAt: Date.now() - daysAgo * DAY, fromCache: true });
    fetchUniprot.mockResolvedValue({
      accession: 'P1',
      geneSymbol: 'GENE1',
      sequence: SEQUENCE,
      length: 8,
      ...stamp(1),
    });
    fetchAlphaFold.mockResolvedValue({ plddt: [], ...stamp(10) }); // the oldest piece decides
    fetchClinvar.mockResolvedValue({ ...clinvarResult, ...stamp(2) });
    fetchGnomadVariants.mockResolvedValue({ variants: [], ...stamp(2) });
    fetchGnomadConstraint.mockResolvedValue({ pli: 1, ...stamp(2) });
    const old = await loadGene('gene1');
    expect(old.freshness.outOfDate).toBe(true);
    expect(old.freshness.fromCache).toBe(true);

    fetchAlphaFold.mockResolvedValue({ plddt: [], ...stamp(3) });
    expect((await loadGene('gene1')).freshness.outOfDate).toBe(false);
  });
});
