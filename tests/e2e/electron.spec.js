// Electron end-to-end tests. The app runs in background mode (invisible, never takes focus) with
// a throwaway user-data folder, so a run cannot disturb the person using the computer.
// Build first: npm run build:electron
import { _electron as electron, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electronPath from 'electron';
import { PANELS, panelState, selectInTable, waitSettled } from './helpers.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const userData = mkdtempSync(path.join(tmpdir(), 'vs-e2e-ud-'));
const SCREENSHOTS = path.join(ROOT, 'docs', 'screenshots');

// Launches the app against the shared user-data folder (extra = Chromium switches).
// CI machines have no GPU, so Linux gets software WebGL (the same flags the browser tests use).
const SOFTWARE_WEBGL =
  process.platform === 'linux'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : [];

const launch = (extra = []) =>
  electron.launch({
    args: [ROOT, ...SOFTWARE_WEBGL, ...extra],
    env: { ...process.env, VARIANTSCOPE_USER_DATA: userData, VARIANTSCOPE_BACKGROUND: '1' },
    timeout: 30_000,
  });

// Finds a menu item by label anywhere in the application menu and calls its click handler.
const clickMenu = (app, label) =>
  app.evaluate(({ Menu }, wanted) => {
    const find = (items) => {
      for (const item of items) {
        if (item.label === wanted) return item;
        const inner = item.submenu && find(item.submenu.items);
        if (inner) return inner;
      }
      return null;
    };
    const item = find(Menu.getApplicationMenu().items);
    if (!item) throw new Error(`menu item not found: ${wanted}`);
    item.click();
    return true;
  }, label);

test.describe.serial('Electron app', () => {
  let app;
  let page;
  const errors = [];

  test.beforeAll(async () => {
    expect(
      existsSync(path.join(ROOT, 'dist', 'electron-renderer', 'index.html')),
      'run `npm run build:electron` first',
    ).toBe(true);
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(30_000);
    // The CSP and navigation tests below break the rules on purpose, so the browser's own
    // "Refused to ..." messages about those attempts are expected and not collected.
    page.on(
      'console',
      (m) =>
        m.type() === 'error' &&
        !/Refused to|Content Security Policy/.test(m.text()) &&
        errors.push(m.text()),
    );
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.waitForLoadState('load');
  });
  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test('launches with the right title, origin and desktop label', async () => {
    expect(await page.title()).toBe('VariantScope');
    expect(page.url()).toBe('app://local/index.html');
    await expect(page.locator('#env-label')).toContainText('Desktop app v0.1.0');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test('security: isolated, sandboxed, no Node in the page, exactly six bridge functions', async () => {
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        contextIsolation: p.contextIsolation,
        nodeIntegration: p.nodeIntegration,
        sandbox: p.sandbox,
        webSecurity: p.webSecurity,
      };
    });
    expect(prefs).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
    expect(
      await page.evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer]),
    ).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
    expect(await page.evaluate(() => Object.keys(window.api).sort())).toEqual([
      'deleteCache',
      'fetchJson',
      'getAppInfo',
      'listCache',
      'openExternal',
      'saveFile',
    ]);
  });

  test('security: strict CSP blocks eval, inline scripts and direct network access', async () => {
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          // Deliberate: a string timeout is eval, and this test proves the CSP blocks it.
          // eslint-disable-next-line no-implied-eval
          setTimeout('window.__stringEval = 1', 0);
          const script = document.createElement('script');
          script.textContent = 'window.__inline = 1';
          document.head.append(script);
          fetch('https://rest.uniprot.org/').then(
            () => resolve({ fetched: true }),
            () =>
              setTimeout(
                () =>
                  resolve({
                    fetched: false,
                    stringEval: window.__stringEval === 1,
                    inline: window.__inline === 1,
                  }),
                300,
              ),
          );
        }),
    );
    expect(result).toEqual({ fetched: false, stringEval: false, inline: false });
  });

  test('security: external navigation, new windows and permissions are blocked', async () => {
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await page.waitForTimeout(800);
    expect(page.url()).toBe('app://local/index.html');
    // The app cancelled that navigation; reload so Playwright's view of the page is clean again.
    await page.reload();
    await page.waitForLoadState('load');
    const before = app.windows().length;
    await page.evaluate(() => window.open('https://example.com/'));
    await page.waitForTimeout(500);
    expect(app.windows().length).toBe(before);
    expect(
      await page.evaluate(() =>
        navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state),
      ),
    ).not.toBe('granted');
  });

  test('security: the host allowlist rejects other hosts, http, bad arguments and bad links', async () => {
    const blocked = await page.evaluate(() => window.api.fetchJson('https://example.com/'));
    expect(blocked).toMatchObject({ ok: false });
    expect(blocked.error).toContain('allowlist');
    expect(
      (
        await page.evaluate(() =>
          window.api.fetchJson('http://rest.uniprot.org/uniprotkb/P04637.json'),
        )
      ).error,
    ).toContain('https');
    expect(
      (await page.evaluate(() => window.api.fetchJson('https://rest.uniprot.org.evil.com/'))).ok,
    ).toBe(false);
    expect(
      await page.evaluate(() => {
        try {
          window.api.fetchJson(123);
          return 'no error';
        } catch (e) {
          return e.message;
        }
      }),
    ).toContain('non-empty string');
    expect(
      await page.evaluate(() => {
        try {
          window.api.saveFile('exe', 'x', 'y');
          return 'no error';
        } catch (e) {
          return e.message;
        }
      }),
    ).toContain('csv or png');
    expect(await page.evaluate(() => window.api.openExternal('https://example.com/'))).toEqual({
      ok: false,
    });
    expect(await page.evaluate(() => window.api.openExternal('file:///etc/passwd'))).toEqual({
      ok: false,
    });
  });

  test('security: the saved-data functions validate their input and cannot reach outside the cache', async () => {
    const bad = (code) =>
      page.evaluate((c) => {
        try {
          return window.api.deleteCache(c) instanceof Promise ? 'accepted' : 'no promise';
        } catch (e) {
          return e.message;
        }
      }, code);
    // Wrong shapes are refused by the bridge before anything reaches the main process.
    expect(await bad(123)).toContain('"all" or an array');
    expect(await bad('everything')).toContain('"all" or an array');
    expect(await bad({ length: 1 })).toContain('"all" or an array');
    // A well-formed array with an unsafe tag reaches the main process, which refuses it: 0 files removed.
    expect(await page.evaluate(() => window.api.deleteCache(['../evil', 'a/b', 'lower']))).toBe(0);
    expect(await page.evaluate(() => window.api.listCache())).toEqual(expect.any(Array));
  });

  test('search works through the IPC path: TP53 loads, all panels ready, 3D view present', async () => {
    await page.fill('#gene-input', 'TP53');
    await page.press('#gene-input', 'Enter');
    const states = await waitSettled(page);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    await expect(page.locator('#viewer canvas')).toBeVisible();
    await expect(page.locator('#table tbody tr')).toHaveCount(50);
    await selectInTable(page, 'p.Arg175His');
    await page.waitForTimeout(1200);
    expect(await page.locator('#viewer').getAttribute('data-selected-residue')).toBe('ARG175');
    await mkdirScreenshots();
    await page.screenshot({ path: path.join(SCREENSHOTS, 'electron-TP53.png'), fullPage: true });
  });

  test('menu: structure, shortcuts, Focus Search, Toggle Dark Mode', async () => {
    const menu = await app.evaluate(({ Menu }) => {
      const flat = (items) =>
        items.flatMap((i) => [
          { label: i.label, accelerator: i.accelerator ?? null },
          ...(i.submenu ? flat(i.submenu.items) : []),
        ]);
      return {
        top: Menu.getApplicationMenu().items.map((i) => i.label),
        all: flat(Menu.getApplicationMenu().items),
      };
    });
    const accel = (label) => menu.all.find((i) => i.label === label)?.accelerator;
    for (const label of ['File', 'View', 'Help']) expect(menu.top).toContain(label);
    for (const label of [
      'Export CSV',
      'Export PNG',
      'Clear cache',
      'Focus Search',
      'Toggle Dark Mode',
      'About VariantScope',
      'GitHub Repository',
      'Report an Issue',
      'Data Sources',
    ]) {
      expect(
        menu.all.map((i) => i.label),
        label,
      ).toContain(label);
    }
    expect(accel('Export CSV')).toBe('CmdOrCtrl+E');
    expect(accel('Focus Search')).toBe('CmdOrCtrl+K');
    expect(accel('Toggle Dark Mode')).toBe('CmdOrCtrl+D');

    await page.locator('#theme-toggle').focus();
    await clickMenu(app, 'Focus Search');
    await expect(page.locator('#gene-input')).toBeFocused();
    const before = await page.locator('html').getAttribute('data-theme');
    await clickMenu(app, 'Toggle Dark Mode');
    expect(await page.locator('html').getAttribute('data-theme')).not.toBe(before);
    await clickMenu(app, 'Toggle Dark Mode');
  });

  test('menu: Export CSV and Export PNG save real files (Save dialog stubbed)', async () => {
    const csvPath = path.join(userData, 'export.csv');
    const pngPath = path.join(userData, 'export.png');
    await app.evaluate(
      ({ dialog }, paths) => {
        const queue = [...paths];
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: queue.shift() }); // no native dialog in tests
      },
      [csvPath, pngPath],
    );
    // Export writes the table's current rows, so clear the R175H filter left by the earlier test.
    await page.fill('#table input[type=search]', '');
    await clickMenu(app, 'Export CSV');
    await expect.poll(() => existsSync(csvPath)).toBe(true);
    const csv = readFileSync(csvPath, 'utf8').trim().split('\n');
    expect(csv[0]).toContain('gene,clinvar_id,protein_change');
    expect(csv.length).toBeGreaterThan(1000);
    await clickMenu(app, 'Export PNG');
    await expect.poll(() => existsSync(pngPath)).toBe(true);
    const png = readFileSync(pngPath);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(5_000);
    // A cancelled dialog must not write anything or throw.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    });
    expect(await page.evaluate(() => window.api.saveFile('csv', 'x.csv', 'a,b'))).toMatchObject({
      ok: false,
      canceled: true,
    });
  });

  test('menu: Help links open only allowlisted https pages in the system browser (stubbed)', async () => {
    await app.evaluate(({ shell }) => {
      globalThis.__opened = [];
      shell.openExternal = async (url) => globalThis.__opened.push(url);
    });
    for (const label of [
      'GitHub Repository',
      'Report an Issue',
      'UniProt',
      'AlphaFold DB',
      'ClinVar',
      'gnomAD',
    ])
      await clickMenu(app, label);
    const opened = await app.evaluate(() => globalThis.__opened);
    expect(opened).toEqual([
      'https://github.com/reeper316099/VariantScope',
      'https://github.com/reeper316099/VariantScope/issues',
      'https://www.uniprot.org/',
      'https://alphafold.ebi.ac.uk/',
      'https://www.ncbi.nlm.nih.gov/clinvar/',
      'https://gnomad.broadinstitute.org/',
    ]);
    // A link inside the page goes through the same allowlist.
    await page.evaluate(() =>
      window.api.openExternal('https://github.com/reeper316099/VariantScope'),
    );
    expect((await app.evaluate(() => globalThis.__opened)).at(-1)).toBe(
      'https://github.com/reeper316099/VariantScope',
    );
  });

  test('BRCA1 also loads through IPC (screenshot for the README)', async () => {
    await page.fill('#gene-input', 'BRCA1');
    await page.press('#gene-input', 'Enter');
    const states = await waitSettled(page);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    await selectInTable(page, 'p.Arg1699Trp');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'electron-BRCA1.png'), fullPage: true });
  });

  test('no renderer errors during the whole session (besides the deliberate CSP probes)', async () => {
    console.log('[electron] collected renderer errors:', JSON.stringify(errors));
    expect(errors).toEqual([]);
  });

  test("the disk cache lives in its own folder, apart from Chromium's cache", async () => {
    const dir = path.join(userData, 'api-cache');
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(10);
    expect(readdirSync(dir).every((f) => f.endsWith('.json'))).toBe(true);
  });

  test('window size and position are remembered across restarts', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 90, width: 1111, height: 777 }),
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    expect(bounds).toMatchObject({ width: 1111, height: 777 });
    const min = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getMinimumSize(),
    );
    expect(min).toEqual([1000, 700]);
  });

  test('cache persists across restarts: TP53 loads fast from disk and says it is cached', async () => {
    page.setDefaultTimeout(30_000);
    await page.waitForLoadState('load');
    const started = Date.now();
    await page.fill('#gene-input', 'TP53');
    await page.press('#gene-input', 'Enter');
    const states = await waitSettled(page, 60_000);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `[electron] TP53 from the disk cache took ${seconds.toFixed(1)}s (fresh load took ~17s)`,
    );
    expect(seconds).toBeLessThan(12);
    await expect(page.locator('#gene-header')).toContainText('cached');
  });

  test('home page: genes are saved automatically and listed with their size', async () => {
    await page.click('#brand-button');
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.locator('#results')).toBeHidden();
    const tp53 = page.locator('.gene-card[data-symbol=TP53]');
    await expect(tp53).toBeVisible();
    await expect(tp53).toContainText('variants analysed');
    await expect(tp53).toContainText('pathogenic or likely pathogenic');
    await expect(tp53).toContainText(/\d+(\.\d)? MB/);
    await expect(page.locator('.gene-card[data-symbol=BRCA1]')).toBeVisible();
    await expect(page.locator('#home-storage')).toContainText('saved genes');
    // The sizes the page shows come from real files in the tagged cache.
    const saved = await page.evaluate(() => window.api.listCache());
    expect(saved.map((g) => g.group)).toEqual(expect.arrayContaining(['TP53', 'BRCA1']));
    const files = readdirSync(path.join(userData, 'api-cache'));
    expect(files.some((f) => f.startsWith('TP53~'))).toBe(true);
    await mkdirScreenshots();
    await page.screenshot({ path: path.join(SCREENSHOTS, 'electron-home.png'), fullPage: true });
  });

  test('home page: Open shows a saved gene straight from disk, no download', async () => {
    const started = Date.now();
    await page.click('.gene-card[data-symbol=TP53] >> text=Open');
    const states = await waitSettled(page, 60_000);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    expect((Date.now() - started) / 1000).toBeLessThan(12);
    await expect(page.locator('#gene-header')).toContainText('cached');
    await expect(page.locator('#gene-header')).not.toContainText('Out of date');
  });

  test('header: Refresh data downloads the gene again and replaces the saved copy', async () => {
    await expect(page.locator('#gene-header')).toContainText('cached');
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(page.locator('#banners')).toContainText('Refreshing TP53');
    // After a refresh the data is new, not "cached".
    await expect(page.locator('#gene-header')).not.toContainText('cached', { timeout: 120_000 });
    for (const name of PANELS) expect(await panelState(page, name), name).toBe('ready');
  });

  test('home page: Delete removes only that gene (files, list entry and recent search)', async () => {
    await page.click('#brand-button');
    const card = page.locator('.gene-card[data-symbol=BRCA1]');
    await card.getByRole('button', { name: 'Delete BRCA1' }).click();
    // The first click only asks for confirmation; nothing is deleted yet.
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Delete BRCA1' })).toContainText('Click again');
    await card.getByRole('button', { name: 'Delete BRCA1' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('#banners')).toContainText('Deleted the saved data for BRCA1');
    const saved = await page.evaluate(() => window.api.listCache());
    expect(saved.map((g) => g.group)).not.toContain('BRCA1');
    expect(saved.map((g) => g.group)).toContain('TP53');
    expect(readdirSync(path.join(userData, 'api-cache')).some((f) => f.startsWith('BRCA1~'))).toBe(
      false,
    );
    await expect(page.locator('#recent-searches')).not.toContainText('BRCA1');
    await expect(page.locator('.gene-card[data-symbol=TP53]')).toBeVisible();
  });

  test('home page: the saved list survives a restart', async () => {
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(30_000);
    await page.waitForLoadState('load');
    await expect(page.locator('.gene-card[data-symbol=TP53]')).toBeVisible();
    await expect(page.locator('.gene-card[data-symbol=BRCA1]')).toHaveCount(0);
  });

  test('single instance: a second launch with the same data folder exits immediately', async () => {
    const child = spawn(electronPath, [ROOT], {
      env: { ...process.env, VARIANTSCOPE_USER_DATA: userData, VARIANTSCOPE_BACKGROUND: '1' },
      stdio: 'ignore',
    });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve('still running');
      }, 15_000);
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    expect(code).not.toBe('still running');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test('menu: Clear cache empties the disk cache and the home page list', async () => {
    await clickMenu(app, 'Clear cache');
    await expect(page.locator('#banners')).toContainText('Cache cleared');
    await expect
      .poll(() =>
        existsSync(path.join(userData, 'api-cache'))
          ? readdirSync(path.join(userData, 'api-cache')).length
          : 0,
      )
      .toBe(0);
    // The home page list is emptied too, so it never lists genes whose data is gone.
    await page.click('#brand-button');
    await expect(page.locator('.gene-card')).toHaveCount(0);
    await expect(page.locator('#home-empty')).toBeVisible();
  });
});

test.describe.serial('Electron offline mode', () => {
  const offlineData = mkdtempSync(path.join(tmpdir(), 'vs-e2e-offline-'));
  const launchOffline = (offline) =>
    electron.launch({
      // The DNS switch makes every host unresolvable, like a dead connection, for the main process too.
      args: [
        ROOT,
        ...SOFTWARE_WEBGL,
        ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : []),
      ],
      env: { ...process.env, VARIANTSCOPE_USER_DATA: offlineData, VARIANTSCOPE_BACKGROUND: '1' },
      timeout: 30_000,
    });

  test('online first, to fill the cache with TP53', async () => {
    const app = await launchOffline(false);
    const page = await app.firstWindow();
    page.setDefaultTimeout(30_000);
    await page.fill('#gene-input', 'TP53');
    await page.press('#gene-input', 'Enter');
    const states = await waitSettled(page);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    await app.close();
  });

  test('offline: an old saved gene still opens, labelled out of date, and a failed Refresh keeps it', async () => {
    // Make every saved response 8 days old. It is NOT deleted for its age; it is only labelled.
    const dir = path.join(offlineData, 'api-cache');
    for (const file of readdirSync(dir)) {
      const entry = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      entry.fetchedAt = Date.now() - 8 * 86_400_000;
      writeFileSync(path.join(dir, file), JSON.stringify(entry));
    }
    const app = await launchOffline(true);
    const page = await app.firstWindow();
    page.setDefaultTimeout(30_000);
    await page.fill('#gene-input', 'TP53');
    await page.press('#gene-input', 'Enter');
    const states = await waitSettled(page, 90_000);
    for (const name of PANELS) expect(states[name], name).toBe('ready');
    await expect(page.locator('#banners')).toContainText('may be out of date');
    await expect(page.locator('#gene-header')).toContainText('Out of date');
    await expect(page.locator('#gene-header')).toContainText('cached 8 days ago');
    await expect(page.locator('#viewer canvas')).toBeVisible();
    await expect(page.locator('#table tbody tr').first()).toBeVisible();

    // Refresh needs the network. Offline it fails with a clear message but keeps the saved data.
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(page.locator('#banners .banner-error')).toContainText('Could not refresh TP53');
    await expect(page.locator('#gene-header h2')).toHaveText('TP53');
    await expect(page.locator('#table tbody tr').first()).toBeVisible();
    await expect(page.locator('#results')).toBeVisible();

    // The home page shows the same gene with the same label.
    await page.click('#brand-button');
    await expect(page.locator('.gene-card[data-symbol=TP53]')).toContainText('Out of date');
    await app.close();
  });

  test('offline: a gene that was never cached shows a friendly error quickly', async () => {
    const app = await launchOffline(true);
    const page = await app.firstWindow();
    page.setDefaultTimeout(30_000);
    const started = Date.now();
    await page.fill('#gene-input', 'MLH1');
    await page.press('#gene-input', 'Enter');
    await expect(page.locator('#banners .banner-error')).toContainText('offline');
    await expect(page.locator('#banners .banner-error')).toContainText('MLH1');
    expect(Date.now() - started).toBeLessThan(15_000);
    await app.close();
  });
});

// Creates docs/screenshots if needed.
async function mkdirScreenshots() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(SCREENSHOTS, { recursive: true });
}
