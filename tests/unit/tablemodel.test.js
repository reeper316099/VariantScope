// Tests for table filtering, sorting and pagination.
import { describe, expect, it } from 'vitest';
import {
  filterVariants,
  pageOfVariant,
  paginate,
  sortVariants,
} from '../../src/core/tableModel.js';

// Builds a minimal unified variant.
const v = (id, position, classification, over = {}) => ({
  clinvarId: String(id),
  proteinChange: `p.Ala${position}Gly`,
  position,
  altAA: 'G',
  classification,
  clinvarLabel: classification,
  reviewStatus: 'criteria provided, single submitter',
  rarity: 'absent',
  plddt: 80,
  numberingOk: true,
  gnomad: { af: null, matchedBy: null },
  ...over,
});
const list = [
  v(1, 30, 'Benign', {
    rarity: 'common',
    gnomad: { af: 0.2, matchedBy: 'coordinates' },
    plddt: null,
  }),
  v(2, 10, 'Pathogenic', { gnomad: { af: 1e-6, matchedBy: 'coordinates' }, plddt: 95 }),
  v(3, 20, 'VUS', { numberingOk: false, reviewStatus: 'reviewed by expert panel' }),
];

describe('filterVariants', () => {
  it('hides numbering mismatches by default and shows them when the toggle is off', () => {
    expect(filterVariants(list, {}).map((x) => x.clinvarId)).toEqual(['1', '2']);
    expect(filterVariants(list, { onlyNumberingOk: false })).toHaveLength(3);
  });
  it('filters by classification and rarity chips', () => {
    expect(filterVariants(list, { classes: new Set(['Pathogenic']) })).toHaveLength(1);
    expect(filterVariants(list, { rarities: new Set(['common']) })[0].clinvarId).toBe('1');
  });
  it('filters by text across change, class and review status (case-insensitive)', () => {
    expect(filterVariants(list, { text: 'ALA10', onlyNumberingOk: false })[0].clinvarId).toBe('2');
    expect(
      filterVariants(list, { text: 'expert panel', onlyNumberingOk: false })[0].clinvarId,
    ).toBe('3');
  });
});

describe('sortVariants', () => {
  it('sorts by position order of the change, ascending and descending', () => {
    expect(sortVariants(list, 'change', 'asc').map((x) => x.position)).toEqual([10, 20, 30]);
    expect(sortVariants(list, 'change', 'desc').map((x) => x.position)).toEqual([30, 20, 10]);
  });
  it('sorts classification by severity order', () => {
    expect(sortVariants(list, 'classification').map((x) => x.classification)).toEqual([
      'Pathogenic',
      'VUS',
      'Benign',
    ]);
  });
  it('puts missing values last in both directions', () => {
    expect(sortVariants(list, 'plddt', 'asc').at(-1).plddt).toBeNull();
    expect(sortVariants(list, 'plddt', 'desc').at(-1).plddt).toBeNull();
    expect(sortVariants(list, 'af', 'asc')[0].gnomad.af).toBe(1e-6);
    expect(sortVariants(list, 'af', 'desc')[0].gnomad.af).toBe(0.2);
  });
  it('does not mutate its input', () => {
    const copy = [...list];
    sortVariants(list, 'plddt', 'desc');
    expect(list).toEqual(copy);
  });
});

describe('paginate / pageOfVariant', () => {
  const many = Array.from({ length: 120 }, (_, i) => v(i + 1, i + 1, 'VUS'));
  it('slices pages and clamps out-of-range page numbers', () => {
    expect(paginate(many, 1, 50)).toMatchObject({ page: 1, pageCount: 3, total: 120 });
    expect(paginate(many, 3, 50).rows).toHaveLength(20);
    expect(paginate(many, 99, 50).page).toBe(3);
    expect(paginate(many, 0, 50).page).toBe(1);
    expect(paginate([], 1, 50)).toMatchObject({ rows: [], pageCount: 1 });
  });
  it('finds the page that holds a variant', () => {
    expect(pageOfVariant(many, '1', 50)).toBe(1);
    expect(pageOfVariant(many, '51', 50)).toBe(2);
    expect(pageOfVariant(many, '120', 50)).toBe(3);
    expect(pageOfVariant(many, 'nope', 50)).toBe(0);
  });
});
