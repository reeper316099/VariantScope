// Saves README screenshots (desktop light, desktop dark, mobile) for BRCA1 and TP53 into
// docs/screenshots. Each gene has a well-known hotspot variant selected so the 3D view, plot and
// table all show the selection.
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadGene, selectInTable } from './helpers.js';

const OUT = path.join(import.meta.dirname, '..', '..', 'docs', 'screenshots');
const GENES = { BRCA1: 'p.Arg1699Trp', TP53: 'p.Arg175His' };

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const [gene, hotspot] of Object.entries(GENES)) {
  test(`${gene}: desktop light + dark screenshots`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.goto('/');
    await loadGene(page, gene);
    await selectInTable(page, hotspot);
    await page.fill('#table input[type=search]', '');
    await page.waitForTimeout(1500); // let the camera finish zooming
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(OUT, `${gene}-desktop-light.png`), fullPage: true });
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${gene}-desktop-dark.png`), fullPage: true });
    await context.close();
  });

  test(`${gene}: mobile screenshot (390x844)`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto('/');
    await loadGene(page, gene);
    await selectInTable(page, hotspot);
    await page.fill('#table input[type=search]', '');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `${gene}-mobile.png`), fullPage: true });
    await context.close();
  });
}
