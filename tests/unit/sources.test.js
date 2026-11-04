// Tests for the UniProt, AlphaFold and gnomAD fetchers. getJson is mocked with saved API responses.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/http.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getJson: vi.fn(),
}));
const { getJson, HttpError } = await import('../../src/core/http.js');
const { fetchUniprot, GeneNotFoundError, isValidGeneSymbol } =
  await import('../../src/core/uniprot.js');
const { fetchAlphaFold, parsePlddt } = await import('../../src/core/alphafold.js');
const { fetchGnomadConstraint, fetchGnomadVariants, GnomadError } =
  await import('../../src/core/gnomad.js');
const { fixture } = await import('./fixture.js');

// Makes getJson return `data` once, in the shape the real adapter returns.
const reply = (data) => ({ data, fetchedAt: 1000, fromCache: false, stale: false, offline: false });

beforeEach(() => {
  getJson.mockReset();
});

describe('isValidGeneSymbol', () => {
  it('allows letters, digits and hyphens only', () => {
    for (const ok of ['BRCA1', 'tp53', 'HLA-A', 'C1orf10'])
      expect(isValidGeneSymbol(ok)).toBe(true);
    for (const bad of ['', 'BRCA1;DROP', 'A B', 'a'.repeat(21), 'TP53 OR 1=1', '"x"', null, 5]) {
      expect(isValidGeneSymbol(bad), String(bad)).toBe(false);
    }
  });
});

describe('fetchUniprot', () => {
  it('returns accession, name, length and the reference sequence', async () => {
    getJson.mockResolvedValue(reply(fixture('uniprot-TP53.json')));
    const r = await fetchUniprot('TP53');
    expect(r).toMatchObject({
      accession: 'P04637',
      geneSymbol: 'TP53',
      length: 393,
      matchedAlias: false,
    });
    expect(r.proteinName).toBe('Cellular tumor antigen p53');
    expect(r.sequence).toHaveLength(393);
    const url = getJson.mock.calls[0][0];
    expect(url).toContain('organism_id%3A9606');
    expect(url).toContain('reviewed%3Atrue');
  });

  it('flags aliases (P53 resolves to TP53)', async () => {
    getJson.mockResolvedValue(reply(fixture('uniprot-TP53.json')));
    const r = await fetchUniprot('P53');
    expect(r.geneSymbol).toBe('TP53');
    expect(r.matchedAlias).toBe(true);
  });

  it('throws GeneNotFoundError when there is no hit', async () => {
    getJson.mockResolvedValue(reply(fixture('uniprot-empty.json')));
    await expect(fetchUniprot('NOTAGENE')).rejects.toBeInstanceOf(GeneNotFoundError);
  });

  it('prefers the hit whose official name equals the input when several come back', async () => {
    const base = fixture('uniprot-TP53.json').results[0];
    const other = {
      ...base,
      primaryAccession: 'Q00000',
      genes: [{ geneName: { value: 'OTHER' } }],
    };
    getJson.mockResolvedValue(reply({ results: [other, base] }));
    const r = await fetchUniprot('TP53');
    expect(r.accession).toBe('P04637');
    expect(r.otherAccessions).toEqual(['Q00000']);
  });

  it('rejects invalid symbols without touching the network', async () => {
    await expect(fetchUniprot('TP53 OR 1=1')).rejects.toThrow(TypeError);
    expect(getJson).not.toHaveBeenCalled();
  });

  it('passes the abort signal through', async () => {
    getJson.mockResolvedValue(reply(fixture('uniprot-TP53.json')));
    const controller = new AbortController();
    await fetchUniprot('TP53', { signal: controller.signal });
    expect(getJson.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('parsePlddt', () => {
  const pdb = fixture('alphafold-P04637-residues1-25.pdb');
  const values = parsePlddt(pdb);

  it('reads pLDDT from the C-alpha B-factor column, one value per residue', () => {
    expect(values).toHaveLength(25);
    expect(values[0]).toBeCloseTo(42.72, 2); // residue 1 (matches the Phase 1 check)
    expect(values[1]).toBeCloseTo(43.59, 2);
    expect(values[2]).toBeCloseTo(37.78, 2);
  });
  it('ignores non C-alpha atoms and non-ATOM lines', () => {
    expect(
      parsePlddt('HEADER x\nHETATM    1  CA  FOO A   1       0.0 0.0 0.0  1.00 50.00\n'),
    ).toEqual([]);
  });
  it('leaves null for a residue that has no C-alpha', () => {
    const line = (n, atom, b) =>
      `ATOM  ${String(n).padStart(5)}  ${atom.padEnd(3)} ALA A${String(n).padStart(4)}       0.000   0.000   0.000  1.00${b.padStart(6)}`;
    expect(parsePlddt([line(1, 'CA', '90.00'), line(3, 'CA', '70.00')].join('\n'))).toEqual([
      90,
      null,
      70,
    ]);
  });
});

describe('fetchAlphaFold', () => {
  const { entries } = fixture('alphafold-P04637.json');
  const pdb = fixture('alphafold-P04637-residues1-25.pdb');

  it('picks the canonical entry (not an isoform) and uses the URL the API returned', async () => {
    // Put an isoform first to prove we select by entryId, not by position.
    getJson
      .mockResolvedValueOnce(reply([entries[1], entries[0]]))
      .mockResolvedValueOnce(reply(pdb));
    const r = await fetchAlphaFold('P04637');
    expect(r.entryId).toBe('AF-P04637-F1');
    expect(getJson.mock.calls[1][0]).toBe(entries[0].pdbUrl);
    expect(getJson.mock.calls[1][1].responseType).toBe('text');
    expect(r.plddt).toHaveLength(25);
    expect(r.modelVersion).toBe(entries[0].latestVersion);
    expect(r.sequence).toBe(entries[0].uniprotSequence);
  });

  it('returns null when AlphaFold has no model (404) or no canonical entry', async () => {
    getJson.mockRejectedValueOnce(new HttpError('http', 'HTTP 404', 404));
    expect(await fetchAlphaFold('P00000')).toBeNull();
    getJson.mockResolvedValueOnce(reply([entries[1]]));
    expect(await fetchAlphaFold('P04637')).toBeNull();
  });

  it('rethrows other errors', async () => {
    getJson.mockRejectedValueOnce(new HttpError('http', 'HTTP 500', 500));
    await expect(fetchAlphaFold('P04637')).rejects.toThrow('HTTP 500');
  });
});

describe('fetchGnomadVariants', () => {
  it('keeps missense variants only and computes AF from the joint counts', async () => {
    getJson.mockResolvedValue(reply(fixture('gnomad-TP53-variants.json')));
    const r = await fetchGnomadVariants('TP53');
    const all = fixture('gnomad-TP53-variants.json').data.gene.variants;
    expect(r.variants.length).toBe(all.filter((v) => v.consequence === 'missense_variant').length);
    expect(
      r.variants.every((v) => v.proteinKey === null || /^[A-Z]\d+[A-Z]$/.test(v.proteinKey)),
    ).toBe(true);
    const withAc = r.variants.find((v) => v.ac > 0);
    expect(withAc.af).toBeCloseTo(withAc.ac / withAc.an, 15);
    expect(r.datasetId).toBe('gnomad_r4');
    expect(r.referenceGenome).toBe('GRCh38');
    const body = JSON.parse(getJson.mock.calls[0][1].body);
    expect(body.query).toContain('gnomad_r4');
    expect(body.query).toContain('GRCh38');
  });

  it('reports af null when there is no joint data', async () => {
    const data = {
      data: {
        gene: {
          variants: [
            {
              variant_id: '1-1-A-C',
              hgvsp: 'p.Ala1Gly',
              consequence: 'missense_variant',
              joint: null,
            },
          ],
        },
      },
    };
    getJson.mockResolvedValue(reply(data));
    const [v] = (await fetchGnomadVariants('X1')).variants;
    expect(v).toMatchObject({ ac: null, an: null, af: null, proteinKey: 'A1G' });
  });

  it('throws GnomadError on a GraphQL error such as an unknown gene', async () => {
    getJson.mockResolvedValue(reply(fixture('gnomad-gene-not-found.json')));
    await expect(fetchGnomadVariants('NOTAGENE')).rejects.toBeInstanceOf(GnomadError);
  });
});

describe('fetchGnomadConstraint', () => {
  it('maps pLI, LOEUF and missense scores', async () => {
    getJson.mockResolvedValue(reply(fixture('gnomad-TP53-constraint.json')));
    const c = await fetchGnomadConstraint('TP53');
    expect(c.pli).toBeCloseTo(0.9996, 4);
    expect(c.loeuf).toBeCloseTo(0.4184, 4);
    expect(c.misZ).toBeCloseTo(1.1216, 4);
    expect(c.obsMis).toBe(464);
    expect(c.maneRefseq).toBe('NM_000546');
  });

  it('returns null ("not available") when gnomAD has no constraint for the gene', async () => {
    getJson.mockResolvedValue(reply({ data: { gene: { gnomad_constraint: null } } }));
    expect(await fetchGnomadConstraint('X1')).toBeNull();
  });
});

describe('saved data options reach the adapter', () => {
  it('UniProt, AlphaFold and gnomAD pass the gene tag and Refresh to getJson', async () => {
    getJson.mockResolvedValue(reply(fixture('uniprot-TP53.json')));
    await fetchUniprot('TP53', { group: 'TP53', refresh: true });
    expect(getJson.mock.calls[0][1]).toMatchObject({ group: 'TP53', noCache: true });

    getJson.mockReset();
    getJson
      .mockResolvedValueOnce(reply(fixture('alphafold-P04637.json').entries))
      .mockResolvedValueOnce(reply(fixture('alphafold-P04637-residues1-25.pdb')));
    await fetchAlphaFold('P04637', { group: 'TP53', refresh: true });
    for (const call of getJson.mock.calls)
      expect(call[1]).toMatchObject({ group: 'TP53', noCache: true });

    getJson.mockReset();
    getJson.mockResolvedValue(reply(fixture('gnomad-TP53-variants.json')));
    await fetchGnomadVariants('TP53', { group: 'TP53', refresh: true });
    expect(getJson.mock.calls[0][1]).toMatchObject({ group: 'TP53', noCache: true });

    getJson.mockReset();
    getJson.mockResolvedValue(reply(fixture('gnomad-TP53-constraint.json')));
    await fetchGnomadConstraint('TP53', { group: 'TP53' });
    expect(getJson.mock.calls[0][1]).toMatchObject({ group: 'TP53', noCache: false });
  });

  it('defaults to using saved data (no Refresh) when the option is not given', async () => {
    getJson.mockResolvedValue(reply(fixture('uniprot-TP53.json')));
    await fetchUniprot('TP53');
    expect(getJson.mock.calls[0][1].noCache).toBe(false);
  });
});
