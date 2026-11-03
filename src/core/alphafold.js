// AlphaFold DB: UniProt accession -> predicted structure (PDB text) and per-residue pLDDT.
import { getJson, HttpError } from './http.js';

const API_URL = 'https://alphafold.ebi.ac.uk/api/prediction';

// Reads pLDDT from the B-factor column of each C-alpha atom (AlphaFold stores confidence there).
// Returns an array where index i holds residue i + 1; residues without a C-alpha stay null.
export function parsePlddt(pdbText) {
  const values = [];
  for (const line of pdbText.split('\n')) {
    if (!line.startsWith('ATOM') || line.slice(12, 16).trim() !== 'CA') continue;
    const residueNumber = Number(line.slice(22, 26));
    const bFactor = Number(line.slice(60, 66));
    if (Number.isInteger(residueNumber) && residueNumber >= 1 && Number.isFinite(bFactor)) {
      values[residueNumber - 1] = bFactor;
    }
  }
  // Fill holes (missing residues) with null so the array has no empty slots.
  return Array.from(values, (value) => value ?? null);
}

// Fetches the canonical model for an accession; returns null if AlphaFold has none.
export async function fetchAlphaFold(accession, { signal } = {}) {
  let entries;
  try {
    ({ data: entries } = await getJson(`${API_URL}/${encodeURIComponent(accession)}`, { signal }));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
  // The response also lists isoform models; the canonical one is AF-<accession>-F1.
  const entry = entries.find((e) => e.entryId === `AF-${accession}-F1`);
  if (!entry) return null;

  // Always use the URL the API gives us (the model version changes over time).
  const pdb = await getJson(entry.pdbUrl, { responseType: 'text', signal });
  const plddt = parsePlddt(pdb.data);
  return {
    entryId: entry.entryId,
    modelVersion: entry.latestVersion,
    pdbUrl: entry.pdbUrl,
    cifUrl: entry.cifUrl,
    pdbText: pdb.data,
    plddt,
    meanPlddt: entry.globalMetricValue ?? null,
    sequence: entry.uniprotSequence,
    fetchedAt: pdb.fetchedAt,
    fromCache: pdb.fromCache,
  };
}
