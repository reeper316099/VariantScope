// How old saved data may get before the app labels it "out of date". Saved data is never deleted
// because of its age: the label just tells the person a Refresh would download newer data.
export const OUT_OF_DATE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// True if data fetched at `fetchedAt` (ms since 1970) is older than OUT_OF_DATE_MS.
export function isOutOfDate(fetchedAt, now = Date.now()) {
  return now - fetchedAt > OUT_OF_DATE_MS;
}

// Turns a gene symbol into the tag that groups its saved files ("tp53" -> "TP53"), or null if the
// text is not a valid symbol (so only safe names are ever used in storage keys and file names).
export function groupFor(symbol) {
  if (typeof symbol !== 'string') return null;
  const tag = symbol.toUpperCase();
  return /^[A-Z0-9-]{1,20}$/.test(tag) ? tag : null;
}
