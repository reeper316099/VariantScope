// Shared helpers for the end-to-end tests.
import { expect } from '@playwright/test';

export const PANELS = ['stats', 'viewer', 'constraint', 'meaning', 'plot', 'table'];

// Starts recording console errors and uncaught exceptions. Failed requests to NCBI are kept
// apart: NCBI sometimes answers without CORS headers (a transient rate limit) and the app's
// retry recovers, so those are reported but not treated as app errors. Tests that block a host
// on purpose pass it in `expectedFailures` so the browser's own "request failed" logs are ignored.
export function watchErrors(page, expectedFailures = []) {
  const record = { errors: [], ncbiNoise: [] };
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const where = `${message.location().url ?? ''} ${message.text()}`;
    if (expectedFailures.some((host) => where.includes(host))) return;
    if (where.includes('eutils.ncbi.nlm.nih.gov'))
      record.ncbiNoise.push(message.text().slice(0, 120));
    else record.errors.push(message.text());
  });
  page.on('pageerror', (error) => record.errors.push(`pageerror: ${error.message}`));
  return record;
}

// Types a gene into the search box and presses Enter.
export async function search(page, symbol) {
  await page.fill('#gene-input', symbol);
  await page.press('#gene-input', 'Enter');
}

// The data-state of a panel: loading | ready | empty | error.
export const panelState = (page, name) =>
  page.locator(`[data-panel=${name}]`).getAttribute('data-state');

// Waits until every panel is in a final state (not loading); returns the states.
export async function waitSettled(page, timeout = 200_000) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-panel]')].every(
        (p) => p.dataset.state && p.dataset.state !== 'loading',
      ),
    null,
    { timeout },
  );
  return Object.fromEntries(
    await page.$$eval('[data-panel]', (els) => els.map((e) => [e.dataset.panel, e.dataset.state])),
  );
}

// Searches a gene and waits for the whole view to be ready (asserts every panel succeeded).
export async function loadGene(page, symbol) {
  await search(page, symbol);
  const states = await waitSettled(page);
  for (const name of PANELS) {
    // Include the panel's own message so a failed source is easy to diagnose.
    const message =
      states[name] === 'ready'
        ? ''
        : await page.locator(`[data-panel=${name}] .panel-message`).textContent();
    expect(states[name], `${symbol}: ${name} panel (${message})`).toBe('ready');
  }
  await page.waitForFunction(() => document.querySelector('#viewer canvas'), null, {
    timeout: 30_000,
  });
}

// Filters the table to one protein change and clicks its row (selects the variant everywhere).
export async function selectInTable(page, change) {
  await page.fill('#table input[type=search]', change);
  const row = page.locator('#table tbody tr').first();
  await expect(row.locator('td').first()).toHaveText(change);
  await row.click();
  return row.getAttribute('data-id');
}

// Counts which AlphaFold pLDDT colour bands appear in the 3D viewer (shaded pixels are matched
// to the nearest band colour). Returns {band: share of non-background pixels}.
export async function plddtBandShares(page) {
  const png = await page.locator('#viewer').screenshot();
  return page.evaluate(async (b64) => {
    const image = await new Promise((resolve) =>
      Object.assign(new Image(), {
        src: `data:image/png;base64,${b64}`,
        onload() {
          resolve(this);
        },
      }),
    );
    const canvas = Object.assign(document.createElement('canvas'), {
      width: image.width,
      height: image.height,
    });
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bands = {
      'very-high': [0, 83, 214],
      confident: [101, 203, 243],
      low: [255, 219, 19],
      'very-low': [255, 125, 69],
    };
    const counts = { 'very-high': 0, confident: 0, low: 0, 'very-low': 0 };
    let foreground = 0;
    for (let i = 0; i < data.length; i += 16) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (saturation < 60) continue; // gray/white/navy background
      foreground++;
      for (const [name, [br, bg, bb]] of Object.entries(bands)) {
        if (Math.hypot(r - br, g - bg, b - bb) < 85) counts[name]++;
      }
    }
    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, foreground ? v / foreground : 0]),
    );
  }, png.toString('base64'));
}

// Counts non-transparent pixels in a canvas (a blank chart would have almost none).
export function canvasInk(page, selector) {
  return page.$eval(selector, (canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++;
    return ink;
  });
}
