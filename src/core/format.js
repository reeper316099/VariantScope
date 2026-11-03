// Display formatting helpers (numbers, percentages, dates). Pure functions.

export const NOT_AVAILABLE = 'not available';

// Formats an allele frequency in scientific notation, e.g. "4.34e-6".
export function formatAf(af) {
  return af === null || af === undefined ? NOT_AVAILABLE : af === 0 ? '0' : af.toExponential(2);
}

// Formats a {pct} share (from stats.summarize) as "17.7%", or "not available" when pct is null.
export function formatPct(share) {
  return share.pct === null ? NOT_AVAILABLE : `${share.pct.toFixed(1)}%`;
}

// Formats an integer with thousands separators ("1,500").
export function formatCount(n) {
  return n.toLocaleString('en-US');
}

// Formats a score with a fixed number of significant digits; very small values use exponents.
export function formatScore(value, digits = 3) {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return Number(value.toPrecision(digits)).toString();
}

// Describes how old a timestamp is: "today", "1 day ago", "5 days ago".
export function formatAge(fetchedAt, now = Date.now()) {
  const days = Math.floor((now - fetchedAt) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// Formats a timestamp as a readable local date and time.
export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
