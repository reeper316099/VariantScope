# VariantScope architecture

How the app is put together, written so you can explain it. Educational use only; not medical advice.

## The big idea

One codebase ships three ways:

| Way                         | What runs                             | Where the network calls happen                     |
| --------------------------- | ------------------------------------- | -------------------------------------------------- |
| Desktop app (Electron)      | The page inside a locked-down window  | The **main process** (a separate, trusted program) |
| Web version (GitHub Pages)  | The same page in a normal browser tab | The **page itself**, with plain `fetch`            |
| From source (`npm run dev`) | The same page on a local dev server   | The page itself                                    |

The page code does not care which one it is in. It calls one function, `getJson` (`src/core/http.js`), and that function picks the path.

## Folder map

```text
src/
  index.html          the single page (search box, home page, results panels)
  main.js             wires everything together (search, home page, folders, menu events)
  core/               logic with no DOM: fetching, parsing, joining, stats, saving
  ui/                 drawing code: 3D viewer, plot, table, cards, home page, dialogs
  styles/             tokens.css (colours), components.css, layout
electron/
  main.js             creates the window, security rules, IPC handlers
  preload.cjs         the only bridge between the page and the main process
  fetcher.js          network calls for the page (allowlist, timeout, rate limit, size cap)
  allowlist.js        the four API hosts, https only
  disk-cache.js       saved responses as files, one tag per gene
  csp.js, menu.js     the Content-Security-Policy and the application menu
tests/
  unit/               Vitest (logic, no browser)
  e2e/                Playwright (web in Chrome, desktop through Electron)
scripts/              icons, ad-hoc signing, dev launcher, the test timeout watchdog
.github/workflows/    ci.yml, pages.yml, release.yml
docs/                 this file, PUBLISHING.md, screenshots
```

The rule of thumb: `src/core` is plain functions that can be tested without a browser, and `src/ui` only draws what `core` gives it.

## What happens when you search a gene

```text
type "TP53"  ->  loadGene()  (src/core/pipeline.js)
   1. UniProt   gene symbol -> protein accession, sequence, name   (required)
   2. in parallel, each allowed to fail on its own:
        AlphaFold   structure file URL + confidence (pLDDT)
        ClinVar     variants (via NCBI E-utilities), up to 1,500
        gnomAD      allele frequencies + constraint scores (GraphQL)
   3. parse.js     turns each raw response into plain objects
   4. join.js      matches ClinVar variants to gnomAD variants
   5. stats.js     rarity buckets, density, summary numbers
   -> one result object  ->  panels draw it  ->  recordGene() saves it to the home page
```

Key decisions:

- **UniProt is required** because it gives the reference sequence that all residue numbers are checked against. If it fails the search fails.
- **The other three can fail separately.** A failed source shows a warning on its own panel and the rest keeps working. Missing values say "not available"; nothing is estimated.
- **The join uses genomic coordinates first.** A protein-change fallback is used only when ClinVar has no coordinates and exactly one gnomAD variant has that change. If gnomAD could not be reached the rarity is `unknown`, never `absent`.
- **Numbering check.** Each variant's reference amino acid is compared with the UniProt sequence. Mismatches are never drawn, and a warning appears if fewer than 95% match.

## The single network function

`getJson(url, options)` in `src/core/http.js`:

- **Desktop:** calls `window.api.fetchJson`, which goes over IPC to `electron/fetcher.js`. That checks the allowlist (four hosts, https only), applies a 20 second timeout, one retry, a 25 MB size cap and a per-host rate limit (NCBI 340 ms), refuses redirects, and saves the response to disk.
- **Browser:** plain `fetch`, plus a memory map and `localStorage` as the saved copy.

Both paths tag the saved copy with the gene ("group"). That tag is how the home page can size and delete one gene's data without opening files.

## Saved data and freshness

- Saved data **never expires**. It is shown at any age.
- After **7 days** it is labelled **Out of date** and offers **Refresh**. The app never refreshes behind your back.
- Refresh calls the same code with `noCache`, so it downloads again and replaces the saved copy.
- A failed refresh keeps the saved data on screen.

Where it lives:

| Data           | Desktop                                                       | Web                                    |
| -------------- | ------------------------------------------------------------- | -------------------------------------- |
| API responses  | files `api-cache/<GENE>~<hash>.json` in the app data folder   | `localStorage`, keys `http:<GENE>:...` |
| Home page list | `localStorage` key `library` (in the app's own Local Storage) | same                                   |
| Folder layout  | `localStorage` key `folders`                                  | **not used**                           |

The web version is limited to about 5 MB per site by the browser.

## The home page and folders

- `src/core/library.js`: the list of saved genes (summary per gene, sorting).
- `src/core/folders.js`: the folder layout. Pure functions only: each change returns a new state and never edits the old one.
- `src/core/folderStore.js`: loads and saves the layout. Everything read from storage goes through `sanitizeFolders`, which drops bad ids, loops and anything too deep.
- `src/ui/home.js` and `src/ui/dialog.js`: cards, breadcrumbs, dialogs, drag and drop.
- `src/main.js` applies a change, saves it and redraws.

Folder rules:

- A folder is **only a label**. No gene data is moved or copied.
- A gene can be in **several folders**; in none means the top level.
- Nesting is limited to 6 levels. A folder can't go inside itself or its own subfolders. Sibling names are unique.
- **Desktop only.** `main.js` returns no layout unless `isElectron()` is true, so the web page shows the flat list and never reads or writes folder data.
- Deleting a folder keeps genes by default. "Delete folder and everything inside" deletes only genes that are in no other folder, and lists them first.

## Desktop security

| Setting                                                             | Why                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` | The page can't reach Node.js or the file system                   |
| Strict Content-Security-Policy, `connect-src 'none'`                | The page can't make network calls; only the main process can      |
| `app://` custom protocol                                            | Files load from the app, not from `file://`                       |
| Navigation and new windows blocked                                  | Only allowlisted https links open, and only in the system browser |
| Permissions denied (except fullscreen for the app's own page)       | No camera, location, notifications                                |
| No `eval`                                                           | A build plugin removes the single `eval` inside 3Dmol             |

The preload script exposes exactly **six** functions: `fetchJson`, `saveFile`, `openExternal`, `getAppInfo`, `listCache`, `deleteCache`. Each validates its arguments, and the main process re-checks every call and that it came from the app's own page. `deleteCache` accepts only `"all"` or a short list of safe gene tags and can only touch the `api-cache` folder.

## The page: panels and selection

- Six panels (stats, viewer, constraint, meaning, plot, table) each have a state: loading, ready, empty or error.
- A small selection store keeps the 3D view, the lollipop plot and the table in sync: select a variant in one and the other two follow.
- 3Dmol (3D) and Chart.js (plot) are bundled from npm, with no CDN. 3Dmol loads lazily when a structure is first shown.
- Text always goes in with `textContent`, never `innerHTML`, so API data can't inject markup. No inline styles are written (the CSP forbids them).

## Build and release

- **Vite** builds three outputs: `dist/web` (Pages), `dist/electron-renderer` (the desktop page) and `dist/e2e` (adds test-only hooks, never shipped).
- **electron-builder** packages the installers: macOS dmg, Windows installer and portable, Linux AppImage and deb. They are **unsigned**.
- **ci.yml:** lint and unit tests, sharded browser tests, a packaging smoke test on three operating systems, and a best-effort desktop test on Linux.
- **pages.yml:** builds the web version and deploys it to GitHub Pages.
- **release.yml:** pushing a tag like `v0.3.0` builds the installers on three operating systems and publishes a GitHub Release. The tag is the single source of the version. Never create the release by hand on GitHub's website.

## Testing

- **Unit (Vitest):** logic in `src/core` and `electron/`, including the join, stats, cache, freshness, library and folders.
- **Browser (Playwright):** the web build in headless Chrome against the live APIs.
- **Desktop (Playwright + Electron):** security checks, search over IPC, menus, saved genes, folders, offline mode. It runs invisibly with a throwaway data folder, under `scripts/with-timeout.mjs` so a stuck run is killed.

Test-only hooks (`window.__vsTest`, `data-selected-*` attributes) exist only in the `--mode e2e` build.

## Known limits

- Only single-residue missense variants are plotted; other ClinVar records are counted but not drawn.
- Large genes load at most 1,500 ClinVar variants (pathogenic and benign first), so VUS and conflicting records are under-represented. The app says so on screen.
- Installers are unsigned, so Windows and macOS show a warning the first time.
- Windows, Linux and macOS Intel builds are verified by GitHub Actions only.
- The web version's storage is about 5 MB per site.
