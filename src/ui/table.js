// Variant table: sortable columns, text filter, classification/rarity chips, numbering toggle,
// pagination (50 rows per page), row selection and CSV export.
import { formatAf } from '../core/format.js';
import { RARITY_LABELS } from '../core/stats.js';
import {
  CLASSIFICATIONS,
  filterVariants,
  pageOfVariant,
  paginate,
  sortVariants,
} from '../core/tableModel.js';
import { clear, el } from './dom.js';
import { CLASS_STYLE, plddtBand } from './palette.js';

const COLUMNS = [
  { key: 'change', label: 'Protein change' },
  { key: 'classification', label: 'ClinVar classification' },
  { key: 'review', label: 'Review status' },
  { key: 'af', label: 'gnomAD AF' },
  { key: 'plddt', label: 'pLDDT' },
  { key: 'matchedBy', label: 'Matched by' },
];

// Creates the table inside `root`; callbacks: onSelect(id), onExport().
export function createVariantTable(root, { onSelect, onExport }) {
  const state = {
    variants: [],
    text: '',
    classes: new Set(),
    rarities: new Set(),
    onlyNumberingOk: true,
    sortKey: 'change',
    sortDir: 'asc',
    page: 1,
    selectedId: null,
  };
  let visible = []; // filtered + sorted variants for the current view

  const controls = el('div', { class: 'table-controls' });
  const filterRow = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filters' });
  const wrap = el('div', { class: 'table-wrap' });
  const pager = el('div', { class: 'pager' });
  root.append(controls, filterRow, wrap, pager);

  // Text filter, numbering toggle and export button.
  const search = el('input', {
    type: 'search',
    class: 'input',
    placeholder: 'Filter (e.g. R175, pathogenic, expert panel)',
    'aria-label': 'Filter variants by text',
    oninput: (event) => {
      state.text = event.target.value;
      state.page = 1;
      render();
    },
  });
  const numberingToggle = el('input', {
    type: 'checkbox',
    checked: true,
    onchange: (event) => {
      state.onlyNumberingOk = event.target.checked;
      state.page = 1;
      render();
    },
  });
  controls.append(
    search,
    el('label', { class: 'toggle' }, numberingToggle, ' Only numbering OK'),
    el('button', {
      class: 'button',
      type: 'button',
      text: 'Export CSV',
      onclick: () => onExport(visible),
    }),
  );

  // A toggle chip for one filter value; the text label means colour is never the only signal.
  const chip = (set, value, label) =>
    el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': 'false',
      text: label,
      onclick: (event) => {
        set.has(value) ? set.delete(value) : set.add(value);
        event.currentTarget.setAttribute('aria-pressed', String(set.has(value)));
        state.page = 1;
        render();
      },
    });
  filterRow.append(
    el('span', { class: 'chip-label', text: 'Classification:' }),
    ...CLASSIFICATIONS.map((c) => chip(state.classes, c, `${CLASS_STYLE[c].glyph} ${c}`)),
    el('span', { class: 'chip-label', text: 'Rarity:' }),
    ...RARITY_LABELS.map((r) => chip(state.rarities, r, r)),
  );

  // Clears the text filter and the classification/rarity chips (used to reveal a hidden selection).
  function clearFilters() {
    state.text = '';
    state.classes.clear();
    state.rarities.clear();
    search.value = '';
    for (const chipButton of filterRow.querySelectorAll('.chip'))
      chipButton.setAttribute('aria-pressed', 'false');
    visible = sortVariants(filterVariants(state.variants, state), state.sortKey, state.sortDir);
  }

  // Renders the header, current page of rows and pager.
  function render() {
    visible = sortVariants(filterVariants(state.variants, state), state.sortKey, state.sortDir);
    const { rows, page, pageCount, total } = paginate(visible, state.page);
    state.page = page;

    const head = el(
      'tr',
      {},
      ...COLUMNS.map((column) => {
        const active = state.sortKey === column.key;
        return el(
          'th',
          {
            scope: 'col',
            'aria-sort': active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
          },
          el('button', {
            class: 'sort-button',
            type: 'button',
            text: `${column.label}${active ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}`,
            onclick: () => {
              state.sortDir = active && state.sortDir === 'asc' ? 'desc' : 'asc';
              state.sortKey = column.key;
              render();
            },
          }),
        );
      }),
    );

    const body = el('tbody', {}, ...rows.map(rowFor));
    wrap.replaceChildren(el('table', { class: 'variant-table' }, el('thead', {}, head), body));
    if (total === 0)
      wrap.append(
        el('p', { class: 'message-empty', text: 'No variants match the current filters.' }),
      );

    clear(pager);
    pager.append(
      el('span', {
        text:
          total === 0
            ? '0 variants'
            : `Showing ${(page - 1) * 50 + 1}–${(page - 1) * 50 + rows.length} of ${total.toLocaleString('en-US')}`,
      }),
      el('button', {
        class: 'button',
        type: 'button',
        text: 'Previous',
        disabled: page <= 1,
        onclick: () => go(page - 1),
      }),
      el('span', { text: `Page ${page} of ${pageCount}` }),
      el('button', {
        class: 'button',
        type: 'button',
        text: 'Next',
        disabled: page >= pageCount,
        onclick: () => go(page + 1),
      }),
    );
  }

  // Changes page and redraws.
  function go(page) {
    state.page = page;
    render();
  }

  // Builds one table row for a variant (click or Enter/Space selects it).
  function rowFor(v) {
    const style = CLASS_STYLE[v.classification];
    const band = plddtBand(v.plddt);
    const select = () => onSelect(v.clinvarId);
    return el(
      'tr',
      {
        class: `row${v.clinvarId === state.selectedId ? ' selected' : ''}${v.numberingOk ? '' : ' mismatch'}`,
        tabindex: '0',
        'aria-selected': String(v.clinvarId === state.selectedId),
        dataset: { id: v.clinvarId },
        onclick: select,
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
          }
        },
      },
      el('td', {
        text: v.numberingOk ? v.proteinChange : `${v.proteinChange} (numbering mismatch)`,
      }),
      el(
        'td',
        {},
        el('span', {
          class: `pill pill-${style.group}`,
          title: `ClinVar: ${v.clinvarLabel}`,
          text: `${style.glyph} ${v.classification}`,
        }),
      ),
      el('td', { text: v.reviewStatus || 'not available' }),
      el(
        'td',
        {},
        el('span', { text: formatAf(v.gnomad.af) }),
        ' ',
        el('span', { class: `badge badge-${v.rarity}`, text: v.rarity }),
      ),
      el('td', {
        text:
          v.plddt === null
            ? 'not available'
            : `${v.plddt.toFixed(1)}${band ? ` (${band.id.replace('-', ' ')})` : ''}`,
      }),
      el('td', { text: v.gnomad.matchedBy ?? 'not matched' }),
    );
  }

  return {
    // Replaces the data and resets filters' page.
    update(variants) {
      state.variants = variants;
      state.page = 1;
      state.selectedId = null;
      render();
    },
    // Highlights the selected row, switching to the page that contains it and scrolling to it.
    // If the filters are hiding that variant, they are cleared so the selection is never invisible.
    select(variantId) {
      state.selectedId = variantId;
      if (variantId) {
        const known = state.variants.some((v) => v.clinvarId === variantId);
        if (known && pageOfVariant(visible, variantId) === 0) clearFilters();
        const page = pageOfVariant(visible, variantId);
        if (page) state.page = page;
      }
      render();
      root.querySelector('tr.selected')?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    },
    // The variants currently passing the filters, in display order (for CSV export).
    get visible() {
      return visible;
    },
  };
}
