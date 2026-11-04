// Tests for the "out of date" rule and gene tags.
import { describe, expect, it } from 'vitest';
import { OUT_OF_DATE_MS, groupFor, isOutOfDate } from '../../src/core/freshness.js';

describe('isOutOfDate', () => {
  const now = 1_000_000_000_000;
  it('is 7 days', () => {
    expect(OUT_OF_DATE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it('treats exactly 7 days as still current and anything older as out of date', () => {
    expect(isOutOfDate(now - OUT_OF_DATE_MS, now)).toBe(false);
    expect(isOutOfDate(now - OUT_OF_DATE_MS - 1, now)).toBe(true);
    expect(isOutOfDate(now, now)).toBe(false);
  });
});

describe('groupFor', () => {
  it('uppercases valid symbols', () => {
    expect(groupFor('tp53')).toBe('TP53');
    expect(groupFor('HLA-A')).toBe('HLA-A');
  });
  it('rejects anything that is not safe for storage keys and file names', () => {
    for (const bad of ['', 'a b', 'a:b', 'a/b', '../x', 'X'.repeat(21), null, undefined, 5]) {
      expect(groupFor(bad), String(bad)).toBeNull();
    }
  });
});
