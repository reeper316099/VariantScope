# Microsoft Store: how VariantScope gets there

The Store version is the same app as the GitHub installers, packaged as an **AppX** file. Microsoft signs it when you submit it, so we need no certificate.

## What is in the repo

- `electron-builder.yml`, the `appx:` block: your Partner Center identity (`identityName`, `publisher`) and the display name "Reeper Studio". These are labels, not secrets.
- `build/appx/`: the four logo images the package needs (made from `build/icon.png`). Without them electron-builder would use its own sample images.
- `.github/workflows/release.yml`: the Windows job also runs `electron-builder --win appx` and uploads the file as the workflow artifact `store-package-windows`. It is **not** added to the GitHub Release, because it is unsigned until the Store signs it.
- `src/public/privacy.html`: the privacy policy page, live at `https://reeper316099.github.io/VariantScope/privacy.html` after the Pages workflow runs.

## Not tested

The Store package can only be built on Windows. It has **not** been built yet (the Mac checks only confirm the config loads). The first real test is the Release workflow's dry run.

## Steps

1. Push the code and let CI go green. Pages then publishes the privacy page; open the address above to check it.
2. **Actions → Release → Run workflow** on `main` (a dry run that publishes nothing). Download the `store-package-windows` artifact and check it contains `VariantScope-Store-<version>-x64.appx`.
3. In Partner Center, open VariantScope → **Start your submission**:
   - **Pricing**: free. **Age rating**: answer the questionnaire honestly (no accounts, no user content).
   - **Properties**: category Education; paste the privacy policy address.
   - **Packages**: upload the `.appx`.
   - **Store listing**: description, screenshots (the ones in `docs/screenshots` are a start), and the sentence "Educational use only. Not medical advice."
4. Submit. Review can take a day or several; if it is rejected, the message says why.
5. For later versions: tag a release as usual, then upload the new `.appx` as a new submission.

## Things to check

- The version in the `.appx` is the tag with a `.0` added (0.5.0 becomes 0.5.0.0). The Store needs the last number to be 0, and electron-builder does this.
- The package name and publisher in `electron-builder.yml` must match Partner Center exactly. If you ever make a new Partner Center product, update both lines.
