// Web end-to-end tests for partial states (blocked sources), slow networks, mobile and dark mode.
import { expect, test } from '@playwright/test';
import { PANELS, panelState, search, waitSettled, watchErrors } from './helpers.js';

const HOSTS = {
  gnomad: /gnomad\.broadinstitute\.org/,
  clinvar: /eutils\.ncbi\.nlm\.nih\.gov/,
  alphafold: /alphafold\.ebi\.ac\.uk/,
  uniprot: /rest\.uniprot\.org/,
};
const BROWSER_BLOCK_MESSAGE = "This data source can't be reached from the browser";

test.describe('partial states', () => {
  test('gnomAD blocked: ClinVar and structure still show, rarity is "unknown", warning is visible', async ({
    page,
  }) => {
    const record = watchErrors(page, ['gnomad']);
    await page.route(HOSTS.gnomad, (route) => route.abort());
    await page.goto('/');
    await search(page, 'TP53');
    const states = await waitSettled(page);
    expect(states).toMatchObject({
      stats: 'ready',
      viewer: 'ready',
      meaning: 'ready',
      plot: 'ready',
      table: 'ready',
      constraint: 'error',
    });
    await expect(page.locator('#banners')).toContainText('gnomAD could not be loaded');
    await expect(page.locator('#banners')).toContainText(BROWSER_BLOCK_MESSAGE);
    const badges = await page.$$eval('#table tbody tr .badge', (els) =>
      els.map((e) => e.textContent),
    );
    expect(badges.length).toBeGreaterThan(0);
    expect(
      badges.every((b) => b === 'unknown'),
      'a failed gnomAD query is never shown as "absent"',
    ).toBe(true);
    await expect(page.locator('#stat-cards')).toContainText('not available');
    await expect(
      page.locator('[data-panel=constraint] .panel-message button', { hasText: 'Retry' }),
    ).toBeVisible();
    expect(record.errors).toEqual([]);
  });

  test('ClinVar blocked: variant panels show errors with Retry, structure stays, Retry recovers', async ({
    page,
  }) => {
    const record = watchErrors(page, ['eutils']);
    await page.route(HOSTS.clinvar, (route) => route.abort());
    await page.goto('/');
    await search(page, 'TP53');
    const states = await waitSettled(page);
    expect(states).toMatchObject({
      stats: 'error',
      meaning: 'error',
      plot: 'error',
      table: 'error',
      viewer: 'ready',
      constraint: 'ready',
    });
    await expect(page.locator('[data-panel=table] .panel-message')).toContainText(
      'ClinVar variants could not be loaded',
    );
    await page.unroute(HOSTS.clinvar);
    await page.locator('[data-panel=table] .panel-message button', { hasText: 'Retry' }).click();
    const after = await waitSettled(page);
    for (const name of PANELS) expect(after[name], name).toBe('ready');
    expect(record.errors).toEqual([]);
  });

  test('AlphaFold blocked: 3D panel shows an error, plot and table still work without pLDDT', async ({
    page,
  }) => {
    const record = watchErrors(page, ['alphafold']);
    await page.route(HOSTS.alphafold, (route) => route.abort());
    await page.goto('/');
    await search(page, 'TP53');
    const states = await waitSettled(page);
    expect(states).toMatchObject({
      viewer: 'error',
      plot: 'ready',
      table: 'ready',
      stats: 'ready',
    });
    await expect(page.locator('[data-panel=viewer] .panel-message')).toContainText(
      'AlphaFold structure could not be loaded',
    );
    const plddt = await page.$$eval('#table tbody tr td:nth-child(5)', (els) =>
      els.slice(0, 5).map((e) => e.textContent),
    );
    expect(
      plddt.every((t) => t === 'not available'),
      'missing pLDDT is shown as "not available", never invented',
    ).toBe(true);
    expect(record.errors).toEqual([]);
  });

  test('UniProt blocked: friendly error with Retry, and Retry works once unblocked', async ({
    page,
  }) => {
    const record = watchErrors(page, ['uniprot']);
    await page.route(HOSTS.uniprot, (route) => route.abort());
    await page.goto('/');
    await search(page, 'TP53');
    await expect(page.locator('#banners .banner-error')).toContainText(BROWSER_BLOCK_MESSAGE);
    await expect(page.locator('#results')).toBeHidden();
    await page.unroute(HOSTS.uniprot);
    await page.locator('#banners button', { hasText: 'Retry' }).click();
    const states = await waitSettled(page);
    expect(states.table).toBe('ready');
    expect(record.errors).toEqual([]);
  });

  test('slow network: skeleton shimmer and ClinVar progress show while loading, then everything appears', async ({
    page,
  }) => {
    const record = watchErrors(page);
    for (const host of [HOSTS.alphafold, HOSTS.gnomad]) {
      await page.route(host, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await route.continue();
      });
    }
    await page.goto('/');
    await search(page, 'TP53');
    await expect(page.locator('#banners')).toContainText('Loading TP53');
    expect(await panelState(page, 'viewer')).toBe('loading');
    await expect(page.locator('[data-panel=viewer] .panel-skeleton')).toBeVisible();
    await expect(page.locator('[data-panel=table] .panel-skeleton')).toBeVisible();
    await expect(page.locator('#banners')).toContainText(/Loading ClinVar: [\d,]+ \/ [\d,]+/, {
      timeout: 60_000,
    });
    const states = await waitSettled(page);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    expect(record.errors).toEqual([]);
  });
});

test.describe('mobile and dark mode', () => {
  test('mobile 390x844: no horizontal scroll, 3D viewer comes before the summary, everything works', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const record = watchErrors(page);
    await page.goto('/');
    await search(page, 'TP53');
    const states = await waitSettled(page);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    const layout = await page.evaluate(() => ({
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      viewerTop: document.querySelector('#viewer-panel').getBoundingClientRect().top,
      statsTop: document.querySelector('#stats-panel').getBoundingClientRect().top,
      plotTop: document.querySelector('#plot-panel').getBoundingClientRect().top,
    }));
    expect(layout.inner).toBe(390);
    expect(layout.scroll, 'no horizontal page scroll').toBeLessThanOrEqual(layout.inner);
    expect(layout.viewerTop, '3D viewer first').toBeLessThan(layout.statsTop);
    expect(layout.statsTop).toBeLessThan(layout.plotTop);
    await page.locator('#table tbody tr').first().scrollIntoViewIfNeeded();
    await page.locator('#table tbody tr').first().click();
    await expect(page.locator('#selected')).not.toContainText('Click a variant');
    expect(record.errors).toEqual([]);
    await context.close();
  });

  test('dark mode follows the system, can be toggled, and the choice is remembered', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: 'dark',
      viewport: { width: 1200, height: 900 },
    });
    const page = await context.newPage();
    const record = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(light).not.toBe(dark);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // remembered, not the system's dark
    expect(record.errors).toEqual([]);
    await context.close();
  });

  test('works when storage is blocked (private mode): the page still renders and searches', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    const page = await context.newPage();
    const record = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('#welcome')).toBeVisible();
    await page.locator('#theme-toggle').click();
    await search(page, 'NOTAGENE');
    await expect(page.locator('#banners .banner-error')).toContainText('was not found');
    expect(record.errors).toEqual([]);
    await context.close();
  });
});
