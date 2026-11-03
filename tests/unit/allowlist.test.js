// Tests for the main-process URL allowlist (the security gate for every API request).
import { describe, expect, it } from 'vitest';
import { checkApiUrl, isAllowedExternalLink } from '../../electron/allowlist.js';

describe('checkApiUrl', () => {
  it('accepts the four API hosts over https', () => {
    for (const host of [
      'rest.uniprot.org',
      'alphafold.ebi.ac.uk',
      'eutils.ncbi.nlm.nih.gov',
      'gnomad.broadinstitute.org',
    ]) {
      expect(checkApiUrl(`https://${host}/x?y=1`).ok).toBe(true);
    }
  });

  it('rejects http, other hosts, look-alike hosts, credentials and odd ports', () => {
    const bad = [
      'http://rest.uniprot.org/x',
      'https://example.com/',
      'https://rest.uniprot.org.evil.com/',
      'https://evil.com/rest.uniprot.org',
      'https://user:pw@rest.uniprot.org/',
      'https://rest.uniprot.org:8443/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
      42,
    ];
    for (const url of bad) expect(checkApiUrl(url).ok, String(url)).toBe(false);
  });
});

describe('isAllowedExternalLink', () => {
  it('allows https links to known sites only', () => {
    expect(isAllowedExternalLink('https://github.com/reeper316099/VariantScope')).toBe(true);
    expect(isAllowedExternalLink('https://www.uniprot.org/uniprotkb/P38398')).toBe(true);
    expect(isAllowedExternalLink('http://github.com/')).toBe(false);
    expect(isAllowedExternalLink('https://evil.com/')).toBe(false);
    expect(isAllowedExternalLink('mailto:a@b.c')).toBe(false);
  });
});
