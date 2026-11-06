// Tests for the gene overview: text cleaning, parsing real-shaped responses, and partial failures.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/http.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getJson: vi.fn(),
}));
const { getJson, HttpError } = await import('../../src/core/http.js');
const {
  cleanUniprotText,
  fetchOverview,
  parseGnomadGene,
  parseNcbiGene,
  parseUniprotOverview,
  splitSummary,
} = await import('../../src/core/overview.js');

// Shaped like the real responses checked for CTLA4 (UniProt, NCBI Gene esummary, gnomAD).
const UNIPROT_HIT = {
  primaryAccession: 'P16410',
  comments: [
    {
      commentType: 'FUNCTION',
      texts: [
        {
          value:
            'Inhibitory receptor acting as a major negative regulator of T-cell responses (PubMed:11279501, PubMed:11279502). Acts as a decoy receptor.',
        },
      ],
    },
    {
      commentType: 'FUNCTION',
      molecule: 'Isoform 2',
      texts: [{ value: 'Only for isoform 2.' }],
    },
    {
      commentType: 'TISSUE SPECIFICITY',
      texts: [{ value: 'Widely expressed with highest levels in lymphoid tissues.' }],
    },
  ],
  uniProtKBCrossReferences: [
    { database: 'HGNC', id: 'HGNC:2505' },
    { database: 'GeneID', id: '1493' },
  ],
};
const NCBI_RECORD = { maplocation: '2q33.2', otheraliases: 'ALPS5, CD, CD152, CTLA-4' };
const GNOMAD_GENE = {
  name: 'cytotoxic T-lymphocyte associated protein 4',
  chrom: '2',
  start: 203867771,
  stop: 203873965,
  strand: '+',
};

const reply = (data, fromCache = false) => ({ data, fetchedAt: 1000, fromCache });

// Answers each request by host, like the real services do.
function serve({ uniprot = UNIPROT_HIT, ncbi = NCBI_RECORD, gnomad = GNOMAD_GENE } = {}) {
  getJson.mockImplementation(async (url) => {
    if (url.includes('uniprot.org')) {
      if (uniprot instanceof Error) throw uniprot;
      return reply({ results: uniprot ? [uniprot] : [] });
    }
    if (url.includes('ncbi.nlm.nih.gov')) {
      if (ncbi instanceof Error) throw ncbi;
      return reply({ result: { uids: ['1493'], 1493: ncbi } }, true);
    }
    if (gnomad instanceof Error) throw gnomad;
    return reply({ data: { gene: gnomad } });
  });
}

beforeEach(() => {
  getJson.mockReset();
});

describe('cleanUniprotText', () => {
  it('removes PubMed references but keeps other notes', () => {
    expect(
      cleanUniprotText(
        'Acts early (PubMed:1, PubMed:2). Also this (By similarity). Done (PubMed:3)',
      ),
    ).toBe('Acts early. Also this (By similarity). Done');
  });
  it('gives null for empty or non-text input', () => {
    for (const bad of ['', '   ', '(PubMed:1)', null, undefined, 5]) {
      expect(cleanUniprotText(bad)).toBeNull();
    }
  });
});

describe('splitSummary', () => {
  it('leaves short text whole', () => {
    expect(splitSummary('Short text.')).toEqual({ short: 'Short text.', rest: null });
    expect(splitSummary(null)).toEqual({ short: null, rest: null });
  });
  it('cuts long text at a sentence end and keeps every word', () => {
    const text =
      `${'First sentence is here. '.repeat(3)}${'Another sentence follows after. '.repeat(20)}`.trim();
    const { short, rest } = splitSummary(text, 100);
    expect(short.endsWith('.')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(100);
    expect(`${short} ${rest}`).toBe(text);
  });
  it('cuts at a word when there is no sentence end, marking it with an ellipsis', () => {
    const { short, rest } = splitSummary('word '.repeat(200), 100);
    expect(short.endsWith('…')).toBe(true);
    expect(rest.length).toBeGreaterThan(0);
  });
});

describe('parsers', () => {
  it('reads function, tissue and Gene ID from UniProt, ignoring isoform-only notes', () => {
    const r = parseUniprotOverview(UNIPROT_HIT);
    expect(r.function).toBe(
      'Inhibitory receptor acting as a major negative regulator of T-cell responses. Acts as a decoy receptor.',
    );
    expect(r.tissue).toBe('Widely expressed with highest levels in lymphoid tissues.');
    expect(r.geneId).toBe('1493');
  });
  it('gives nulls for an entry with no such comments, and rejects a bad Gene ID', () => {
    expect(parseUniprotOverview({})).toEqual({ function: null, tissue: null, geneId: null });
    expect(
      parseUniprotOverview({ uniProtKBCrossReferences: [{ database: 'GeneID', id: '12;DROP' }] })
        .geneId,
    ).toBeNull();
  });
  it('reads the band and names from NCBI Gene', () => {
    expect(parseNcbiGene(NCBI_RECORD)).toEqual({
      band: '2q33.2',
      aliases: ['ALPS5', 'CD', 'CD152', 'CTLA-4'],
    });
    expect(parseNcbiGene({})).toEqual({ band: null, aliases: [] });
  });
  it('keeps only well-formed gnomAD fields', () => {
    expect(parseGnomadGene(GNOMAD_GENE)).toMatchObject({ chromosome: '2', strand: '+' });
    expect(
      parseGnomadGene({ chrom: 'chr2; x', start: -4, stop: 1.5, strand: '?', name: '' }),
    ).toEqual({
      geneName: null,
      chromosome: null,
      start: null,
      stop: null,
      strand: null,
    });
    expect(parseGnomadGene(null).chromosome).toBeNull();
  });
});

describe('fetchOverview', () => {
  it('combines the three sources', async () => {
    serve();
    const o = await fetchOverview('CTLA4', 'P16410', { group: 'CTLA4' });
    expect(o).toMatchObject({
      geneName: 'cytotoxic T-lymphocyte associated protein 4',
      chromosome: '2',
      start: 203867771,
      stop: 203873965,
      strand: '+',
      build: 'GRCh38',
      band: '2q33.2',
      aliases: ['ALPS5', 'CD', 'CD152', 'CTLA-4'],
      problems: [],
    });
    expect(o.function).toContain('negative regulator of T-cell responses');
    expect(o.parts.map((p) => p.source).sort()).toEqual(['NCBI Gene', 'UniProt', 'gnomAD']);
    expect(o.fromCache).toBe(false); // two parts were downloaded
  });

  it('asks NCBI for the Gene ID that UniProt gave', async () => {
    serve();
    await fetchOverview('CTLA4', 'P16410', {});
    const ncbiCall = getJson.mock.calls.find(([url]) => url.includes('ncbi.nlm.nih.gov'));
    expect(ncbiCall[0]).toContain('db=gene');
    expect(ncbiCall[0]).toContain('id=1493');
  });

  it('missing pieces stay null and failed sources are listed, not hidden', async () => {
    serve({ ncbi: new Error('NCBI down') });
    const o = await fetchOverview('CTLA4', 'P16410', {});
    expect(o.band).toBeNull();
    expect(o.aliases).toEqual([]);
    expect(o.chromosome).toBe('2');
    expect(o.problems).toEqual([{ source: 'NCBI Gene', error: 'NCBI down' }]);
  });

  it('works when UniProt has no text (function and tissue stay null)', async () => {
    serve({ uniprot: { primaryAccession: 'X', comments: [] } });
    const o = await fetchOverview('X1', 'X', {});
    expect(o.function).toBeNull();
    expect(o.tissue).toBeNull();
    expect(o.problems).toEqual([]);
  });

  it('does not ask NCBI at all when UniProt has no Gene ID', async () => {
    serve({ uniprot: { primaryAccession: 'X', comments: [] } });
    await fetchOverview('X1', 'X', {});
    expect(getJson.mock.calls.some(([url]) => url.includes('ncbi.nlm.nih.gov'))).toBe(false);
  });

  it('a gnomAD failure leaves the position empty, with no build claimed', async () => {
    serve({ gnomad: new Error('Gene not found') });
    const o = await fetchOverview('CTLA4', 'P16410', {});
    expect(o.chromosome).toBeNull();
    expect(o.build).toBeNull();
    expect(o.band).toBe('2q33.2');
    expect(o.problems[0].source).toBe('gnomAD');
  });

  it('throws only when every source failed', async () => {
    serve({ uniprot: new Error('a'), gnomad: new Error('b') });
    await expect(fetchOverview('CTLA4', 'P16410', {})).rejects.toThrow(/UniProt: a; gnomAD: b/);
  });

  it('cancellation propagates instead of being reported as a failed source', async () => {
    getJson.mockRejectedValue(new HttpError('aborted', 'Request cancelled.'));
    await expect(fetchOverview('CTLA4', 'P16410', {})).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('is "cached" only when every part came from saved data', async () => {
    getJson.mockImplementation(async (url) => {
      if (url.includes('uniprot.org')) return reply({ results: [UNIPROT_HIT] }, true);
      if (url.includes('ncbi')) return reply({ result: { 1493: NCBI_RECORD } }, true);
      return reply({ data: { gene: GNOMAD_GENE } }, true);
    });
    expect((await fetchOverview('CTLA4', 'P16410', {})).fromCache).toBe(true);
  });
});
