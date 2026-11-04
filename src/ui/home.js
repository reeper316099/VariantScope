// Home page: the saved genes (the library) as cards with Open, Refresh and Delete.
import { NOT_AVAILABLE, formatAge, formatBytes, formatCount } from '../core/format.js';
import { entryOutOfDate } from '../core/library.js';
import { el, fill } from './dom.js';

// A button that needs a second click within 4 seconds to confirm (used for deleting).
function confirmButton(label, confirmLabel, onConfirm, ariaLabel) {
  let timer = null;
  const button = el('button', {
    class: 'button button-danger',
    type: 'button',
    text: label,
    'aria-label': ariaLabel,
    onclick: () => {
      if (timer === null) {
        button.textContent = confirmLabel;
        timer = setTimeout(() => {
          timer = null;
          button.textContent = label;
        }, 4000);
        return;
      }
      clearTimeout(timer);
      timer = null;
      onConfirm();
    },
  });
  return button;
}

// Builds the card for one saved gene.
function geneCard(entry, bytes, { onOpen, onRefresh, onDelete }) {
  const outOfDate = entryOutOfDate(entry);
  const facts = [
    `Saved ${formatAge(entry.savedAt)}`,
    entry.analysed === null
      ? `Variants analysed: ${NOT_AVAILABLE}`
      : `${formatCount(entry.analysed)} variants analysed`,
    entry.pathogenicPct === null
      ? `Pathogenic share: ${NOT_AVAILABLE}`
      : `${entry.pathogenicPct.toFixed(1)}% pathogenic or likely pathogenic`,
    bytes === null ? `Size: ${NOT_AVAILABLE}` : formatBytes(bytes),
  ];
  return el(
    'li',
    { class: 'gene-card', dataset: { symbol: entry.symbol } },
    el(
      'div',
      { class: 'gene-card-head' },
      el('h3', { text: entry.symbol }),
      outOfDate ? el('span', { class: 'badge badge-outdated', text: 'Out of date' }) : null,
      entry.partial ? el('span', { class: 'badge badge-partial', text: 'Incomplete' }) : null,
    ),
    el('p', { class: 'muted', text: entry.proteinName ?? NOT_AVAILABLE }),
    el('ul', { class: 'gene-card-facts' }, ...facts.map((text) => el('li', { text }))),
    el(
      'div',
      { class: 'gene-card-actions' },
      el('button', {
        class: 'button button-primary',
        type: 'button',
        text: 'Open',
        'aria-label': `Open ${entry.symbol}`,
        onclick: () => onOpen(entry.symbol),
      }),
      el('button', {
        class: 'button',
        type: 'button',
        text: 'Refresh',
        'aria-label': `Refresh ${entry.symbol} (download the latest data)`,
        onclick: () => onRefresh(entry.symbol),
      }),
      confirmButton(
        'Delete',
        'Click again to delete',
        () => onDelete(entry.symbol),
        `Delete ${entry.symbol}`,
      ),
    ),
  );
}

// Fills the saved-genes list. `entries` are already sorted; `sizes` maps symbol -> bytes.
export function renderHome(parts, { entries, sizes, totalBytes, onOpen, onRefresh, onDelete }) {
  const { list, empty, storage, clearButton } = parts;
  empty.hidden = entries.length > 0;
  clearButton.hidden = entries.length === 0;
  storage.textContent =
    entries.length === 0
      ? ''
      : `${formatCount(entries.length)} saved ${entries.length === 1 ? 'gene' : 'genes'}, ${formatBytes(totalBytes)} in total. Genes are saved automatically when you open them, and stay until you delete them.`;
  fill(
    list,
    entries.map((entry) =>
      geneCard(entry, sizes.get(entry.symbol) ?? null, { onOpen, onRefresh, onDelete }),
    ),
  );
}

// Makes the "Delete all" button ask for a second click, then run onConfirm.
export function armDeleteAll(button, onConfirm) {
  const label = button.textContent;
  let timer = null;
  button.addEventListener('click', () => {
    if (timer === null) {
      button.textContent = 'Click again to delete all';
      timer = setTimeout(() => {
        timer = null;
        button.textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    timer = null;
    button.textContent = label;
    onConfirm();
  });
}
