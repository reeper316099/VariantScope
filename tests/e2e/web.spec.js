// Web end-to-end tests: real browser, real public APIs, the production build with its strict CSP.
import { expect, test } from '@playwright/test';
import {
  PANELS,
  canvasInk,
  loadGene,
  panelState,
  plddtBandShares,
  search,
  selectInTable,
  waitSettled,
  watchErrors,
} from './helpers.js';

// Three well-known pathogenic missense variants per gene: [table text, expected residue number,
// expected residue name in the 3D model]. Expected values come from the variant names themselves.
const GENES = {
  BRCA1: [
    ['p.Cys61Gly', 61, 'CYS'],
    ['p.Arg1699Trp', 1699, 'ARG'],
    ['p.Met1775Arg', 1775, 'MET'],
  ],
  TP53: [
    ['p.Arg175His', 175, 'ARG'],
    ['p.Arg248Gln', 248, 'ARG'],
    ['p.Arg273His', 273, 'ARG'],
  ],
  CFTR: [
    ['p.Gly551Asp', 551, 'GLY'],
    ['p.Arg117His', 117, 'ARG'],
    ['p.Asn1303Lys', 1303, 'ASN'],
  ],
  MLH1: [
    ['p.Gly67Arg', 67, 'GLY'],
    ['p.Leu622His', 622, 'LEU'],
    ['p.Ala681Thr', 681, 'ALA'],
  ],
};

// Waits for the 3D camera animation after a selection to finish.
const settle3d = (page) => page.waitForTimeout(1200);

for (const [gene, known] of Object.entries(GENES)) {
  test.describe.serial(`${gene}`, () => {
    let context;
    let page;
    let record;

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      page = await context.newPage();
      record = watchErrors(page);
      await page.goto('/');
      await loadGene(page, gene);
    });
    test.afterAll(async () => {
      await context.close();
    });

    test('renders without console errors so far', async () => {
      expect(record.errors).toEqual([]);
    });

    test('the 3D view loads and is coloured by pLDDT', async () => {
      await expect(page.locator('#viewer canvas')).toBeVisible();
      const shares = await plddtBandShares(page);
      const present = Object.entries(shares).filter(([, share]) => share > 0.01);
      console.log(
        `[${gene}] pLDDT band shares in 3D view:`,
        JSON.stringify(
          Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, +v.toFixed(3)])),
        ),
      );
      expect(present.length, 'at least two pLDDT colour bands visible').toBeGreaterThanOrEqual(2);
      expect(
        Object.values(shares).reduce((a, b) => a + b, 0),
        'most coloured pixels are pLDDT colours',
      ).toBeGreaterThan(0.3);
    });

    test('plot and table render', async () => {
      expect(await canvasInk(page, '#plot')).toBeGreaterThan(5_000);
      await expect(page.locator('#table tbody tr')).toHaveCount(50);
      await expect(page.locator('#table .pager')).toContainText('Showing 1');
      await expect(page.locator('#stat-cards .stat-card')).toHaveCount(5);
      await expect(page.locator('#constraint')).toContainText('pLI');
      await expect(page.locator('#meaning li').first()).toContainText(
        'missense variants were analysed',
      );
    });

    for (const [change, position, residue] of known) {
      test(`${change} lands on residue ${position}`, async () => {
        await selectInTable(page, change);
        await settle3d(page);
        const observed = await page.locator('#viewer').getAttribute('data-selected-residue');
        console.log(
          `[${gene}] variant ${change}: expected residue ${residue}${position}, observed residue ${observed}`,
        );
        expect(observed).toBe(`${residue}${position}`);
        await expect(page.locator('#selected')).toContainText(change);
        // The viewer's own label and the lollipop ring both refer to this same variant.
        const id = await page.locator('#table tr.selected').getAttribute('data-id');
        expect(await page.locator('#plot').getAttribute('data-selected-id')).toBe(id);
      });
    }

    test('selection sync: plot -> table + 3D, and 3D -> table + plot', async () => {
      const ids = await page.evaluate(
        (changes) =>
          changes.map(
            (c) => window.__vsTest.result.variants.find((v) => v.proteinChange === c)?.clinvarId,
          ),
        known.map(([c]) => c),
      );
      expect(ids.every(Boolean)).toBe(true);
      // Which variant a view selected (position + id), read from the table's selected row.
      const selected = () =>
        page.evaluate(() => {
          const id = document.querySelector('#table tr.selected')?.dataset.id;
          const v = window.__vsTest.result.variants.find((x) => x.clinvarId === id);
          return v ? { id, position: v.position } : null;
        });

      // 1) Click the lollipop of the second variant. Variants at the same residue and height
      //    overlap, so the check is on the residue, not on one particular id.
      await page.fill('#table input[type=search]', '');
      await page.locator('#plot').scrollIntoViewIfNeeded();
      const spot = await page.evaluate((id) => window.__vsTest.plot.pointPixel(id), ids[1]);
      // Element-relative click: Playwright scrolls the canvas into view itself and fails with a clear
      // message if something covers the target, unlike a click at absolute screen coordinates.
      await page.locator('#plot').click({ position: { x: spot.x, y: spot.y } });
      await settle3d(page);
      expect((await selected()).position).toBe(known[1][1]);
      expect(await page.locator('#viewer').getAttribute('data-selected-residue')).toBe(
        `${known[1][2]}${known[1][1]}`,
      );
      expect(await page.locator('#plot').getAttribute('data-selected-id')).toBe(
        (await selected()).id,
      );

      // 2) Click a sphere in the 3D view. First zoom the camera to the third variant (so it is on
      //    screen), then clear the highlight, so the click is what causes the selection.
      await selectInTable(page, known[2][0]);
      await settle3d(page);
      await page.evaluate(() => window.__vsTest.viewer.select(null));
      expect(await page.locator('#viewer').getAttribute('data-selected-residue')).toBe('');
      await page.locator('#viewer').scrollIntoViewIfNeeded();
      const sphere = await page.evaluate(
        (position) => window.__vsTest.viewer.screenPoint(position),
        known[2][1],
      );
      await page.locator('#viewer').hover({ position: { x: sphere.x, y: sphere.y } });
      await expect(page.locator('.viewer-tooltip')).toBeVisible();
      // Another sphere can sit in front of the target, and picking returns the nearest one. So the
      // check is that hover, click and the other views all agree on the residue that was picked.
      const hovered = (await page.locator('.viewer-tooltip').textContent()).match(
        /^([A-Z]{3}) (\d+)/,
      );
      expect(hovered, 'the tooltip names a residue').not.toBeNull();
      const [, hoveredName, hoveredNumber] = hovered;
      await page.locator('#viewer').click({ position: { x: sphere.x, y: sphere.y } });
      await expect
        .poll(() => page.locator('#viewer').getAttribute('data-selected-residue'))
        .toBe(`${hoveredName}${hoveredNumber}`);
      const picked = await selected();
      expect(picked.position).toBe(Number(hoveredNumber));
      await expect(page.locator('#plot')).toHaveAttribute('data-selected-id', picked.id);
      await expect(page.locator('#selected')).toContainText(
        `${hoveredName[0]}${hoveredName.slice(1).toLowerCase()}${hoveredNumber}`,
      );
    });

    test('no console errors or unhandled rejections during the whole session', async () => {
      console.log(
        `[${gene}] NCBI transient failures seen (recovered by retry): ${record.ncbiNoise.length}`,
      );
      expect(record.errors).toEqual([]);
    });
  });
}

// Share of the confident (blue) pLDDT bands among coloured pixels.
const blue0 = (shares) => shares['very-high'] + shares.confident;

test.describe.serial('TP53 controls', () => {
  let context;
  let page;
  let record;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
      acceptDownloads: true,
    });
    page = await context.newPage();
    record = watchErrors(page);
    await page.goto('/');
    await loadGene(page, 'TP53');
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('sorting by gnomAD AF works in both directions (missing values last)', async () => {
    const af = async () =>
      (
        await page.$$eval('#table tbody tr td:nth-child(4) span:first-child', (els) =>
          els.map((e) => e.textContent),
        )
      ).map((t) => (t === 'not available' ? null : Number(t)));
    await page.getByRole('button', { name: /^gnomAD AF/ }).click();
    const asc = await af();
    const numbers = asc.filter((v) => v !== null);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(asc.indexOf(null) === -1 || asc.slice(asc.indexOf(null)).every((v) => v === null)).toBe(
      true,
    );
    await page.getByRole('button', { name: /^gnomAD AF/ }).click();
    const desc = (await af()).filter((v) => v !== null);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    await expect(page.locator('#table th[aria-sort=descending]')).toHaveCount(1);
  });

  test('classification and rarity chips, and the text filter, narrow the table', async () => {
    await page.locator('#table .chip', { hasText: /^● Pathogenic$/ }).click();
    const classes = await page.$$eval('#table tbody tr td:nth-child(2)', (els) =>
      els.map((e) => e.textContent),
    );
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.every((c) => c.includes('Pathogenic') && !c.includes('Likely'))).toBe(true);
    await page.locator('#table .chip', { hasText: /^absent$/ }).click();
    const badges = await page.$$eval('#table tbody tr .badge', (els) =>
      els.map((e) => e.textContent),
    );
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((b) => b === 'absent')).toBe(true);
    await page.locator('#table .chip[aria-pressed=true]').first().click();
    await page.locator('#table .chip[aria-pressed=true]').first().click();
    await page.fill('#table input[type=search]', 'Arg175His');
    await expect(page.locator('#table tbody tr')).toHaveCount(1);
    await page.fill('#table input[type=search]', '');
  });

  test('"Only numbering OK" hides numbering mismatches and shows them when turned off', async () => {
    // None of the real variants mismatch, so one is added through the test hook.
    await page.evaluate(() => {
      const base = window.__vsTest.result.variants;
      window.__vsTest.table.update([
        ...base,
        { ...base[0], clinvarId: 'mismatch-1', proteinChange: 'p.Ala1Gly', numberingOk: false },
      ]);
    });
    await page.fill('#table input[type=search]', 'p.Ala1Gly');
    await expect(page.locator('#table tbody tr')).toHaveCount(0);
    await page.locator('#table .toggle input').uncheck();
    await expect(page.locator('#table tbody tr')).toHaveCount(1);
    await expect(page.locator('#table tbody tr').first()).toContainText('numbering mismatch');
    await page.locator('#table .toggle input').check();
    await page.fill('#table input[type=search]', '');
    await page.evaluate(() => window.__vsTest.table.update(window.__vsTest.result.variants));
  });

  test('pagination moves between pages', async () => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#table .pager')).toContainText('Page 2 of');
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.locator('#table .pager')).toContainText('Page 1 of');
  });

  test('Export CSV downloads the filtered rows with a header and no invented values', async () => {
    await page.locator('#table .chip', { hasText: /^● Pathogenic$/ }).click();
    const expectedRows = await page.evaluate(() =>
      Number(
        document
          .querySelector('#table .pager span')
          .textContent.match(/of ([\d,]+)/)[1]
          .replace(',', ''),
      ),
    );
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('TP53_variants.csv');
    const text = (await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'))
      .trim()
      .split('\n');
    expect(text[0]).toContain('gene,clinvar_id,protein_change,position,classification');
    expect(text.length - 1).toBe(expectedRows);
    expect(text.slice(1).every((line) => line.startsWith('TP53,'))).toBe(true);
    await page.locator('#table .chip[aria-pressed=true]').first().click();
  });

  test('3D controls: colour modes, benign/VUS toggles, spin, reset, fullscreen and Save PNG', async () => {
    await page.locator('#viewer').scrollIntoViewIfNeeded();
    expect(blue0(await plddtBandShares(page)), 'TP53 starts mostly pLDDT blue').toBeGreaterThan(
      0.15,
    );
    await page.selectOption('#color-mode', 'density');
    await expect(page.locator('#density-legend')).toBeVisible();
    await expect(page.locator('#plddt-legend')).toBeHidden();
    const blue = (shares) => shares['very-high'] + shares.confident;
    const density = await plddtBandShares(page);
    expect(blue(density), 'no pLDDT blue in density mode (that palette has no blue)').toBeLessThan(
      0.05,
    );
    await page.selectOption('#color-mode', 'plain');
    await page.selectOption('#color-mode', 'plddt');
    await expect(page.locator('#plddt-legend')).toBeVisible();
    await page.locator('#show-benign').check();
    await page.locator('#show-vus').check();
    await page.locator('#show-benign').uncheck();
    await page.locator('#show-vus').uncheck();

    await page.getByRole('button', { name: 'Spin' }).click();
    await expect(page.getByRole('button', { name: 'Spin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Spin' }).click();
    await expect(page.getByRole('button', { name: 'Spin' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: 'Reset view' }).click();

    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null))
      .toBe('viewer-panel');
    await page.evaluate(() => document.exitFullscreen());

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save PNG' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('TP53_structure.png');
    const bytes = await (await import('node:fs/promises')).readFile(await download.path());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  test('plot: VUS toggle adds lollipops, drag-to-zoom zooms, reset restores', async () => {
    await page.locator('#plot').scrollIntoViewIfNeeded();
    const before = await canvasInk(page, '#plot');
    await page.locator('#plot-vus').check();
    expect(await canvasInk(page, '#plot')).toBeGreaterThan(before);
    await page.locator('#plot-vus').uncheck();

    const id = await page.evaluate(
      () =>
        window.__vsTest.result.variants.find((v) => v.proteinChange === 'p.Arg248Gln').clinvarId,
    );
    const start = await page.evaluate((v) => window.__vsTest.plot.pointPixel(v), id);
    const box = await page.locator('#plot').boundingBox();
    await page.mouse.move(box.x + start.x - 60, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + start.x, box.y + 80, { steps: 5 });
    await page.mouse.move(box.x + start.x + 60, box.y + 80, { steps: 5 });
    await page.mouse.up();
    const zoomed = await page.evaluate((v) => window.__vsTest.plot.pointPixel(v), id);
    expect(
      Math.abs(zoomed.x - start.x),
      'the lollipop moved because the x range changed',
    ).toBeGreaterThan(50);
    await page.getByRole('button', { name: 'Reset zoom' }).click();
    const reset = await page.evaluate((v) => window.__vsTest.plot.pointPixel(v), id);
    expect(Math.abs(reset.x - start.x)).toBeLessThan(2);
  });

  test('About dialog opens with limitations and data versions', async () => {
    await page.getByRole('button', { name: 'About' }).click();
    await expect(page.locator('#about-dialog')).toBeVisible();
    await expect(page.locator('#about-dialog')).toContainText('Educational use only');
    await expect(page.locator('#about-provenance')).toContainText('gnomad_r4');
    await expect(page.locator('#about-provenance')).toContainText('model v');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#about-dialog')).toBeHidden();
  });

  test('keyboard shortcuts: Ctrl+K focuses search, Ctrl+D toggles dark mode', async () => {
    await page.locator('#theme-toggle').focus();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#gene-input')).toBeFocused();
    const before = await page.locator('html').getAttribute('data-theme');
    await page.keyboard.press('Control+d');
    expect(await page.locator('html').getAttribute('data-theme')).not.toBe(before);
    await page.keyboard.press('Control+d');
  });

  test('no console errors during the control tests', async () => {
    expect(record.errors).toEqual([]);
  });
});

test.describe('search validation and unknown genes', () => {
  test('NOTAGENE shows a friendly error with no console errors', async ({ page }) => {
    const record = watchErrors(page);
    await page.goto('/');
    await search(page, 'NOTAGENE');
    await expect(page.locator('#banners .banner-error')).toContainText('"NOTAGENE" was not found');
    await expect(page.locator('#results')).toBeHidden();
    await expect(page.locator('#welcome')).toBeVisible();
    expect(record.errors).toEqual([]);
  });

  test('invalid input is rejected before any request is sent', async ({ page }) => {
    const requests = [];
    page.on(
      'request',
      (request) =>
        /uniprot|ncbi|gnomad|alphafold/.test(request.url()) && requests.push(request.url()),
    );
    await page.goto('/');
    await search(page, 'BRCA1;DROP');
    await expect(page.locator('#search-error')).toContainText('letters, numbers and hyphens');
    await search(page, '   ');
    await expect(page.locator('#search-error')).toContainText('Enter a human gene symbol');
    expect(requests).toEqual([]);
  });

  test('example chips and recent searches work', async ({ page }) => {
    await page.goto('/');
    await page.locator('#example-chips .chip', { hasText: 'MLH1' }).click();
    await expect(page.locator('#gene-input')).toHaveValue('MLH1');
    await expect(page.locator('#recent-searches')).toContainText('MLH1');
    await waitSettled(page);
  });

  test('a new search cancels the previous one (no stale results)', async ({ page }) => {
    await page.goto('/');
    await search(page, 'BRCA1');
    await page.waitForTimeout(1500);
    await search(page, 'TP53');
    const states = await waitSettled(page);
    expect(states.table).toBe('ready');
    await expect(page.locator('#gene-header h2')).toHaveText('TP53');
    await page.waitForTimeout(3000);
    await expect(page.locator('#gene-header h2')).toHaveText('TP53');
  });
});

test.describe.serial('Saved genes (home page)', () => {
  let context;
  let page;
  let apiRequests;
  const apiCalls = /rest\.uniprot\.org|eutils\.ncbi|gnomad\.broadinstitute|alphafold\.ebi/;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    page = await context.newPage();
    apiRequests = [];
    page.on(
      'request',
      (request) => apiCalls.test(request.url()) && apiRequests.push(request.url()),
    );
    await page.goto('/');
    await loadGene(page, 'TP53');
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('the gene is saved automatically and appears on the home page', async () => {
    await page.click('#brand-button');
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.locator('#results')).toBeHidden();
    const card = page.locator('.gene-card[data-symbol=TP53]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('variants analysed');
    await expect(card).toContainText('Saved today');
    await expect(card).toContainText(/\d+ (KB|MB)/);
    await expect(card).not.toContainText('Out of date');
    await expect(page.locator('#home-storage')).toContainText('1 saved gene');
  });

  test('Open shows it instantly from saved data, with no download', async () => {
    apiRequests.length = 0;
    await page.click('.gene-card[data-symbol=TP53] >> text=Open');
    const states = await waitSettled(page, 60_000);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    expect(apiRequests).toEqual([]);
    await expect(page.locator('#gene-header')).toContainText('cached');
  });

  test('old saved data is labelled out of date and is never refreshed automatically', async () => {
    // Make everything saved 10 days old, then reload the page so it reads storage afresh.
    await page.evaluate(() => {
      const old = Date.now() - 10 * 86_400_000;
      for (const name of Object.keys(localStorage)) {
        const entry = JSON.parse(localStorage.getItem(name));
        if (name.startsWith('vs:http:')) entry.savedAt = old;
        if (name === 'vs:library')
          for (const gene of Object.values(entry.value)) gene.savedAt = old;
        localStorage.setItem(name, JSON.stringify(entry));
      }
    });
    await page.reload();
    await expect(page.locator('.gene-card[data-symbol=TP53]')).toContainText('Out of date');
    apiRequests.length = 0;
    await page.click('.gene-card[data-symbol=TP53] >> text=Open');
    const states = await waitSettled(page, 60_000);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    expect(
      apiRequests,
      'old data is shown as it is; nothing is downloaded behind the back',
    ).toEqual([]);
    await expect(page.locator('#banners')).toContainText('may be out of date');
    await expect(page.locator('#gene-header')).toContainText('Out of date');
  });

  test('Refresh data downloads again, replaces the saved copy and removes the label', async () => {
    apiRequests.length = 0;
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(page.locator('#gene-header')).not.toContainText('Out of date', {
      timeout: 120_000,
    });
    await expect(page.locator('#banners')).not.toContainText('may be out of date');
    expect(apiRequests.length).toBeGreaterThan(0);
    for (const name of PANELS) expect(await panelState(page, name), name).toBe('ready');
    await page.click('#brand-button');
    await expect(page.locator('.gene-card[data-symbol=TP53]')).not.toContainText('Out of date');
  });

  test('Delete takes two clicks and removes the gene, its saved data and its recent search', async () => {
    const card = page.locator('.gene-card[data-symbol=TP53]');
    const savedKeys = () =>
      page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.startsWith('vs:http:TP53:')).length,
      );
    expect(await savedKeys()).toBeGreaterThan(0);
    await card.getByRole('button', { name: 'Delete TP53' }).click();
    await expect(card).toBeVisible(); // the first click only asks
    await expect(card.getByRole('button', { name: 'Delete TP53' })).toContainText('Click again');
    await card.getByRole('button', { name: 'Delete TP53' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('#home-empty')).toBeVisible();
    expect(await savedKeys()).toBe(0);
    await expect(page.locator('#recent-searches')).not.toContainText('TP53');
    await expect(page.locator('#banners')).toContainText('Deleted the saved data for TP53');
  });

  test('Delete all clears every saved gene and the recent list', async () => {
    await page.fill('#gene-input', 'TP53');
    await page.press('#gene-input', 'Enter');
    await waitSettled(page);
    await page.click('#brand-button');
    await expect(page.locator('.gene-card')).toHaveCount(1);
    await page.click('#home-clear');
    await expect(page.locator('#home-clear')).toContainText('Click again');
    await page.click('#home-clear');
    await expect(page.locator('.gene-card')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.startsWith('vs:http:')).length,
      ),
    ).toBe(0);
    await expect(page.locator('#recent-searches .chip')).toHaveCount(0);
  });

  test('sorting the saved genes works (by name and by recently opened)', async () => {
    // MLH1 first, TP53 last: "recent" puts TP53 first, "name" puts MLH1 first.
    for (const gene of ['MLH1', 'TP53']) {
      await page.locator('#example-chips .chip', { hasText: gene }).click();
      await waitSettled(page);
    }
    await page.click('#brand-button');
    const order = () => page.$$eval('.gene-card h3', (els) => els.map((e) => e.textContent));
    await page.selectOption('#home-sort', 'name');
    expect(await order()).toEqual(['MLH1', 'TP53']);
    await page.selectOption('#home-sort', 'recent');
    expect(await order()).toEqual(['TP53', 'MLH1']);
  });
});
