// UniProt: gene symbol -> accession, protein name and the reference sequence for ALL numbering.
import { getJson } from './http.js';

const SEARCH_URL = 'https://rest.uniprot.org/uniprotkb/search';

// Thrown when a source has no entry for the requested gene.
export class GeneNotFoundError extends Error {
  constructor(symbol, source) {
    super(`No ${source} entry found for "${symbol}".`);
    this.name = 'GeneNotFoundError';
    this.symbol = symbol;
    this.source = source;
  }
}

// Gene symbols are letters, digits and hyphens only (also keeps them safe inside query strings).
export function isValidGeneSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(symbol);
}

// Looks up the reviewed (Swiss-Prot) human entry; aliases such as "P53" resolve to TP53.
export async function fetchUniprot(symbol, { signal, group, refresh = false } = {}) {
  if (!isValidGeneSymbol(symbol)) throw new TypeError('Invalid gene symbol.');
  const query = `gene_exact:${symbol} AND organism_id:9606 AND reviewed:true`;
  const params = new URLSearchParams({
    query,
    fields: 'accession,gene_names,protein_name,length,sequence',
    format: 'json',
    size: '5',
  });
  const { data, fetchedAt, fromCache } = await getJson(`${SEARCH_URL}?${params}`, {
    signal,
    group,
    noCache: refresh,
  });

  const hits = data.results ?? [];
  if (hits.length === 0) throw new GeneNotFoundError(symbol, 'UniProt');
  // Prefer a hit whose official gene name equals the input; otherwise take the top hit.
  const official = (hit) => hit.genes?.[0]?.geneName?.value ?? null;
  const hit = hits.find((h) => official(h)?.toUpperCase() === symbol.toUpperCase()) ?? hits[0];

  return {
    accession: hit.primaryAccession,
    geneSymbol: official(hit) ?? symbol.toUpperCase(),
    proteinName: hit.proteinDescription?.recommendedName?.fullName?.value ?? null,
    length: hit.sequence.length,
    sequence: hit.sequence.value,
    // True when the user typed an alias or old name rather than the official symbol.
    matchedAlias: official(hit)?.toUpperCase() !== symbol.toUpperCase(),
    otherAccessions: hits.filter((h) => h !== hit).map((h) => h.primaryAccession),
    fetchedAt,
    fromCache,
  };
}
