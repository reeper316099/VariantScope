# Test fixtures

Every file here is a **real API response, trimmed and saved on 2026-11-03**, used only by unit tests. Nothing here is shipped in the app and none of it is live data. Each JSON file carries a `_fixture` key saying what it is. The PDB excerpt starts with a `REMARK FIXTURE` line.

| File | Source |
|---|---|
| uniprot-*.json | UniProt REST search |
| alphafold-P04637*.json / .pdb | AlphaFold DB API and model file |
| clinvar-TP53-esummary.json | NCBI E-utilities esummary (selected records) |
| gnomad-*.json | gnomAD GraphQL API |
