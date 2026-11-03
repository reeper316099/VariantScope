// Accessibility: every text/background pair in the design tokens must reach WCAG AA (4.5:1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(import.meta.dirname, '../../src/styles/tokens.css'), 'utf8');
const components = readFileSync(
  path.join(import.meta.dirname, '../../src/styles/components.css'),
  'utf8',
);

// Reads the "--name: #hex" declarations inside one rule block of tokens.css.
function tokens(selector) {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
  );
}
const light = tokens(':root');
const dark = { ...light, ...tokens("[data-theme='dark']") };

// WCAG relative luminance of a "#rrggbb" colour.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// WCAG contrast ratio between two colours.
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text colour on background colour pairs actually used by the UI (names are token names).
const PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-2'],
  ['accent-ui', 'bg'],
  ['accent-ui', 'surface'],
  ['accent-ui', 'surface-2'],
  ['pill-pathogenic-text', 'pill-pathogenic-bg'],
  ['pill-benign-text', 'pill-benign-bg'],
  ['pill-uncertain-text', 'pill-uncertain-bg'],
  ['banner-warn-text', 'banner-warn-bg'],
  ['banner-error-text', 'banner-error-bg'],
  ['text', 'banner-info-bg'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_name, t) => {
  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(t[fg], t[bg]), `${fg} ${t[fg]} on ${bg} ${t[bg]}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('header gradient', () => {
  it('white text stays readable along the whole navy-to-teal gradient', () => {
    const colours = [
      ...components.match(/linear-gradient\(([^)]*)\)/)[1].matchAll(/#[0-9a-fA-F]{6}/g),
    ].map((m) => m[0]);
    expect(colours.length).toBeGreaterThanOrEqual(2);
    for (const colour of colours)
      expect(contrast('#ffffff', colour), colour).toBeGreaterThanOrEqual(4.5);
  });
});

describe('active chips', () => {
  it('white on the light accent and dark text on the dark accent both pass', () => {
    expect(contrast('#ffffff', light['accent-ui'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#06202a', dark['accent-ui'])).toBeGreaterThanOrEqual(4.5);
  });
});
