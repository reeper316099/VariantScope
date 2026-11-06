# Changelog

All notable changes to VariantScope are listed here, newest first.

## [0.5.0] - 2026-11-05

### What's new

- **Microsoft Store package.** The release build on Windows now also makes a Store package (an `.appx` file) as a separate download, ready to upload to Partner Center. It is not part of the GitHub Release.
- **Privacy policy page**, published with the website at `/privacy.html`. It says what is sent (the gene symbol, to UniProt, AlphaFold, NCBI and gnomAD), what is stored on your device, and that Reeper Studio collects nothing.

### Notes

- The app itself is unchanged. The Store package has not been built or submitted yet: the first real build is the Release workflow's dry run on Windows. See `docs/MICROSOFT_STORE.md`.

## [0.4.0] - 2026-11-05

### What's new

- **Gene overview card.** Under the gene name you now see its full name and other names, its chromosome and band (for example 17p13.1), its start and end position on GRCh38 and its strand, plus **What it does** and **Where it is found**, shown as UniProt's own curated text. Literature references are removed, and long texts start short with a **Show more** button.
- Anything a source does not give says "not available", and a source that could not be reached is named on the card; the rest of the page keeps working.

### Notes

- No new websites are contacted: the overview uses UniProt, NCBI Gene (the same NCBI host as ClinVar) and gnomAD. The desktop bridge is unchanged (still six functions).
- Genes saved before this version open as before, even offline. The overview is downloaded the next time you open them with internet and then saved with the gene. Until then the card says it could not be loaded.
- Positions come from gnomAD's gene record (the same GRCh38 build as the variant data). They show the gene's full extent in gnomAD's annotation, so other databases may give slightly different start and end numbers.

## [0.3.0] - 2026-11-04

### What's new

- **Folders on the home page (desktop app only).** Create folders, nest them inside each other (up to six levels), rename them and move them. A gene can be in several folders at once, or in none (it then sits at the top level). Move things with the **Move to...** menu or by dragging a gene or folder onto a folder or onto a step of the path at the top.
- **Safe deleting.** Deleting a folder keeps your genes by default. The "and everything inside" choice names the genes it would delete first.

### Notes

- Folders are a label only: no gene data is moved or copied, and nothing new crosses the desktop bridge (still six functions).
- The web version is unchanged: its home page has no folders and stores nothing about them.
- Folder layouts from this version are kept in the same place as the saved-genes list, so older saved genes simply start at the top level.

## [0.2.0] - 2026-11-03

### What's new

- **Home page with your saved genes.** Every gene you open is saved automatically and listed on the home page (click the app name). Each card shows the gene, when it was saved, how many variants were analysed, the pathogenic share and how much space it uses. You can open, refresh or delete a gene, sort the list, or delete everything.
- **Saved data no longer expires.** It is shown instantly at any age. After 7 days it gets an **Out of date** label and a **Refresh data** button. The app never refreshes it behind your back, and a failed refresh (for example offline) keeps the saved data on screen.
- Deleting a gene also removes its entry from the "Recent" searches.

### Changed

- The desktop app's bridge now has six functions instead of four (`listCache` and `deleteCache` were added for the home page). Deleting accepts only `"all"` or a short list of safe gene tags and can only touch the app's own cache folder.
- Saved files are now named by gene (`TP53~...json`) so a gene can be sized and deleted without opening files. Files saved by older builds are treated as unassigned and are removed by File > Clear cache.
- The "Offline: showing cached data" banner now appears only when the computer itself reports it is offline. Old data is shown with the Out of date label instead.

### Not changed

- The web version still stores data in the browser's `localStorage` (roughly 5 MB per site), so very large genes may not be fully saved there.

## [0.1.0] - 2026-11-02

First release. VariantScope shows where disease-linked protein changes sit in the AlphaFold 3D structure of a human protein, how confident that structure is, and how rare the changes are in the general population.

### What's new

- **One view per gene.** Type a human gene symbol (try `BRCA1`, `TP53`, `CFTR` or `MLH1`) and get the 3D structure, a lollipop plot along the protein, a sortable variant table, summary cards, gnomAD constraint scores and a plain-language "What this means" panel, all kept in sync: select a variant in any one and the other two follow, with the 3D view zooming to it.
- **AlphaFold 3D structure** coloured by pLDDT confidence using AlphaFold's standard colours, with a switch to colour by pathogenic-variant density, spheres for pathogenic (and optionally benign and VUS) variants, click and hover, spin, fullscreen and Save PNG.
- **ClinVar variants** (pathogenic, likely pathogenic, VUS, likely benign, benign, conflicting) with ClinVar's own wording and review status shown next to the class.
- **gnomAD frequencies** for every variant, bucketed as absent, ultra-rare, rare, low-frequency or common, plus gene-level constraint (pLI, LOEUF, missense Z).
- **A careful join between ClinVar and gnomAD.** Variants are matched by genomic coordinates first. A protein-change fallback is used only when it cannot attach a different DNA change's frequency. "Not found in gnomAD" is never confused with "gnomAD could not be reached".
- **Numbering check.** Every variant's reference amino acid is compared with the UniProt sequence. Mismatches are never drawn on the structure, and a warning appears if fewer than 95% match.
- **Three ways to run it from one codebase:** desktop apps for Windows, macOS and Linux (Electron), a web version on GitHub Pages, and source you can run with `npm`.
- **Works offline in the desktop app.** Responses are cached on disk for 7 days. If the network is down, cached genes open with an "Offline: showing cached data" banner, and genes you have not opened before get a clear message instead of a hang.
- **Honest about missing data.** A source that fails (gnomAD, AlphaFold or ClinVar) shows a warning or an error with a Retry button, and the rest of the page keeps working. Missing values say "not available"; nothing is estimated.
- **Dark mode**, a mobile layout, keyboard shortcuts (Ctrl/Cmd+K search, Ctrl/Cmd+D dark mode, Ctrl/Cmd+E export CSV), CSV export and a text version of the 3D view.

### Security

- The desktop app runs the page in a sandbox with context isolation, no Node.js access and a strict Content-Security-Policy. All network access goes through the main process, which only talks to four allowlisted https hosts, with timeouts, a size limit and rate limiting.
- The shipped code contains no `eval`.

### Known limitations

- The installers are **not code-signed**, so Windows and macOS show a warning the first time. See the README for how to open them.
- For large genes only 1,500 ClinVar missense variants are loaded (pathogenic and benign first), so VUS and conflicting records are under-represented. The app says so on screen.
- Only single-residue missense changes are plotted. Frameshift, nonsense, splice, in-frame and non-coding records are counted but not drawn.
- Windows, Linux and macOS Intel installers, and the release and Pages workflows, were not run locally and are verified only by GitHub Actions.
- Educational use only. Not medical advice.
