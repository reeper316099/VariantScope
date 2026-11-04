// Home page: the saved genes (the library) as cards with Open, Refresh and Delete.
import { NOT_AVAILABLE, formatAge, formatBytes, formatCount } from '../core/format.js';
import {
  MAX_NAME,
  childFolders,
  cleanName,
  deleteFolder,
  descendantIds,
  flatFolders,
  folderMoveError,
  foldersOfGene,
  genesIn,
  pathTo,
} from '../core/folders.js';
import { entryOutOfDate } from '../core/library.js';
import { el, fill } from './dom.js';
import { openDialog } from './dialog.js';

// What is being dragged right now (set on dragstart, cleared on dragend); null when nothing is.
let dragging = null;

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
function geneCard(entry, bytes, { onOpen, onRefresh, onDelete }, view = null) {
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
    {
      class: 'gene-card',
      dataset: { symbol: entry.symbol },
      draggable: view ? 'true' : null,
      ondragstart: view
        ? (event) => startDrag(event, { type: 'gene', symbol: entry.symbol, from: view.currentId })
        : null,
      ondragend: view ? endDrag : null,
    },
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
      view
        ? el('button', {
            class: 'button',
            type: 'button',
            text: 'Folders\u2026',
            'aria-label': `Choose the folders for ${entry.symbol}`,
            onclick: (event) => openGeneFolders(view, entry.symbol, event.currentTarget),
          })
        : null,
      confirmButton(
        'Delete',
        'Click again to delete',
        () => onDelete(entry.symbol),
        `Delete ${entry.symbol}`,
      ),
    ),
  );
}

// ---------- Folders (desktop app only: renderHome gets a `view` only there) ----------

// Starts dragging a gene or folder card (the id is also set as text so the drag is valid everywhere).
function startDrag(event, payload) {
  dragging = payload;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', payload.type === 'gene' ? payload.symbol : payload.id);
  event.currentTarget.classList.add('is-dragging');
}

// Ends a drag and clears the highlighting.
function endDrag(event) {
  dragging = null;
  event.currentTarget.classList.remove('is-dragging');
  document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
}

// True if what is being dragged may be dropped on folder `targetId` (null = top level).
function canDrop(view, targetId) {
  if (!dragging) return false;
  if (dragging.type === 'gene') return targetId !== dragging.from;
  return folderMoveError(view.state, dragging.id, targetId) === null;
}

// Makes a card or breadcrumb accept dropped genes and folders (drop = move into that folder).
function makeDropTarget(node, view, targetId) {
  node.addEventListener('dragover', (event) => {
    if (!canDrop(view, targetId)) return;
    event.preventDefault();
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    node.classList.remove('drop-target');
    const item = dragging;
    const allowed = canDrop(view, targetId); // check before clearing what is being dragged
    dragging = null;
    if (!item || !allowed) return;
    if (item.type === 'gene') view.onMoveGene(item.symbol, item.from, targetId);
    else view.onMoveFolder(item.id, targetId);
  });
}

// Opens a dialog asking for a folder name; `submit(name)` returns an error message or null.
function nameDialog({ title, initial = '', submitLabel, submit, opener }) {
  const input = el('input', {
    type: 'text',
    class: 'dialog-input',
    value: initial,
    maxlength: String(MAX_NAME),
    'aria-label': 'Folder name',
  });
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const dialog = openDialog({
    title,
    opener,
    body: [input, error],
    actions: [
      {
        label: submitLabel,
        primary: true,
        onClick: async () => {
          const message = await submit(cleanName(input.value));
          error.textContent = message ?? '';
          return message === null || message === undefined;
        },
      },
    ],
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dialog.querySelector('.button-primary').click();
  });
  input.focus();
  input.select();
}

// The path-style labels of the folders offered in a picker (e.g. "Cancer / Breast").
function labelled(
  inputType,
  name,
  id,
  text,
  { checked = false, disabled = false, hint = '' } = {},
) {
  return el(
    'label',
    { class: 'dialog-choice', title: hint || null },
    el('input', {
      type: inputType,
      name,
      value: id ?? '',
      checked: checked ? true : null,
      disabled: disabled ? true : null,
    }),
    el('span', { text }),
  );
}

// Dialog to tick which folders a gene belongs to (none ticked = top level).
function openGeneFolders(view, symbol, opener) {
  const all = flatFolders(view.state);
  const mine = new Set(foldersOfGene(view.state, symbol));
  const body =
    all.length === 0
      ? [el('p', { class: 'muted', text: 'You have no folders yet. Use "New folder" first.' })]
      : [
          el('p', {
            class: 'muted',
            text: 'A gene can be in several folders. With none ticked it stays at the top level.',
          }),
          el(
            'div',
            { class: 'dialog-list' },
            ...all.map(({ folder, label }) =>
              labelled('checkbox', 'gene-folder', folder.id, label, {
                checked: mine.has(folder.id),
              }),
            ),
          ),
        ];
  const dialog = openDialog({
    title: `Folders for ${symbol}`,
    opener,
    body,
    actions:
      all.length === 0
        ? []
        : [
            {
              label: 'Save',
              primary: true,
              onClick: () => {
                const ids = [...dialog.querySelectorAll('input:checked')].map((i) => i.value);
                view.onSetGeneFolders(symbol, ids);
              },
            },
          ],
  });
}

// Dialog to pick where a folder goes (the top level or another folder that is allowed).
function openMoveFolder(view, folder, opener) {
  const skip = new Set([folder.id, ...descendantIds(view.state, folder.id)]);
  const options = flatFolders(view.state, skip);
  const choices = [
    { id: null, label: 'All genes (top level)' },
    ...options.map(({ folder: f, label }) => ({ id: f.id, label })),
  ].map(({ id, label }) => {
    const error = id === folder.parent ? null : folderMoveError(view.state, folder.id, id);
    return labelled('radio', 'move-to', id, label, {
      checked: id === folder.parent,
      disabled: error !== null,
      hint: error ?? '',
    });
  });
  const message = el('p', { class: 'dialog-error', role: 'alert' });
  const dialog = openDialog({
    title: `Move "${folder.name}" to\u2026`,
    opener,
    body: [el('div', { class: 'dialog-list' }, ...choices), message],
    actions: [
      {
        label: 'Move',
        primary: true,
        onClick: () => {
          const value = dialog.querySelector('input[name="move-to"]:checked')?.value;
          const to = value === undefined || value === '' ? null : value;
          if (to === folder.parent) return true;
          const error = view.onMoveFolder(folder.id, to);
          message.textContent = error ?? '';
          return !error;
        },
      },
    ],
  });
}

// Dialog asking what to do when deleting a folder: only the folder, or also what is inside it.
function openDeleteFolder(view, folder, opener) {
  const subfolders = descendantIds(view.state, folder.id).size;
  const { genesToDelete } = deleteFolder(view.state, folder.id, { withContents: true });
  const parts = [];
  if (subfolders > 0) parts.push(`${subfolders} ${subfolders === 1 ? 'subfolder' : 'subfolders'}`);
  if (genesToDelete.length > 0) {
    parts.push(
      `${genesToDelete.length} saved ${genesToDelete.length === 1 ? 'gene' : 'genes'} (${genesToDelete.join(', ')})`,
    );
  }
  const actions = [
    {
      label: 'Delete folder only',
      danger: true,
      onClick: () => view.onDeleteFolder(folder.id, false),
    },
  ];
  if (parts.length > 0) {
    actions.push({
      label: `Delete folder and ${parts.length === 2 || genesToDelete.length === 0 ? 'everything inside' : 'its genes'}`,
      danger: true,
      onClick: () => view.onDeleteFolder(folder.id, true),
    });
  }
  openDialog({
    title: `Delete "${folder.name}"?`,
    opener,
    body: [
      el('p', {
        text: 'Deleting only the folder keeps your genes: its subfolders move up one level and its genes stay saved.',
      }),
      parts.length > 0
        ? el('p', {
            text: `Inside it (and in no other folder): ${parts.join(' and ')}. "Delete folder and everything inside" also deletes those, and the saved gene data cannot be brought back.`,
          })
        : null,
    ],
    actions,
  });
}

// The "All genes > Cancer > Breast" path; each earlier step is a button and accepts drops.
function breadcrumbs(view) {
  const path = pathTo(view.state, view.currentId);
  const crumb = (id, text) => {
    const button = el('button', {
      class: 'crumb',
      type: 'button',
      text,
      dataset: { folder: id ?? '' },
      onclick: () => view.onNavigate(id),
    });
    makeDropTarget(button, view, id);
    return el('li', {}, button);
  };
  const items = [crumb(null, 'All genes')];
  path.forEach((f, i) => {
    items.push(
      i === path.length - 1
        ? el('li', {}, el('span', { class: 'crumb-current', 'aria-current': 'page', text: f.name }))
        : crumb(f.id, f.name),
    );
  });
  if (path.length === 0) {
    items[0] = el(
      'li',
      {},
      el('span', { class: 'crumb-current', 'aria-current': 'page', text: 'All genes' }),
    );
  }
  return el('nav', { 'aria-label': 'Folder path' }, el('ol', { class: 'crumbs' }, ...items));
}

// The toolbar: where you are, plus the New folder button.
function folderToolbar(view) {
  return [
    breadcrumbs(view),
    el('button', {
      class: 'button button-small',
      type: 'button',
      id: 'new-folder',
      text: 'New folder',
      onclick: (event) =>
        nameDialog({
          title: view.currentId ? 'New folder inside this one' : 'New folder',
          submitLabel: 'Create',
          opener: event.currentTarget,
          submit: (name) => view.onCreateFolder(name, view.currentId),
        }),
    }),
  ];
}

// Builds the card for one folder (open, rename, move, delete; draggable; accepts drops).
function folderCard(view, folder) {
  const genes = genesIn(view.state, folder.id, view.symbols).length;
  const subfolders = childFolders(view.state, folder.id).length;
  const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
  const card = el(
    'li',
    {
      class: 'gene-card folder-card',
      dataset: { folder: folder.id, name: folder.name },
      draggable: 'true',
      ondragstart: (event) => startDrag(event, { type: 'folder', id: folder.id }),
      ondragend: endDrag,
    },
    el(
      'div',
      { class: 'gene-card-head' },
      el('h3', { text: folder.name }),
      el('span', { class: 'badge', text: 'Folder' }),
    ),
    el(
      'ul',
      { class: 'gene-card-facts' },
      el('li', { text: plural(genes, 'gene') }),
      el('li', { text: plural(subfolders, 'subfolder') }),
    ),
    el(
      'div',
      { class: 'gene-card-actions' },
      el('button', {
        class: 'button button-primary',
        type: 'button',
        text: 'Open',
        'aria-label': `Open folder ${folder.name}`,
        onclick: () => view.onNavigate(folder.id),
      }),
      el('button', {
        class: 'button',
        type: 'button',
        text: 'Rename',
        'aria-label': `Rename folder ${folder.name}`,
        onclick: (event) =>
          nameDialog({
            title: `Rename "${folder.name}"`,
            initial: folder.name,
            submitLabel: 'Rename',
            opener: event.currentTarget,
            submit: (name) => view.onRenameFolder(folder.id, name),
          }),
      }),
      el('button', {
        class: 'button',
        type: 'button',
        text: 'Move to\u2026',
        'aria-label': `Move folder ${folder.name}`,
        onclick: (event) => openMoveFolder(view, folder, event.currentTarget),
      }),
      el('button', {
        class: 'button button-danger',
        type: 'button',
        text: 'Delete',
        'aria-label': `Delete folder ${folder.name}`,
        onclick: (event) => openDeleteFolder(view, folder, event.currentTarget),
      }),
    ),
  );
  makeDropTarget(card, view, folder.id);
  return card;
}

// Fills the saved-genes list. `entries` are already sorted (and, with folders, limited to the
// current folder); `sizes` maps symbol -> bytes. `view` is only given by the desktop app and turns
// on folders: {state, currentId, symbols, on... handlers}. Without it this is the plain flat list.
export function renderHome(
  parts,
  {
    entries,
    sizes,
    totalBytes,
    totalCount = entries.length,
    onOpen,
    onRefresh,
    onDelete,
    view = null,
  },
) {
  const { list, empty, storage, clearButton, toolbar } = parts;
  const folders = view ? childFolders(view.state, view.currentId) : [];
  empty.hidden = entries.length > 0 || folders.length > 0;
  empty.dataset.original ??= empty.textContent;
  if (view && view.currentId !== null) {
    empty.textContent =
      'This folder is empty. Drag a gene here, or use "Folders\u2026" on a gene card.';
  } else {
    empty.textContent = empty.dataset.original;
  }
  clearButton.hidden = totalCount === 0;
  if (toolbar) fill(toolbar, view ? folderToolbar(view) : []);
  storage.textContent =
    totalCount === 0
      ? ''
      : `${formatCount(totalCount)} saved ${totalCount === 1 ? 'gene' : 'genes'}, ${formatBytes(totalBytes)} in total. Genes are saved automatically when you open them, and stay until you delete them.`;
  fill(list, [
    ...folders.map((folder) => folderCard(view, folder)),
    ...entries.map((entry) =>
      geneCard(entry, sizes.get(entry.symbol) ?? null, { onOpen, onRefresh, onDelete }, view),
    ),
  ]);
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
