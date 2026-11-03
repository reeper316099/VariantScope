// Search box: validation, example chips and recent searches (stored through the cache layer).
import { cacheGet, cacheSet } from '../core/cache.js';
import { isValidGeneSymbol } from '../core/uniprot.js';
import { clear, el } from './dom.js';

export const EXAMPLE_GENES = ['BRCA1', 'TP53', 'CFTR', 'MLH1'];
const RECENT_KEY = 'recent-searches';
const RECENT_MAX = 8;

// Trims and uppercases the input; returns {ok, symbol} or {ok:false, error}.
export function normalizeSymbol(raw) {
  const symbol = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (symbol === '') return { ok: false, error: 'Enter a human gene symbol, for example BRCA1.' };
  if (!isValidGeneSymbol(symbol)) {
    return {
      ok: false,
      error: 'Gene symbols use only letters, numbers and hyphens (up to 20 characters).',
    };
  }
  return { ok: true, symbol };
}

// Returns the list of recent searches, newest first.
export function getRecent() {
  const saved = cacheGet(RECENT_KEY)?.value;
  return Array.isArray(saved) ? saved.filter(isValidGeneSymbol) : [];
}

// Records a search (moves it to the front, keeps the list short).
export function addRecent(symbol) {
  cacheSet(
    RECENT_KEY,
    [symbol, ...getRecent().filter((s) => s !== symbol)].slice(0, RECENT_MAX),
    null,
  );
}

// Wires the form, example chips and recent list; onSearch(symbol) runs for valid input.
export function initSearch({ form, input, chips, recent, error, onSearch }) {
  // Validates the text and starts a search (shared by Enter, chips and recent links).
  const submit = (raw) => {
    const result = normalizeSymbol(raw);
    error.textContent = result.ok ? '' : result.error;
    input.setAttribute('aria-invalid', String(!result.ok));
    if (!result.ok) return;
    input.value = result.symbol;
    onSearch(result.symbol);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
  });
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
  });

  const geneButton = (symbol) =>
    el('button', { class: 'chip', type: 'button', text: symbol, onclick: () => submit(symbol) });
  chips.replaceChildren(
    el('span', { class: 'chip-label', text: 'Try:' }),
    ...EXAMPLE_GENES.map(geneButton),
  );

  // Redraws the "Recent" list from storage.
  const refreshRecent = () => {
    clear(recent);
    const items = getRecent();
    if (items.length)
      recent.append(el('span', { class: 'chip-label', text: 'Recent:' }), ...items.map(geneButton));
  };
  refreshRecent();
  return { refreshRecent, submit, focus: () => input.focus() };
}
