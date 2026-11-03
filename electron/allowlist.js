// Hostnames the app may talk to. Shared by the main process (enforcement) and Vite (web CSP).

// Public data APIs the main process is allowed to fetch from (https only, standard port).
export const API_HOSTS = Object.freeze([
  'rest.uniprot.org',
  'alphafold.ebi.ac.uk',
  'eutils.ncbi.nlm.nih.gov',
  'gnomad.broadinstitute.org',
]);

// Websites that may be opened in the user's system browser (never inside the app).
export const LINK_HOSTS = Object.freeze([
  ...API_HOSTS,
  'www.uniprot.org',
  'www.ncbi.nlm.nih.gov',
  'github.com',
]);

// Parses a URL string and returns it only if it is plain https with no credentials/odd port.
function parseHttps(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  return url;
}

// Decides if the main process may fetch this URL; returns {ok, url} or {ok:false, error}.
export function checkApiUrl(raw) {
  const url = parseHttps(raw);
  if (!url) return { ok: false, error: 'Blocked: only plain https URLs are allowed.' };
  if (!API_HOSTS.includes(url.hostname)) {
    return { ok: false, error: `Blocked: host "${url.hostname}" is not on the allowlist.` };
  }
  return { ok: true, url };
}

// Decides if a link may be opened in the system browser (https + allowlisted host).
export function isAllowedExternalLink(raw) {
  const url = parseHttps(raw);
  return Boolean(url && LINK_HOSTS.includes(url.hostname));
}
