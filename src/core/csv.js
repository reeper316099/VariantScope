// CSV export. Cells that start with = + - @ are prefixed with a quote so spreadsheets never run them.

// Quotes one CSV cell (and neutralises spreadsheet formulas).
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const COLUMNS = [
  ['gene', (v, ctx) => ctx.gene],
  ['clinvar_id', (v) => v.clinvarId],
  ['protein_change', (v) => v.proteinChange],
  ['position', (v) => v.position],
  ['classification', (v) => v.classification],
  ['clinvar_label', (v) => v.clinvarLabel],
  ['review_status', (v) => v.reviewStatus],
  ['gnomad_found', (v) => v.gnomad.found],
  ['gnomad_af', (v) => v.gnomad.af],
  ['gnomad_ac', (v) => v.gnomad.ac],
  ['gnomad_an', (v) => v.gnomad.an],
  ['rarity', (v) => v.rarity],
  ['matched_by', (v) => v.gnomad.matchedBy],
  ['plddt', (v) => v.plddt],
  ['numbering_ok', (v) => v.numberingOk],
];

// Builds the CSV text for a list of unified variants; missing values stay empty (never invented).
export function variantsToCsv(variants, { gene }) {
  const lines = [COLUMNS.map(([name]) => name).join(',')];
  for (const v of variants)
    lines.push(COLUMNS.map(([, get]) => csvCell(get(v, { gene }))).join(','));
  return `${lines.join('\n')}\n`;
}
