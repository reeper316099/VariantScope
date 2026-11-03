// Table logic (filter, sort, paginate) kept separate from the DOM so it can be unit tested.
import { RARITY_LABELS } from './stats.js';

export const CLASSIFICATIONS = [
  'Pathogenic',
  'Likely pathogenic',
  'Conflicting',
  'VUS',
  'Likely benign',
  'Benign',
];
export const PAGE_SIZE = 50;

// Rank of ClinVar review status (more stars = more trustworthy). Unknown statuses rank 0.
const REVIEW_RANK = {
  'practice guideline': 4,
  'reviewed by expert panel': 3,
  'criteria provided, multiple submitters, no conflicts': 2,
  'criteria provided, single submitter': 1,
  'criteria provided, conflicting classifications': 1,
};
export const reviewRank = (status) => REVIEW_RANK[status] ?? 0;

// Keeps variants that match the text box, the selected chips and the numbering toggle.
export function filterVariants(variants, { text = '', classes, rarities, onlyNumberingOk = true }) {
  const needle = text.trim().toLowerCase();
  return variants.filter((v) => {
    if (onlyNumberingOk && !v.numberingOk) return false;
    if (classes?.size && !classes.has(v.classification)) return false;
    if (rarities?.size && !rarities.has(v.rarity)) return false;
    if (!needle) return true;
    return [v.proteinChange, v.classification, v.clinvarLabel, v.reviewStatus, v.rarity]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

// Compares two values; null/undefined always sort last regardless of direction.
function compare(a, b, direction) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const result = typeof a === 'string' ? a.localeCompare(b) : a - b;
  return direction === 'asc' ? result : -result;
}

const SORT_KEYS = {
  change: (v) => v.position * 100 + v.altAA.charCodeAt(0) / 100,
  classification: (v) => CLASSIFICATIONS.indexOf(v.classification),
  review: (v) => reviewRank(v.reviewStatus),
  af: (v) => v.gnomad.af,
  rarity: (v) => RARITY_LABELS.indexOf(v.rarity),
  plddt: (v) => v.plddt,
  matchedBy: (v) => v.gnomad.matchedBy,
};
export const SORTABLE_COLUMNS = Object.keys(SORT_KEYS);

// Returns a sorted copy; `key` is one of SORTABLE_COLUMNS and direction is "asc" or "desc".
export function sortVariants(variants, key, direction = 'asc') {
  const valueOf = SORT_KEYS[key];
  return [...variants].sort(
    (a, b) => compare(valueOf(a), valueOf(b), direction) || a.position - b.position,
  );
}

// Returns {rows, page, pageCount, total} for a 1-based page number (clamped to a valid page).
export function paginate(list, page, size = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  return {
    rows: list.slice((current - 1) * size, current * size),
    page: current,
    pageCount,
    total: list.length,
  };
}

// Finds which page holds a variant (so selecting it elsewhere can scroll the table to it); 0 if absent.
export function pageOfVariant(list, clinvarId, size = PAGE_SIZE) {
  const index = list.findIndex((v) => v.clinvarId === clinvarId);
  return index === -1 ? 0 : Math.floor(index / size) + 1;
}
