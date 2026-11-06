// Cards: gene header, summary stat cards, constraint card, "What this means", selected variant,
// banners and the text fallback for the 3D viewer.
import {
  NOT_AVAILABLE,
  formatAf,
  formatAge,
  formatCount,
  formatDateTime,
  formatPct,
  formatScore,
} from '../core/format.js';
import { splitSummary } from '../core/overview.js';
import { PLDDT_CONFIDENT, RARITY_THRESHOLDS } from '../core/stats.js';
import { buildSummarySentences } from '../core/summaryText.js';
import { clear, el, externalLink, fill } from './dom.js';
import { CLASS_STYLE, plddtBand } from './palette.js';

// Fills the gene header card: names, accession, links, data freshness and a Refresh button.
export function renderGeneHeader(root, { gene, freshness, onRefresh }) {
  fill(
    root,
    el(
      'div',
      { class: 'gene-title' },
      el('h2', { text: gene.geneSymbol }),
      el('span', { class: 'muted', text: gene.proteinName ?? NOT_AVAILABLE }),
    ),
    el(
      'ul',
      { class: 'meta-list' },
      el(
        'li',
        {},
        'UniProt ',
        externalLink(
          `https://www.uniprot.org/uniprotkb/${gene.accession}/entry`,
          gene.accession,
          `UniProt entry ${gene.accession}`,
        ),
      ),
      el('li', { text: `${formatCount(gene.length)} amino acids` }),
      el(
        'li',
        {},
        externalLink(`https://alphafold.ebi.ac.uk/entry/${gene.accession}`, 'AlphaFold DB entry'),
      ),
      el(
        'li',
        {},
        externalLink(
          `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(gene.geneSymbol)}%5Bgene%5D`,
          'ClinVar entries',
        ),
      ),
      el(
        'li',
        {},
        externalLink(
          `https://gnomad.broadinstitute.org/gene/${encodeURIComponent(gene.geneSymbol)}?dataset=gnomad_r4`,
          'gnomAD gene page',
        ),
      ),
    ),
    gene.matchedAlias
      ? el('p', {
          class: 'note',
          text: `Matched an alias: showing the official gene ${gene.geneSymbol}.`,
        })
      : null,
    freshness
      ? el(
          'p',
          { class: 'note freshness' },
          `Data fetched ${formatDateTime(freshness.fetchedAt)}${freshness.fromCache ? ` (cached ${formatAge(freshness.fetchedAt)})` : ''}. `,
          freshness.outOfDate
            ? el('span', { class: 'badge badge-outdated', text: 'Out of date' })
            : null,
          onRefresh
            ? el('button', {
                class: 'button button-small',
                type: 'button',
                text: 'Refresh data',
                title: 'Download the latest data for this gene',
                onclick: onRefresh,
              })
            : null,
        )
      : null,
  );
}

// One summary stat card; `detail` explains the denominator, `extra` is an optional element.
function statCard(label, value, detail, extra = null) {
  return el(
    'div',
    { class: 'card stat-card' },
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value', text: value }),
    el('div', { class: 'stat-detail', text: detail }),
    extra,
  );
}

// Fills the five summary stat cards (counts come from stats.summarize and the ClinVar skip info).
export function renderStatCards(root, { summary, skipped, capped }) {
  clear(root);
  const share = (s) => (s.of === 0 ? NOT_AVAILABLE : `${formatCount(s.n)} of ${formatCount(s.of)}`);
  const reasons = el(
    'details',
    { class: 'reasons' },
    el('summary', { text: 'Why were variants skipped?' }),
    el(
      'ul',
      {},
      ...skipped.reasons.map((r) => el('li', { text: `${r.reason}: ${formatCount(r.count)}` })),
      skipped.complete
        ? null
        : el('li', {
            text: 'The breakdown of non-missense records could not be loaded, so this count is a minimum.',
          }),
    ),
    el('p', {
      class: 'note',
      text: 'Only single-residue missense changes with a usable ClinVar classification can be placed on the structure. Synonymous, truncating, splice, in-frame and non-coding records are counted here, not plotted.',
    }),
  );
  root.append(
    statCard(
      'Variants analysed',
      formatCount(summary.total),
      capped
        ? 'missense with usable classification (capped, see notice)'
        : 'missense with usable classification',
    ),
    statCard(
      'Pathogenic + likely pathogenic',
      formatPct(summary.pathogenicShare),
      `${share(summary.pathogenicShare)} analysed variants`,
    ),
    statCard(
      `Pathogenic in confident regions`,
      formatPct(summary.pathogenicInConfidentRegions),
      `pLDDT ≥ ${PLDDT_CONFIDENT}; ${share(summary.pathogenicInConfidentRegions)} with a score`,
    ),
    statCard(
      'Pathogenic absent or ultra-rare',
      formatPct(summary.pathogenicAbsentOrUltraRare),
      `AF < ${RARITY_THRESHOLDS.ultraRare} or not in gnomAD; ${share(summary.pathogenicAbsentOrUltraRare)} with known frequency`,
    ),
    statCard(
      'Skipped records',
      formatCount(skipped.total),
      skipped.complete ? 'not plotted (see why)' : 'minimum, see why',
      reasons,
    ),
  );
}

// One constraint row: name, value and a plain-English explanation.
function constraintRow(name, value, explanation) {
  return el(
    'div',
    { class: 'constraint-row' },
    el(
      'div',
      { class: 'constraint-head' },
      el('strong', { text: name }),
      el('span', { class: 'constraint-value', text: value }),
    ),
    el('p', { class: 'muted', text: explanation }),
  );
}

// Fills the gene constraint card (pLI, LOEUF, missense Z) with accurate one-line explanations.
export function renderConstraint(root, constraint) {
  fill(
    root,
    constraintRow(
      'pLI',
      formatScore(constraint.pli, 4),
      'Probability that the gene cannot tolerate losing one copy (loss-of-function intolerant). Close to 1 means far fewer truncating variants are seen than expected; close to 0 means they are tolerated.',
    ),
    constraintRow(
      'LOEUF',
      formatScore(constraint.loeuf),
      'Upper bound of the observed/expected ratio of loss-of-function variants in gnomAD. Lower values mean the gene is more constrained against losing function.',
    ),
    constraintRow(
      'Missense Z',
      formatScore(constraint.misZ),
      'How many standard deviations fewer missense variants are observed than expected. Higher positive values mean missense changes are more strongly depleted; values near or below 0 mean no depletion.',
    ),
    el('p', {
      class: 'note',
      text: `Observed ${formatCount(constraint.obsMis)} vs expected ${formatScore(constraint.expMis, 4)} missense variants (ratio ${formatScore(constraint.oeMis)}). gnomAD constraint, transcript ${constraint.maneRefseq ?? constraint.canonicalTranscript ?? NOT_AVAILABLE}.`,
    }),
  );
}

// Fills the rule-based "What this means" panel from computed numbers only.
export function renderMeaning(root, inputs) {
  fill(
    root,
    el(
      'ul',
      { class: 'sentences' },
      ...buildSummarySentences(inputs).map((text) => el('li', { text })),
    ),
    el('p', {
      class: 'note',
      text: 'Educational use only. These are descriptive counts from public data, not a diagnosis or medical advice.',
    }),
  );
}

// Fills the selected-variant detail card (or a hint when nothing is selected).
export function renderSelected(root, variant) {
  clear(root);
  if (!variant) {
    root.append(
      el('p', {
        class: 'muted',
        text: 'Click a variant in the 3D view, the plot or the table to see details here.',
      }),
    );
    return;
  }
  const style = CLASS_STYLE[variant.classification];
  const band = plddtBand(variant.plddt);
  const rows = [
    [
      'ClinVar classification',
      `${style.glyph} ${variant.classification} (ClinVar says: ${variant.clinvarLabel})`,
    ],
    ['Review status', variant.reviewStatus || NOT_AVAILABLE],
    ['gnomAD allele frequency', `${formatAf(variant.gnomad.af)} (${variant.rarity})`],
    [
      'gnomAD allele count',
      variant.gnomad.ac === null
        ? NOT_AVAILABLE
        : `${formatCount(variant.gnomad.ac)} of ${formatCount(variant.gnomad.an)}`,
    ],
    ['Matched to gnomAD by', variant.gnomad.matchedBy ?? 'not matched'],
    [
      'AlphaFold pLDDT',
      variant.plddt === null
        ? NOT_AVAILABLE
        : `${variant.plddt.toFixed(1)}${band ? ` (${band.label})` : ''}`,
    ],
  ];
  fill(
    root,
    el('h3', { text: `${variant.proteinChange}` }),
    el(
      'dl',
      { class: 'detail-list' },
      ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]),
    ),
    el(
      'p',
      {},
      externalLink(
        `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variant.clinvarId}/`,
        'View this record in ClinVar',
        `View ClinVar record ${variant.clinvarId}`,
      ),
    ),
  );
}

// Fills the plain-text fallback for the 3D view: pathogenic residues with their pLDDT band.
export function renderStructureText(root, variants) {
  const pathogenic = variants
    .filter((v) => CLASS_STYLE[v.classification].group === 'pathogenic')
    .sort((a, b) => a.position - b.position);
  const shown = pathogenic.slice(0, 200);
  fill(
    root,
    el('p', {
      class: 'muted',
      text: `Pathogenic and likely pathogenic variants by residue (${formatCount(pathogenic.length)}). Positions in regions with pLDDT ≥ ${PLDDT_CONFIDENT} are confidently predicted.`,
    }),
    el(
      'table',
      { class: 'variant-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ...['Residue', 'Change', 'Classification', 'pLDDT band'].map((t) =>
            el('th', { scope: 'col', text: t }),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        ...shown.map((v) =>
          el(
            'tr',
            {},
            el('td', { text: String(v.position) }),
            el('td', { text: v.proteinChange }),
            el('td', { text: v.classification }),
            el('td', { text: plddtBand(v.plddt)?.label ?? NOT_AVAILABLE }),
          ),
        ),
      ),
    ),
    pathogenic.length > shown.length
      ? el('p', {
          class: 'note',
          text: `Showing the first ${shown.length}. The variant table lists all of them.`,
        })
      : null,
  );
}

// Replaces the banner area with {kind: 'info'|'warn'|'error', text, action?: {label, onClick}} messages.
export function renderBanners(root, banners) {
  clear(root);
  for (const banner of banners) {
    root.append(
      el(
        'div',
        {
          class: `banner banner-${banner.kind}`,
          role: banner.kind === 'error' ? 'alert' : 'status',
        },
        el('span', { text: banner.text }),
        banner.action
          ? el('button', {
              class: 'button banner-action',
              type: 'button',
              text: banner.action.label,
              onclick: banner.action.onClick,
            })
          : null,
      ),
    );
  }
}

// Fills the About dialog's data-source list (versions and fetch timestamps).
export function renderProvenance(root, provenance) {
  clear(root);
  if (!provenance) {
    root.append(
      el('p', { class: 'muted', text: 'Search for a gene to see which data versions were used.' }),
    );
    return;
  }
  root.append(
    el(
      'ul',
      {},
      ...provenance.map((p) =>
        el('li', {
          text: `${p.source} (${p.detail}): fetched ${formatDateTime(p.fetchedAt)}${p.fromCache ? ' (from cache)' : ''}`,
        }),
      ),
    ),
  );
}

// A paragraph of source text: the first part is shown, and a button reveals the rest.
function expandableText(text, label) {
  const { short, rest } = splitSummary(text);
  const paragraph = el('p', { class: 'overview-text', text: short });
  if (rest === null) return paragraph;
  const more = el('span', { text: ` ${rest}`, hidden: true });
  paragraph.append(more);
  const button = el('button', {
    class: 'button button-small',
    type: 'button',
    text: 'Show more',
    'aria-expanded': 'false',
    'aria-label': `Show more: ${label}`,
    onclick: () => {
      more.hidden = !more.hidden;
      button.textContent = more.hidden ? 'Show more' : 'Show less';
      button.setAttribute('aria-expanded', String(!more.hidden));
    },
  });
  return el('div', {}, paragraph, button);
}

// One labelled fact in the overview; a missing value says "not available".
function overviewFact(label, value) {
  return el(
    'div',
    { class: 'overview-fact' },
    el('dt', { text: label }),
    el('dd', { text: value ?? NOT_AVAILABLE }),
  );
}

// Fills the Gene overview card: names, where the gene is on the genome, what it does and where it
// is active. Text is UniProt's own wording; every missing piece says "not available".
export function renderOverview(root, overview, gene) {
  const place =
    overview.chromosome && overview.start && overview.stop
      ? `chr${overview.chromosome}:${formatCount(overview.start)}\u2013${formatCount(overview.stop)} (${overview.build})`
      : null;
  const strand = { '+': 'Forward (+)', '-': 'Reverse (\u2212)' }[overview.strand] ?? null;
  fill(
    root,
    el(
      'div',
      { class: 'overview-grid' },
      el(
        'dl',
        { class: 'overview-facts' },
        overviewFact('Full name', overview.geneName ?? gene.proteinName),
        overviewFact(
          'Also known as',
          overview.aliases.length > 0 ? overview.aliases.join(', ') : null,
        ),
        overviewFact('Chromosome', overview.chromosome),
        overviewFact('Position on chromosome (band)', overview.band),
        overviewFact('Genomic position', place),
        overviewFact('Strand', strand),
      ),
      el(
        'div',
        { class: 'overview-text-block' },
        el('h3', { text: 'What it does' }),
        overview.function
          ? expandableText(overview.function, 'what the gene does')
          : el('p', { class: 'muted', text: NOT_AVAILABLE }),
        el('h3', { text: 'Where it is found' }),
        overview.tissue
          ? expandableText(overview.tissue, 'where the gene is found')
          : el('p', { class: 'muted', text: NOT_AVAILABLE }),
      ),
    ),
    overview.problems.length > 0
      ? el('p', {
          class: 'message-error',
          text: `Not loaded: ${overview.problems.map((p) => `${p.source} (${p.error})`).join('; ')}.`,
        })
      : null,
    el(
      'p',
      { class: 'note' },
      'Descriptions are UniProt\u2019s curated text (literature references removed). The band comes from NCBI Gene; positions come from gnomAD on the GRCh38 genome build, which is the same build as the variant data here, and show the gene\u2019s full extent in gnomAD\u2019s annotation, so other databases may differ slightly. Forward means the gene is read left to right along the chromosome as numbered. ',
      externalLink(
        `https://www.uniprot.org/uniprotkb/${gene.accession}/entry#function`,
        'Read the full UniProt entry',
        `Read the full UniProt entry for ${gene.geneSymbol}`,
      ),
      '.',
    ),
  );
}
