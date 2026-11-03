# Publishing VariantScope: exact steps

These steps take the repository from your computer to a live website and downloadable installers. Your `origin` remote is already set to `https://github.com/reeper316099/VariantScope.git`.

Nothing here has been run on GitHub yet, so the first run of each workflow may need a fix. The checks at each step tell you what to look at.

## 1. Create the repository on GitHub (skip if it already exists)

1. Go to https://github.com/new while signed in as `reeper316099`.
2. Repository name: `VariantScope`. Visibility: **Public** (GitHub Pages on a free account needs a public repository).
3. Leave **"Add a README file"**, **".gitignore"** and **"license"** all unchecked (the project already has them).
4. Click **Create repository**.

## 2. Check what will be pushed

```bash
git remote -v
git status --short
```

- `origin` should point to `https://github.com/reeper316099/VariantScope.git`.
- `git status` should list only files you mean to commit. You should **not** see `node_modules/`, `dist/`, `release/`, `coverage/`, `test-results/` or `scratch/` (they are git-ignored).

Commit anything that is still uncommitted:

```bash
git add -A
git commit -m "Add docs, license, changelog and interview notes (Phase 7)"
```

## 3. Push the code

```bash
git push -u origin main
```

If Git asks you to sign in, use a [personal access token](https://github.com/settings/tokens) as the password (HTTPS), or run `gh auth login` if you use the GitHub CLI.

## 4. Watch the first CI run

1. Open the repository's **Actions** tab. A **CI** run starts from your push.
2. The `test` job (lint, unit tests, web build, browser end-to-end tests) should go green. The end-to-end tests use the live public APIs, so give it about 10 to 15 minutes. If a test fails once with a network error, re-run the job (CI retries each test once already).
3. The `package-smoke` job builds the desktop app (without installers) on Linux, Windows and macOS. This is the first real check of those platforms. If one fails, open it and read the error before tagging a release.
4. The `electron-e2e` job is best effort and is allowed to fail on its first runs (Linux sandbox setup). Failure there does not block anything.

## 5. Turn on GitHub Pages

1. Repository **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Go to the **Actions** tab, open the **Pages** workflow and click **Run workflow** (or just push another commit). The first push happened before Pages was enabled, so this run needs a nudge.
4. When the **deploy** job finishes, the URL appears in the job summary and under Settings → Pages: https://reeper316099.github.io/VariantScope/
5. Open it, search `TP53`, and confirm the 3D view and table load.

## 6. Optional: a dry run of the release build (recommended)

This builds all installers on all three systems but **publishes nothing**.

1. **Actions** tab → **Release** → **Run workflow** → run it on `main`.
2. When it finishes, open the run and download the `installers-…` artifacts. Check each system produced its files:
   - macOS: `VariantScope-0.1.0-mac-arm64.dmg` and `…-mac-x64.dmg`
   - Windows: `VariantScope-Setup-0.1.0-win-x64.exe` and `VariantScope-Portable-0.1.0-win-x64.exe`
   - Linux: `VariantScope-0.1.0-linux-x64.AppImage` and `…-linux-x64.deb`

## 7. Tag the release and push the tag

The tag is the single source of truth for the version: the release workflow sets the app version from it (`v0.1.0` builds app version `0.1.0`), so the tag and `package.json` can never conflict. The tag must be a valid version such as `v0.1.0` or `v1.2.3`. For the first release use `v0.1.0`, which matches the CHANGELOG and README.

```bash
git tag -a v0.1.0 -m "VariantScope 0.1.0"
git push origin v0.1.0
```

## 8. Watch the release build

1. **Actions** tab → the **Release** run for `v0.1.0`.
2. Three jobs run in order: `draft` (creates a draft release), `build` (three systems in parallel, each uploads its installers), `publish` (adds `SHA256SUMS.txt` and publishes the release).
3. If everything is green, the release is published automatically.

## 9. Where to find the installers

- **Releases page:** https://github.com/reeper316099/VariantScope/releases/tag/v0.1.0 (also in the sidebar of the repository's front page).
- It contains the six installers, `SHA256SUMS.txt`, and some `latest*.yml` and `.blockmap` files (used by auto-update, which this version does not do; you can ignore them).

## 10. After the first release: click through it yourself

1. The release is **published**, not a draft, and lists installers for all three systems plus `SHA256SUMS.txt`.
2. Verify one download against `SHA256SUMS.txt` (see the README).
3. **macOS:** download the arm64 DMG, open it, drag the app to Applications and open it. You should see the Gatekeeper prompt described in the README; follow those steps and check they match what you see.
4. Search `TP53`, click the `p.Arg175His` row and confirm the 3D view zooms to it with a label. Try **File → Export CSV**, **Export PNG** and the **Fullscreen** button (these two features are the ones the automated tests do not cover).
5. Quit and reopen the app: the window should return to the same size and TP53 should load almost instantly (disk cache).
6. Turn Wi-Fi off, reopen the app and search TP53: you should see the "Offline: showing cached data" banner. Then search a gene you have not opened before: you should get a clear message, not a hang.
7. **Windows and Linux:** install, open past the warning and load a gene (ask a friend with that system if you do not have one).
8. Open the live web version and load a gene.

## If something goes wrong

- **A workflow failed after you pushed a tag.** In the repository: delete the draft release (Releases → the draft → Delete). Then remove the tag, fix the problem, commit and tag again:

  ```bash
  git tag -d v0.1.0
  git push --delete origin v0.1.0
  ```

- **Pages shows a blank page or 404 for assets.** The site must be served from `/VariantScope/`; the Pages workflow sets that automatically. Do not deploy the output of a plain `npm run build:web` by hand.
- **The release job fails at "Set the app version from the tag".** The tag is not a valid version (it must look like `v0.1.0`). Delete it as shown above and re-tag.
