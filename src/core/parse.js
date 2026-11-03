// Parsing helpers: protein changes, ClinVar titles, classifications and genomic coordinates.

export const AA3_TO_1 = Object.freeze({
  Ala: 'A',
  Arg: 'R',
  Asn: 'N',
  Asp: 'D',
  Cys: 'C',
  Gln: 'Q',
  Glu: 'E',
  Gly: 'G',
  His: 'H',
  Ile: 'I',
  Leu: 'L',
  Lys: 'K',
  Met: 'M',
  Phe: 'F',
  Pro: 'P',
  Ser: 'S',
  Thr: 'T',
  Trp: 'W',
  Tyr: 'Y',
  Val: 'V',
});
export const AA1_TO_3 = Object.freeze(
  Object.fromEntries(Object.entries(AA3_TO_1).map(([three, one]) => [one, three])),
);

const ONE_LETTER = '[ACDEFGHIKLMNPQRSTVWY]';
const THREE_LETTER = '[A-Z][a-z]{2}';

// Turns a residue triple into the canonical "p.Arg1699Trp" text.
export function formatProteinChange(refAA, position, altAA) {
  return `p.${AA1_TO_3[refAA]}${position}${AA1_TO_3[altAA]}`;
}

// Explains why a protein change that is not a simple missense cannot be plotted (or null if it can).
function skipReason(body) {
  if (/delins/.test(body)) return 'in-frame deletion/insertion (delins)';
  if (/dup/.test(body)) return 'duplication';
  if (/del/.test(body)) return 'deletion';
  if (/ins/.test(body)) return 'insertion';
  if (/fs/.test(body)) return 'frameshift';
  if (/ext/.test(body) || /^Ter\d+/.test(body)) return 'stop-loss / extension';
  if (/^Met1(\D|$)/.test(body)) return 'start-loss (Met1)';
  if (/(Ter|\*)$/.test(body)) return 'nonsense (stop gained)';
  if (/=$/.test(body)) return 'synonymous (no amino-acid change)';
  if (/\?/.test(body)) return 'unknown effect';
  return null;
}

// Parses "p.Arg1699Trp", "NP_009225.1:p.(Arg1699Trp)" or "R1699W" into {ok, refAA, position, altAA}.
// Anything that is not a clean single-residue missense returns {ok:false, reason}.
export function parseProteinChange(text) {
  if (typeof text !== 'string' || text.trim() === '')
    return { ok: false, reason: 'no protein change' };
  // Strip a transcript/protein prefix ("NP_009225.1:"), the "p." marker and parentheses.
  const body = text.trim().replace(/^.*:/, '').replace(/^p\./, '').replace(/[()]/g, '');

  const reason = skipReason(body);
  if (reason) return { ok: false, reason };

  const three = body.match(new RegExp(`^(${THREE_LETTER})(\\d+)(${THREE_LETTER})$`));
  if (three) {
    const refAA = AA3_TO_1[three[1]];
    const altAA = AA3_TO_1[three[3]];
    if (!refAA || !altAA) return { ok: false, reason: 'non-standard amino acid' };
    if (refAA === altAA) return { ok: false, reason: 'synonymous (no amino-acid change)' };
    return { ok: true, refAA, position: Number(three[2]), altAA };
  }
  const one = body.match(new RegExp(`^(${ONE_LETTER})(\\d+)(${ONE_LETTER})$`));
  if (one) {
    if (one[1] === one[3]) return { ok: false, reason: 'synonymous (no amino-acid change)' };
    return { ok: true, refAA: one[1], position: Number(one[2]), altAA: one[3] };
  }
  return { ok: false, reason: 'unrecognised protein change format' };
}

// Splits a ClinVar title like "NM_007294.4(BRCA1):c.5044G>A (p.Glu1682Lys)" into gene + protein part.
// The gene in the title decides which protein the numbering belongs to (overlapping genes exist).
export function parseClinvarTitle(title) {
  const gene = String(title).match(/\(([A-Za-z0-9-]+)\):/)?.[1] ?? null;
  const protein = String(title).match(/\((p\.[^)]+)\)\s*$/)?.[1] ?? null;
  return { gene, protein };
}

// Maps ClinVar's germline description to our six classes; null means "not usable" (not plotted).
export function normalizeClassification(description) {
  const text = String(description ?? '')
    .trim()
    .toLowerCase();
  if (text.startsWith('conflicting')) return 'Conflicting';
  if (text === 'uncertain significance') return 'VUS';
  // "Pathogenic; drug response" -> look only at the part before the semicolon.
  const head = text.split(';')[0].trim();
  // Combined labels use the stronger/first term, e.g. "Pathogenic/Likely pathogenic" -> Pathogenic.
  if (head.startsWith('pathogenic')) return 'Pathogenic';
  if (head.startsWith('likely pathogenic')) return 'Likely pathogenic';
  if (head.startsWith('benign')) return 'Benign';
  if (head.startsWith('likely benign')) return 'Likely benign';
  return null;
}

// Converts ClinVar's SPDI ("NC_000017.11:43067637:C:T", 0-based) into gnomAD's "17-43067638-C-T".
// Only single-base changes are supported; anything else returns null.
export function spdiToVariantId(spdi) {
  const m = String(spdi ?? '').match(/^NC_0000(\d\d)\.\d+:(\d+):([ACGT]):([ACGT])$/);
  if (!m) return null;
  const chromosome = { 23: 'X', 24: 'Y' }[Number(m[1])] ?? String(Number(m[1]));
  return `${chromosome}-${Number(m[2]) + 1}-${m[3]}-${m[4]}`;
}

// Builds the "R175H" style key used to compare protein changes across sources.
export function proteinKey(refAA, position, altAA) {
  return `${refAA}${position}${altAA}`;
}
