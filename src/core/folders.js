// Folders for the desktop home page. A folder is only a label: it never moves or copies gene data,
// so deleting a folder cannot lose a gene unless the person explicitly chooses to delete its genes.
// State shape: { folders: {id: {id, name, parent}}, placement: {SYMBOL: [folderId, ...]} }.
// `parent` is null for top-level folders. A gene with no placement sits at the top level, and a
// gene may be placed in several folders at once. Every function here is pure (it returns a new state).
import { groupFor } from './freshness.js';

export const MAX_DEPTH = 6; // how many folders deep you can nest (top level = depth 1)
export const MAX_NAME = 40; // longest folder name
export const MAX_FOLDERS = 200; // most folders in total (keeps the saved list small)

const ID_PATTERN = /^f[0-9a-f]{12}$/;

// Returns an empty folder state (no folders, every gene at the top level).
export function emptyFolders() {
  return { folders: {}, placement: {} };
}

// Makes a new random folder id such as "f3a9c0d41b7e".
export function newFolderId() {
  return `f${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

// Copies a state so a change never edits the one passed in.
function copy(state) {
  return {
    folders: Object.fromEntries(Object.entries(state.folders).map(([k, f]) => [k, { ...f }])),
    placement: Object.fromEntries(Object.entries(state.placement).map(([k, v]) => [k, [...v]])),
  };
}

// Tidies a typed folder name: collapses spaces and trims the ends.
export function cleanName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Explains why a name cannot be used (empty, too long, or already used beside it), else null.
export function nameError(state, name, parentId, ignoreId = null) {
  const clean = cleanName(name);
  if (clean === '') return 'Type a name for the folder.';
  if (clean.length > MAX_NAME) return `Use ${MAX_NAME} characters or fewer.`;
  const taken = Object.values(state.folders).some(
    (f) =>
      f.id !== ignoreId &&
      f.parent === (parentId ?? null) &&
      f.name.toLowerCase() === clean.toLowerCase(),
  );
  return taken ? 'A folder with that name already exists here.' : null;
}

// Counts the folder itself plus its ancestors (a top-level folder has depth 1).
export function depthOf(state, id) {
  let depth = 0;
  for (let at = state.folders[id]; at && depth <= MAX_DEPTH + 1; at = state.folders[at.parent]) {
    depth += 1;
  }
  return depth;
}

// Returns the ids of every folder inside `id` (children, grandchildren, ...), not `id` itself.
export function descendantIds(state, id) {
  const found = new Set();
  const queue = [id];
  while (queue.length > 0) {
    const at = queue.pop();
    for (const f of Object.values(state.folders)) {
      if (f.parent === at && !found.has(f.id)) {
        found.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return found;
}

// How many levels the folder and everything inside it span (a folder with no subfolders is 1).
function heightOf(state, id) {
  const children = Object.values(state.folders).filter((f) => f.parent === id);
  return 1 + Math.max(0, ...children.map((c) => heightOf(state, c.id)));
}

// The folders directly inside `parentId` (null = top level), A to Z.
export function childFolders(state, parentId = null) {
  return Object.values(state.folders)
    .filter((f) => f.parent === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The folders leading to `id`, from the top level down to the folder itself (for breadcrumbs).
export function pathTo(state, id) {
  const path = [];
  for (let at = state.folders[id]; at && path.length <= MAX_DEPTH; at = state.folders[at.parent]) {
    path.unshift(at);
  }
  return path;
}

// Every folder as a flat, depth-first list [{folder, depth, label}] for pickers; `skip` leaves out
// some ids (and everything inside them).
export function flatFolders(state, skip = new Set()) {
  const out = [];
  const walk = (parentId, depth) => {
    for (const f of childFolders(state, parentId)) {
      if (skip.has(f.id)) continue;
      out.push({
        folder: f,
        depth,
        label: pathTo(state, f.id)
          .map((p) => p.name)
          .join(' / '),
      });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}

// The saved gene symbols shown inside a folder (null = top level: genes with no folder).
export function genesIn(state, folderId, symbols) {
  return symbols.filter((s) => {
    const placed = state.placement[s] ?? [];
    return folderId === null ? placed.length === 0 : placed.includes(folderId);
  });
}

// The folders a gene is placed in.
export function foldersOfGene(state, symbol) {
  return (state.placement[symbol] ?? []).filter((id) => state.folders[id]);
}

// Makes a new folder inside `parentId` (null = top level). Returns {ok, state, id} or {ok:false, error}.
export function createFolder(state, name, parentId = null, newId = newFolderId) {
  if (parentId !== null && !state.folders[parentId]) return fail('That parent folder is gone.');
  const error = nameError(state, name, parentId);
  if (error) return fail(error);
  if (Object.keys(state.folders).length >= MAX_FOLDERS) {
    return fail(`You can have at most ${MAX_FOLDERS} folders.`);
  }
  if (parentId !== null && depthOf(state, parentId) >= MAX_DEPTH) {
    return fail(`Folders can only be nested ${MAX_DEPTH} levels deep.`);
  }
  const next = copy(state);
  const id = newId();
  next.folders[id] = { id, name: cleanName(name), parent: parentId };
  return { ok: true, state: next, id };
}

// A failed result with a message the person can read.
function fail(error) {
  return { ok: false, error };
}

// Renames a folder (the new name must be free beside it).
export function renameFolder(state, id, name) {
  const folder = state.folders[id];
  if (!folder) return fail('That folder is gone.');
  const error = nameError(state, name, folder.parent, id);
  if (error) return fail(error);
  const next = copy(state);
  next.folders[id].name = cleanName(name);
  return { ok: true, state: next };
}

// Checks whether a folder can move under `toParent` (null = top level).
export function folderMoveError(state, id, toParent) {
  const folder = state.folders[id];
  if (!folder) return 'That folder is gone.';
  if (toParent !== null && !state.folders[toParent]) return 'That destination is gone.';
  if (toParent === folder.parent) return 'It is already there.';
  if (toParent === id || (toParent !== null && descendantIds(state, id).has(toParent))) {
    return 'A folder cannot go inside itself.';
  }
  const parentDepth = toParent === null ? 0 : depthOf(state, toParent);
  if (parentDepth + heightOf(state, id) > MAX_DEPTH) {
    return `Folders can only be nested ${MAX_DEPTH} levels deep.`;
  }
  return nameError(state, folder.name, toParent, id);
}

// Moves a folder (with everything inside it) under another folder or to the top level.
export function moveFolder(state, id, toParent) {
  const error = folderMoveError(state, id, toParent);
  if (error) return fail(error);
  const next = copy(state);
  next.folders[id].parent = toParent;
  return { ok: true, state: next };
}

// Finds a free name beside siblings by adding " (2)", " (3)", ...
function freeName(state, name, parentId, ignoreId) {
  if (nameError(state, name, parentId, ignoreId) === null) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = name.slice(0, MAX_NAME - suffix.length) + suffix;
    if (nameError(state, candidate, parentId, ignoreId) === null) return candidate;
  }
}

// Deletes a folder. By default only the folder goes: its subfolders move up one level and its
// genes simply leave it. With `withContents`, its subfolders go too, and `genesToDelete` lists the
// genes that were in no folder outside the deleted ones (the caller deletes their data).
export function deleteFolder(state, id, { withContents = false } = {}) {
  const folder = state.folders[id];
  if (!folder) return fail('That folder is gone.');
  const next = copy(state);
  const gone = withContents ? new Set([id, ...descendantIds(state, id)]) : new Set([id]);
  if (!withContents) {
    for (const child of childFolders(next, id)) {
      next.folders[child.id].parent = folder.parent;
      next.folders[child.id].name = freeName(next, child.name, folder.parent, child.id);
    }
  }
  for (const goneId of gone) delete next.folders[goneId];
  const genesToDelete = [];
  for (const [symbol, ids] of Object.entries(next.placement)) {
    if (!ids.some((i) => gone.has(i))) continue;
    const rest = ids.filter((i) => !gone.has(i));
    if (rest.length > 0) next.placement[symbol] = rest;
    else {
      delete next.placement[symbol];
      if (withContents) genesToDelete.push(symbol);
    }
  }
  return { ok: true, state: next, genesToDelete };
}

// Sets exactly which folders a gene is in (none = top level). Unknown folders are ignored.
export function setGeneFolders(state, symbol, folderIds) {
  const next = copy(state);
  const ids = [...new Set(folderIds)].filter((id) => next.folders[id]);
  if (ids.length > 0) next.placement[symbol] = ids;
  else delete next.placement[symbol];
  return next;
}

// Moves a gene: takes it out of `fromId` (null = it was at the top level) and puts it in `toId`
// (null = just take it out). A gene that was in other folders stays in them.
export function moveGene(state, symbol, fromId, toId) {
  if (toId !== null && !state.folders[toId]) return fail('That folder is gone.');
  const current = state.placement[symbol] ?? [];
  const ids = current.filter((id) => id !== fromId);
  if (toId !== null && !ids.includes(toId)) ids.push(toId);
  return { ok: true, state: setGeneFolders(state, symbol, ids) };
}

// Forgets a gene's folders (used when the gene itself is deleted).
export function removeGene(state, symbol) {
  return setGeneFolders(state, symbol, []);
}

// Drops placements of genes that are no longer saved. Returns {state, changed}.
export function pruneGenes(state, symbols) {
  const known = new Set(symbols);
  const next = copy(state);
  let changed = false;
  for (const symbol of Object.keys(next.placement)) {
    if (!known.has(symbol)) {
      delete next.placement[symbol];
      changed = true;
    }
  }
  return { state: next, changed };
}

// Turns anything read from storage into a valid state: bad ids, names, parents, loops, too-deep
// folders and unknown placements are dropped instead of trusted.
export function sanitizeFolders(raw) {
  const out = emptyFolders();
  if (!raw || typeof raw !== 'object' || !raw.folders || typeof raw.folders !== 'object')
    return out;
  const candidates = {};
  for (const [key, f] of Object.entries(raw.folders)) {
    const name = typeof f?.name === 'string' ? cleanName(f.name) : '';
    const valid = ID_PATTERN.test(key) && f?.id === key && name !== '' && name.length <= MAX_NAME;
    if (valid && (f.parent === null || ID_PATTERN.test(f.parent))) {
      candidates[key] = { id: key, name, parent: f.parent };
    }
  }
  // Keep a folder only if following its parents reaches the top level within MAX_DEPTH steps.
  const reachesTop = (id) => {
    let at = candidates[id];
    for (let steps = 1; at && steps <= MAX_DEPTH; steps += 1) {
      if (at.parent === null) return true;
      at = candidates[at.parent];
    }
    return false;
  };
  for (const id of Object.keys(candidates)) {
    if (Object.keys(out.folders).length >= MAX_FOLDERS) break;
    if (reachesTop(id)) out.folders[id] = candidates[id];
  }
  out.folders = Object.fromEntries(
    Object.entries(out.folders).filter(([, f]) => f.parent === null || out.folders[f.parent]),
  );
  if (raw.placement && typeof raw.placement === 'object') {
    for (const [symbol, ids] of Object.entries(raw.placement)) {
      if (groupFor(symbol) === null || !Array.isArray(ids)) continue;
      const kept = [...new Set(ids)].filter((id) => out.folders[id]);
      if (kept.length > 0) out.placement[symbol] = kept;
    }
  }
  return out;
}
