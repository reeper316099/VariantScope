// Colours and shapes shared by the 3D viewer, the plot, the table and the legends.

// AlphaFold's standard pLDDT confidence colours.
export const PLDDT_BANDS = [
  { id: 'very-high', label: 'Very high (> 90)', color: '#0053D6' },
  { id: 'confident', label: 'Confident (70 to 90)', color: '#65CBF3' },
  { id: 'low', label: 'Low (50 to 70)', color: '#FFDB13' },
  { id: 'very-low', label: 'Very low (< 50)', color: '#FF7D45' },
];
export const NO_PLDDT_COLOR = '#9CA3AF';

// Returns the pLDDT band for a score (null if there is no score).
export function plddtBand(score) {
  if (score === null || score === undefined) return null;
  if (score > 90) return PLDDT_BANDS[0];
  if (score >= 70) return PLDDT_BANDS[1];
  if (score >= 50) return PLDDT_BANDS[2];
  return PLDDT_BANDS[3];
}

// Returns the standard AlphaFold colour for a pLDDT score.
export function plddtColor(score) {
  return plddtBand(score)?.color ?? NO_PLDDT_COLOR;
}

// Variant groups: colour AND shape/glyph differ so colour is never the only signal.
export const CLASS_STYLE = {
  Pathogenic: { group: 'pathogenic', color: '#FF6B6B', glyph: '●', pointStyle: 'circle' },
  'Likely pathogenic': {
    group: 'pathogenic',
    color: '#FF6B6B',
    glyph: '▲',
    pointStyle: 'triangle',
  },
  Conflicting: { group: 'uncertain', color: '#94A3B8', glyph: '◆', pointStyle: 'rectRot' },
  VUS: { group: 'uncertain', color: '#94A3B8', glyph: '■', pointStyle: 'rect' },
  'Likely benign': { group: 'benign', color: '#22C55E', glyph: '▲', pointStyle: 'triangle' },
  Benign: { group: 'benign', color: '#22C55E', glyph: '●', pointStyle: 'circle' },
};

// Sequential palette (light to dark) for pathogenic-variant density.
const DENSITY_STOPS = ['#FFFFCC', '#FED976', '#FD8D3C', '#E31A1C', '#800026'];

// Maps a 0..1 density value onto the sequential palette (linear interpolation between stops).
export function densityColor(t) {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (DENSITY_STOPS.length - 1);
  const i = Math.min(DENSITY_STOPS.length - 2, Math.floor(scaled));
  return mix(DENSITY_STOPS[i], DENSITY_STOPS[i + 1], scaled - i);
}

// Blends two "#RRGGBB" colours; amount 0 gives `a`, 1 gives `b`.
function mix(a, b, amount) {
  const channel = (hex, k) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  const part = (k) => Math.round(channel(a, k) + (channel(b, k) - channel(a, k)) * amount);
  return `#${[0, 1, 2].map((k) => part(k).toString(16).padStart(2, '0')).join('')}`;
}

// Reads a CSS custom property (e.g. "--text") from the page, so canvases follow the theme.
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
