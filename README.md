# VariantScope

A gene variant explorer for learning. Type a human gene symbol (for example `BRCA1`, `TP53`, `CFTR` or `MLH1`) and see the AlphaFold 3D structure of the protein, the ClinVar variants mapped onto it, how rare those variants are in gnomAD, and gene-level constraint scores, all in one view.

> **Educational use only. Not medical advice.**

The README is still being written. This section covers installing the desktop app and what has been tested.

## Download

- **Desktop app (Windows, macOS, Linux):** [GitHub Releases](https://github.com/reeper316099/VariantScope/releases)
- **Web version:** https://reeper316099.github.io/VariantScope/

## Unsigned apps: what you will see

The installers are **not code-signed or notarized**. That needs paid developer accounts (Apple Developer Program, a Windows code-signing certificate), which this project does not have. The apps are safe to open if you downloaded them from this repository's Releases page, but your operating system will warn you the first time. You can check a download against `SHA256SUMS.txt` on the same release page (see below).

### Windows (SmartScreen)

You will see **"Windows protected your PC"** with **Publisher: Unknown publisher**.

1. Click **More info**.
2. Click **Run anyway**.

This applies to both the installer (`VariantScope-Setup-…-win-x64.exe`) and the portable app (`VariantScope-Portable-…-win-x64.exe`).

### macOS (Gatekeeper)

The app has an ad-hoc signature (so it is internally consistent) but no Apple certificate and no notarization. The first time you open it, macOS says it cannot verify the app (the wording varies by macOS version, for example "Apple could not verify VariantScope is free of malware").

- **macOS 15 (Sequoia) and newer:** double-click the app, click **Done**, then open **System Settings → Privacy & Security**, scroll down to the message about VariantScope and click **Open Anyway**, then confirm.
- **macOS 14 and older:** Control-click (or right-click) the app, choose **Open**, then click **Open** in the dialog.
- **Or from the Terminal**, after dragging the app to Applications:

  ```bash
  xattr -dr com.apple.quarantine /Applications/VariantScope.app
  ```

Use `…-mac-arm64.dmg` on Apple Silicon (M1 and newer) and `…-mac-x64.dmg` on Intel Macs.

### Linux

- **AppImage:** make it executable and run it:

  ```bash
  chmod +x VariantScope-*-linux-x64.AppImage
  ./VariantScope-*-linux-x64.AppImage
  ```

  On newer Ubuntu you may need FUSE: `sudo apt install libfuse2t64` (older releases: `libfuse2`).

- **.deb:** `sudo apt install ./VariantScope-*-linux-x64.deb`. On Ubuntu 24.04 the .deb is the more reliable choice, because the AppImage's sandbox can be blocked by the system's user-namespace restrictions. Please do not "fix" that with `--no-sandbox`: it turns off a security feature.

### Verify a download (optional)

Each release has a `SHA256SUMS.txt`. Download it next to the installers, then:

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing      # macOS and Linux
```

```powershell
Get-FileHash .\VariantScope-Setup-*.exe -Algorithm SHA256   # Windows: compare with the file
```

Code signing, notarization and auto-update are on the [stretch list](#stretch-goals), not part of this version.

## What has been tested

"Tested locally" means it was run on the developer's Mac. Anything else is verified only when GitHub Actions runs it, and is marked clearly until a real run passes.

| Target                                       | Status                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Web version in a browser (Chrome)            | Tested locally: end-to-end tests pass against the live public APIs                                            |
| Desktop app in development (macOS)           | Tested locally: end-to-end tests pass                                                                         |
| **macOS Apple Silicon (arm64) packaged app** | Tested locally: built, ad-hoc signed (verified), DMG mounted, packaged app launched and loaded a gene         |
| macOS Intel (x64) `.dmg`                     | **UNTESTED LOCALLY, verified only by CI**                                                                     |
| Windows installer and portable `.exe`        | **UNTESTED LOCALLY, verified only by CI**                                                                     |
| Linux `.AppImage` and `.deb`                 | **UNTESTED LOCALLY, verified only by CI**                                                                     |
| GitHub Pages deployment                      | Subpath build tested locally in a browser; the deployment itself is **UNTESTED LOCALLY, verified only by CI** |
| Release workflow (tag to published release)  | **UNTESTED LOCALLY, verified only by CI**                                                                     |

## Build installers yourself

```bash
npm ci
npm run dist          # builds installers for the system you are on, into release/
```

Requirements: Node.js 22.13 or newer. Building the macOS or Windows installers needs that operating system (or a CI runner).

If your project folder is inside **iCloud Drive** (for example `~/Desktop` with Desktop & Documents sync on), macOS code signing can fail with "resource fork, Finder information, or similar detritus not allowed", because iCloud keeps adding file metadata. Build outside the synced folder:

```bash
npx electron-builder --publish never -c.directories.output=/tmp/variantscope-release
```

## Stretch goals

- Code signing and notarization (macOS and Windows)
- Auto-update with `electron-updater`
