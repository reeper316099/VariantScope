# Interview talking points

Ten things I can explain about VariantScope, in my own words. Each one has a short version to say out loud and a "if they dig deeper" part. Numbers come from my own test runs on 2 Nov 2026.

## 1. What it does, in one breath

"VariantScope is a gene variant explorer. You type a gene like TP53 and it shows the protein's 3D structure from AlphaFold, puts known disease-linked changes from ClinVar onto it, and checks how common each change is in gnomAD, which is a big database of healthy-ish people's DNA. It answers one question: where in the protein do disease-causing changes cluster, is that part confidently structured, and are those changes almost never seen in the general population?"

_If they dig deeper:_ For TP53, 99.6% of the pathogenic variants I loaded sit in regions where AlphaFold is confident, and 99.2% are absent or ultra-rare in gnomAD. That fits what you would expect: harmful changes in the folded core of an important protein are rarely seen in the general population.

## 2. One codebase, three ways to run it

"It is the same code as a desktop app, a website on GitHub Pages, and something you can run from source. The trick is that every network call goes through one function, `getJson`. In the desktop app that function asks Electron's main process to fetch. In a browser it uses normal `fetch`. Nothing else in the app knows or cares which one it is."

_If they dig deeper:_ That one seam is also what made it testable. The data code is plain JavaScript modules, and I could run the same logic in unit tests, the browser and Electron.

## 3. The hardest problem: joining ClinVar to gnomAD

"ClinVar and gnomAD describe the same variant in different ways, so matching them is where mistakes hide. The best match is the exact genomic position and bases. The tempting shortcut is matching on the protein change, like R175H. But different DNA changes can give the same amino-acid change, so the shortcut can attach the wrong variant's frequency without any error."

_If they dig deeper:_ I measured it. In BRCA1, 136 ClinVar variants had exact coordinates that gnomAD did not contain, but gnomAD did have a different DNA change with the same protein change. The shortcut would have silently given those 136 the wrong frequencies. So I match by coordinates, and I only use the protein change when ClinVar has no coordinates **and** exactly one gnomAD variant fits. If it is ambiguous, the result is "unknown", not a guess.

## 4. "Not found" is not the same as "failed"

"If a variant is not in gnomAD, that is information: it is very rare. If the gnomAD request failed, that is not information at all. The app keeps those apart: not found shows as 'absent', but a failed query shows as 'unknown' and a warning banner. I have a test that checks a blocked gnomAD never turns into 'absent'."

## 5. The numbering check

"Residue numbers can differ between databases, because they use different versions of the protein (isoforms or transcripts). So for every variant I check that the amino acid ClinVar says is at position N really is at position N in the UniProt sequence. If it is not, I do not draw it on the structure. If fewer than 95% match, the app shows a warning."

_If they dig deeper:_ In my runs it matched 100% for BRCA1, TP53, CFTR and MLH1. I also checked it from the 3D side: for three well-known variants in each gene, the residue in the 3D model at that position had the same amino acid as the variant name, for example R175 in TP53 is an arginine in the model.

## 6. Why the desktop app fetches data in the main process

"Four reasons. Browsers block some cross-origin requests (CORS), and the main process does not have that limit. NCBI only allows about three requests a second without a key, so one central place can pace them. A disk cache lets the app work offline. And the web page itself gets a strict security policy that forbids any network access, so even if something malicious got into the page it could not call out. The main process also only talks to four allowlisted hosts over https."

_If they dig deeper:_ I also turned off Chromium's own HTTP cache for those requests. My test showed it was answering some requests silently, which made my "cached 8 days ago" label wrong, and "Clear cache" would not have cleared it.

## 7. Security, in plain words

"The page runs in a sandbox with no access to Node.js. There is a strict Content-Security-Policy that blocks inline scripts and `eval`. Only four functions are exposed to the page, and each checks its inputs. Links and new windows are blocked unless they are https and on a short list. I wrote tests that try to break these rules on purpose, like injecting a script, calling `eval`, navigating to another site and fetching an unlisted host, and confirm they all fail."

_If they dig deeper:_ The 3D library has one `eval` call for a feature I do not use. Instead of just hoping, the build replaces it with an error and fails if the library code changes, and I checked the final bundle has no `eval`.

## 8. How I tested it, and what the tests caught

"There are about 250 unit tests, plus end-to-end tests that run a real browser and the real Electron app against the real public APIs. The end-to-end tests actually click spheres in the 3D view and points in the plot. They found real bugs I would not have seen by looking: clicking a 3D sphere did not work at all, because I registered the clickable atoms before the model was loaded. The table also hid the selected variant if a filter was active, and my header gradient failed the accessibility contrast rule."

_If they dig deeper:_ Not everything is tested, and I say so. I did not automate real fullscreen or the native Save dialogs because they would take over the screen. Windows and Linux builds are only verified by GitHub Actions, and the README labels them "untested locally" until a real run passes.

## 9. The pipeline: CI, releases and being honest about signing

"GitHub Actions has three workflows. One runs lint, tests and builds on every push. One deploys the website to GitHub Pages. One builds installers for Windows, macOS and Linux when I push a version tag, and attaches them to a GitHub Release with a checksum file. The installers are not code-signed, because that costs money, so Windows and macOS show a first-launch warning. The README explains exactly what people will see and how to open the app."

_If they dig deeper:_ On a Mac I found that an unsigned Apple Silicon app had a broken signature, which can show as 'damaged' rather than the normal warning. I added a step that gives it a valid ad-hoc signature, and checked that the signed bundle verifies and still launches.

## 10. Trade-offs and limits

"I chose vanilla JavaScript with small modules instead of a framework, because the app is mostly data and drawing, and I wanted to explain every line. For big genes I load only 1,500 variants, pathogenic and benign first, so uncertain ones are under-represented, and the app says that on screen. It only plots single amino-acid changes, not frameshifts or splice changes. And it is educational: AlphaFold is a prediction, ClinVar labels vary in quality, and gnomAD reflects the people sampled."

_If they dig deeper:_ What I would do next: a 'load all variants' option, shareable links to a gene and variant, and a PAE overlay from AlphaFold that shows how confident it is about how parts of the protein sit relative to each other.

---

## Numbers I can quote

- 4 data sources, 0 API keys, 0 servers.
- TP53: 1,456 variants analysed, 257 pathogenic or likely pathogenic, R175H sits on residue 175 (an arginine), gnomAD allele count 7 of about 1.6 million.
- Numbering match: 100% for BRCA1, TP53, CFTR and MLH1.
- 251 unit tests (about 97.5% statement coverage of the data code), 58 web end-to-end tests, 19 desktop end-to-end tests.
- Fresh TP53 load about 17 seconds in the desktop app; about 0.3 seconds from the disk cache.

## Words I should be able to define

- **Variant:** a spot where a person's DNA differs from the reference.
- **Missense:** a DNA change that swaps one amino acid in the protein for another.
- **ClinVar:** a public archive where labs report what they think a variant does.
- **VUS:** "variant of uncertain significance", meaning nobody knows yet.
- **gnomAD:** a large database of how often variants appear in sequenced people.
- **AlphaFold / pLDDT:** an AI that predicts a protein's 3D shape, with a per-residue confidence score from 0 to 100.
- **CORS:** a browser rule about which websites a page may call.
- **IPC:** how the page talks to Electron's main process.
