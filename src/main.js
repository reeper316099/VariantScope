// App bootstrap and orchestration: search -> load -> render every panel, with loading, error,
// empty and partial states, and shared selection between the 3D view, the plot and the table.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { cacheClearResponses } from './core/cache.js';
import { variantsToCsv } from './core/csv.js';
import { formatCount, formatDateTime } from './core/format.js';
import { HttpError, isElectron } from './core/http.js';
import { loadGene } from './core/pipeline.js';
import { GeneNotFoundError } from './core/uniprot.js';
import {
  renderBanners,
  renderConstraint,
  renderGeneHeader,
  renderMeaning,
  renderProvenance,
  renderSelected,
  renderStatCards,
  renderStructureText,
} from './ui/cards.js';
import { el } from './ui/dom.js';
import { createLollipop } from './ui/lollipop.js';
import { PLDDT_BANDS } from './ui/palette.js';
import { preparePanel, setPanelState } from './ui/panels.js';
import { addRecent, initSearch } from './ui/search.js';
import { selection } from './ui/selection.js';
import { createVariantTable } from './ui/table.js';
import { initTheme, toggleTheme } from './ui/theme.js';
import { createStructureViewer } from './ui/viewer3d.js';

const $ = (id) => document.getElementById(id);
const panels = Object.fromEntries(
  [...document.querySelectorAll('[data-panel]')].map((p) => [p.dataset.panel, p]),
);
Object.values(panels).forEach(preparePanel);

const app = {
  controller: null,
  symbol: null,
  result: null,
  plotted: [],
  viewer: null,
  viewerFailed: false,
};
const plot = createLollipop($('plot'), { onSelect: (id) => selection.select(id, 'plot') });
const table = createVariantTable($('table'), {
  onSelect: (id) => selection.select(id, 'table'),
  onExport: () => exportCsv(),
});

initTheme($('theme-toggle'));
$('plddt-legend').append(
  ...PLDDT_BANDS.map((band) =>
    el(
      'li',
      {},
      el('span', { class: `swatch swatch-${band.id}`, 'aria-hidden': 'true' }),
      `pLDDT ${band.label}`,
    ),
  ),
);

const search = initSearch({
  form: $('search-form'),
  input: $('gene-input'),
  chips: $('example-chips'),
  recent: $('recent-searches'),
  error: $('search-error'),
  onSearch: (symbol) => runSearch(symbol),
});

// ---------- Search flow ----------

// Loads a gene and renders it; a newer search cancels this one.
async function runSearch(symbol) {
  app.controller?.abort();
  const controller = new AbortController();
  app.controller = controller;
  app.symbol = symbol;
  addRecent(symbol);
  search.refreshRecent();
  showLoading(symbol);
  try {
    const result = await loadGene(symbol, {
      signal: controller.signal,
      onProgress: ({ loaded, total }) => {
        if (!controller.signal.aborted) {
          renderBanners($('banners'), [
            {
              kind: 'info',
              text: `Loading ClinVar: ${formatCount(loaded)} / ${formatCount(total)}`,
            },
          ]);
        }
      },
    });
    if (!controller.signal.aborted) renderResult(result);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof HttpError && err.kind === 'aborted')) return;
    showFatal(symbol, err);
  }
}

// Puts every panel into its loading state (skeleton shimmer) while data is fetched.
function showLoading(symbol) {
  $('welcome').hidden = true;
  $('results').hidden = false;
  selection.select(null, 'reset');
  renderBanners($('banners'), [{ kind: 'info', text: `Loading ${symbol}…` }]);
  $('gene-header').replaceChildren(el('div', { class: 'shimmer' }));
  for (const panel of Object.values(panels)) setPanelState(panel, 'loading');
  document.title = `${symbol} · VariantScope`;
}

// Shows a friendly error when the gene itself could not be loaded (UniProt is required).
function showFatal(symbol, err) {
  $('results').hidden = true;
  $('welcome').hidden = false;
  const retry = { label: 'Retry', onClick: () => runSearch(symbol) };
  let banner;
  if (err instanceof GeneNotFoundError) {
    banner = {
      kind: 'error',
      text: `"${symbol}" was not found as a human gene in UniProt (reviewed entries only). Check the spelling or try an official gene symbol such as BRCA1.`,
    };
  } else if (err instanceof HttpError && err.kind === 'offline') {
    banner =
      isElectron() || navigator.onLine === false
        ? {
            kind: 'error',
            text: `You appear to be offline and ${symbol} has not been cached yet. Connect to the internet, or open a gene you have viewed before (see Recent).`,
            action: retry,
          }
        : {
            kind: 'error',
            text: "This data source can't be reached from the browser. Download the desktop app for full functionality.",
            action: retry,
          };
  } else {
    banner = { kind: 'error', text: `Could not load ${symbol}: ${err.message}`, action: retry };
  }
  renderBanners($('banners'), [banner]);
}

// ---------- Rendering ----------

// Builds the notices shown above the results (offline, cap, partial data, numbering).
function buildBanners(result) {
  const { clinvar, gnomadVariants, numbering, freshness } = result;
  const banners = [];
  // Offline = a request failed and an old copy was used, or cached data is shown while the system is offline.
  if (freshness.offline || (freshness.fromCache && navigator.onLine === false)) {
    banners.push({
      kind: 'warn',
      text: `Offline: showing cached data from ${formatDateTime(freshness.fetchedAt)}.`,
    });
  }
  if (clinvar.status === 'ok' && clinvar.value.capped) {
    const { loaded, totalAvailable } = clinvar.value;
    banners.push({
      kind: 'info',
      text: `Showing ${formatCount(loaded)} of ${formatCount(totalAvailable)} ClinVar missense records (loading cap). Pathogenic, likely pathogenic, benign and likely benign records are loaded first, so VUS and conflicting records are under-represented.`,
    });
  }
  if (gnomadVariants.status === 'failed') {
    banners.push({
      kind: 'warn',
      text: `gnomAD could not be loaded (${gnomadVariants.error}). Allele frequencies are not available, so rarity shows as "unknown". ClinVar and the structure are still shown.`,
      action: { label: 'Retry', onClick: () => runSearch(app.symbol) },
    });
  }
  if (
    !isElectron() &&
    ['clinvar', 'alphafold', 'gnomadVariants', 'constraint'].some(
      (k) => result[k].status === 'failed' && result[k].kind === 'offline',
    ) &&
    navigator.onLine !== false
  ) {
    banners.push({
      kind: 'warn',
      text: "This data source can't be reached from the browser. Download the desktop app for full functionality.",
    });
  }
  if (numbering?.flagged) {
    banners.push({
      kind: 'error',
      text: `Numbering may not match this structure: only ${((numbering.rate ?? 0) * 100).toFixed(1)}% of ClinVar variants have the expected residue in the UniProt sequence. Mismatched variants are not plotted; turn off "Only numbering OK" in the table to list them.`,
    });
  } else if (numbering && numbering.matching < numbering.checked) {
    banners.push({
      kind: 'info',
      text: `${formatCount(numbering.checked - numbering.matching)} variants did not match the UniProt residue numbering and are not plotted. They are listed in the table when "Only numbering OK" is off.`,
    });
  }
  return banners;
}

// Renders all panels from a pipeline result, honouring per-source failures (partial state).
async function renderResult(result) {
  app.result = result;
  const { gene, alphafold, clinvar, constraint, variants, summary, freshness } = result;
  const retry = () => runSearch(app.symbol);
  renderBanners($('banners'), buildBanners(result));
  renderGeneHeader($('gene-header'), { gene, freshness });
  renderProvenance($('about-provenance'), result.provenance);
  app.plotted = variants.filter((v) => v.numberingOk);

  if (clinvar.status === 'ok') {
    const info = clinvar.value;
    renderStatCards($('stat-cards'), { summary, skipped: info.skipped, capped: info.capped });
    setPanelState(panels.stats, 'ready');
    const constraintValue = constraint.status === 'ok' ? constraint.value : null;
    renderMeaning($('meaning'), {
      gene: gene.geneSymbol,
      summary,
      variants: app.plotted,
      length: gene.length,
      constraint: constraintValue,
      plddt: alphafold.status === 'ok' ? alphafold.value?.plddt : null,
    });
    setPanelState(panels.meaning, 'ready');
    const plddt = alphafold.status === 'ok' ? (alphafold.value?.plddt ?? null) : null;
    setPanelState(panels.plot, 'ready');
    plot.update({ variants: app.plotted, length: gene.length, plddt });
    plot.setShowUncertain($('plot-vus').checked);
    setPanelState(panels.table, 'ready');
    table.update(variants);
  } else {
    const message = `ClinVar variants could not be loaded: ${clinvar.error}`;
    for (const name of ['stats', 'meaning', 'plot', 'table'])
      setPanelState(panels[name], 'error', { message, onRetry: retry });
  }

  if (constraint.status === 'failed')
    setPanelState(panels.constraint, 'error', {
      message: `Constraint scores could not be loaded: ${constraint.error}`,
      onRetry: retry,
    });
  else if (constraint.value === null)
    setPanelState(panels.constraint, 'empty', {
      message: 'gnomAD has no constraint scores for this gene (not available).',
    });
  else {
    renderConstraint($('constraint'), constraint.value);
    setPanelState(panels.constraint, 'ready');
  }

  renderSelected($('selected'), null);
  await renderStructure(result);
}

// Shows the 3D structure (creating the WebGL viewer the first time the panel is visible).
async function renderStructure(result) {
  const { alphafold, gene } = result;
  if (alphafold.status === 'failed') {
    setPanelState(panels.viewer, 'error', {
      message: `The AlphaFold structure could not be loaded: ${alphafold.error}`,
      onRetry: () => runSearch(app.symbol),
    });
    return;
  }
  if (alphafold.value === null) {
    setPanelState(panels.viewer, 'empty', {
      message: `AlphaFold DB has no predicted structure for ${gene.geneSymbol} (not available).`,
    });
    return;
  }
  renderStructureText($('structure-text'), app.plotted);
  setPanelState(panels.viewer, 'ready'); // the container must be visible before WebGL starts
  try {
    app.viewer ??= await createStructureViewer($('viewer'), {
      onSelect: (id) => selection.select(id, 'viewer'),
    });
    if (app.result !== result) return; // a newer search replaced this one while WebGL loaded
    app.viewer.load({
      pdbText: alphafold.value.pdbText,
      variants: app.plotted,
      plddt: alphafold.value.plddt,
      length: gene.length,
    });
    app.viewer.setColorMode($('color-mode').value);
    app.viewer.setVisibility({
      benign: $('show-benign').checked,
      uncertain: $('show-vus').checked,
    });
    app.viewerFailed = false;
  } catch (err) {
    app.viewerFailed = true;
    $('viewer').replaceChildren(
      el('p', {
        class: 'message-error',
        text: `The 3D viewer could not start (${err.message}). The text version below has the same information.`,
      }),
    );
    document.querySelector('.text-view').open = true;
  }
}

// ---------- Selection sync: 3D view, plot and table always agree ----------

selection.subscribe((id) => {
  const variant =
    app.plotted.find((v) => v.clinvarId === id) ??
    app.result?.variants.find((v) => v.clinvarId === id) ??
    null;
  app.viewer?.select(id);
  plot.select(id);
  table.select(id);
  renderSelected($('selected'), variant);
});

// ---------- Controls ----------

$('color-mode').addEventListener('change', (e) => {
  app.viewer?.setColorMode(e.target.value);
  // Show the legend that matches the colouring.
  $('plddt-legend').hidden = e.target.value !== 'plddt';
  $('density-legend').hidden = e.target.value !== 'density';
});
const syncVisibility = () =>
  app.viewer?.setVisibility({ benign: $('show-benign').checked, uncertain: $('show-vus').checked });
$('show-benign').addEventListener('change', syncVisibility);
$('show-vus').addEventListener('change', syncVisibility);
$('plot-vus').addEventListener('change', (e) => plot.setShowUncertain(e.target.checked));
$('plot-reset').addEventListener('click', () => plot.resetZoom());
$('view-reset').addEventListener('click', () => app.viewer?.reset());
$('view-spin').addEventListener('click', (e) =>
  e.currentTarget.setAttribute('aria-pressed', String(app.viewer?.toggleSpin() ?? false)),
);
$('view-fullscreen').addEventListener('click', () =>
  app.viewer?.toggleFullscreen($('viewer-panel')),
);
$('view-png').addEventListener('click', () => exportPng());
$('about-button').addEventListener('click', () => {
  $('about-version').textContent = `${__APP_VERSION__}${isElectron() ? ' (desktop)' : ' (web)'}`;
  $('about-dialog').showModal();
});

// ---------- Export (native Save dialog in Electron, download in the browser) ----------

// Saves text or bytes: through the main process in Electron, as a download in the browser.
async function saveFile(kind, name, data) {
  if (isElectron()) return window.api.saveFile(kind, name, data);
  const type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'image/png';
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true };
}

// Exports the table's current (filtered, sorted) rows as CSV.
function exportCsv() {
  if (!app.result || app.result.clinvar.status !== 'ok') return;
  const gene = app.result.gene.geneSymbol;
  return saveFile('csv', `${gene}_variants.csv`, variantsToCsv(table.visible, { gene }));
}

// Exports the 3D view as a PNG image.
function exportPng() {
  if (!app.viewer || !app.result) return;
  const base64 = app.viewer.pngDataUrl().split(',')[1];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return saveFile('png', `${app.result.gene.geneSymbol}_structure.png`, bytes);
}

// ---------- Environment, menu and links ----------

// Shows which build is running (desktop app with its version, or the web version).
async function showEnvironment() {
  const info = isElectron() ? await window.api.getAppInfo() : null;
  $('env-label').textContent = info
    ? `Desktop app v${info.version} (${info.platform})`
    : 'Web version';
}
showEnvironment();

// The Electron menu sends fixed action names as "vs:menu" events; unknown names are ignored.
window.addEventListener('vs:menu', (event) => {
  const actions = {
    'focus-search': () => search.focus(),
    'toggle-theme': toggleTheme,
    'export-csv': exportCsv,
    'export-png': exportPng,
    'cache-cleared': () => {
      cacheClearResponses();
      renderBanners($('banners'), [{ kind: 'info', text: 'Cache cleared.' }]);
    },
  };
  actions[event.detail]?.();
});

// Browser build: Ctrl/Cmd+K focuses search, Ctrl/Cmd+D toggles dark mode, Ctrl/Cmd+E exports CSV.
if (!isElectron()) {
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const actions = { k: () => search.focus(), d: toggleTheme, e: exportCsv };
    if (actions[event.key]) {
      event.preventDefault();
      actions[event.key]();
    }
  });
}

// Desktop: open external links in the system browser through the allowlisted bridge.
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[data-external]');
  if (link && isElectron()) {
    event.preventDefault();
    window.api.openExternal(link.href);
  }
});
