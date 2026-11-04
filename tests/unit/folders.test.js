// Tests for the folder layout (desktop home page): creating, nesting, moving, deleting, genes in
// several folders, and cleaning up bad stored data.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DEPTH,
  MAX_NAME,
  childFolders,
  createFolder,
  deleteFolder,
  depthOf,
  descendantIds,
  emptyFolders,
  flatFolders,
  folderMoveError,
  foldersOfGene,
  genesIn,
  moveFolder,
  moveGene,
  newFolderId,
  pathTo,
  pruneGenes,
  removeGene,
  renameFolder,
  sanitizeFolders,
  setGeneFolders,
} from '../../src/core/folders.js';
import { loadFolders, saveFolders } from '../../src/core/folderStore.js';

let counter = 0;
// Predictable ids (f000000000001, ...) so tests can name folders.
const nextId = () => `f${String(++counter).padStart(12, '0')}`;

// Builds a state from [name, parentName|null] pairs; returns {state, id: name -> id}.
function build(pairs) {
  let state = emptyFolders();
  const id = {};
  for (const [name, parent] of pairs) {
    const r = createFolder(state, name, parent ? id[parent] : null, nextId);
    expect(r.ok).toBe(true);
    state = r.state;
    id[name] = r.id;
  }
  return { state, id };
}

beforeEach(() => {
  counter = 0;
});

describe('createFolder', () => {
  it('creates top-level and nested folders', () => {
    const { state, id } = build([
      ['Cancer', null],
      ['Breast', 'Cancer'],
    ]);
    expect(state.folders[id.Breast]).toEqual({ id: id.Breast, name: 'Breast', parent: id.Cancer });
    expect(childFolders(state, null).map((f) => f.name)).toEqual(['Cancer']);
    expect(childFolders(state, id.Cancer).map((f) => f.name)).toEqual(['Breast']);
  });

  it('tidies the name and rejects empty, too long and duplicate names', () => {
    const { state } = build([['Cancer', null]]);
    expect(createFolder(state, '   ', null).ok).toBe(false);
    expect(createFolder(state, 'x'.repeat(MAX_NAME + 1), null).error).toMatch(/characters/);
    expect(createFolder(state, 'cancer', null).error).toMatch(/already exists/);
    const ok = createFolder(state, '  Heart   disease ', null, nextId);
    expect(ok.state.folders[ok.id].name).toBe('Heart disease');
  });

  it('allows the same name under different parents', () => {
    const { state, id } = build([
      ['A', null],
      ['B', null],
      ['Notes', 'A'],
    ]);
    expect(createFolder(state, 'Notes', id.B, nextId).ok).toBe(true);
  });

  it('stops at the depth limit and for a missing parent', () => {
    const chain = Array.from({ length: MAX_DEPTH }, (_, i) => [`L${i}`, i ? `L${i - 1}` : null]);
    const { state, id } = build(chain);
    expect(depthOf(state, id[`L${MAX_DEPTH - 1}`])).toBe(MAX_DEPTH);
    expect(createFolder(state, 'Too deep', id[`L${MAX_DEPTH - 1}`]).error).toMatch(/levels/);
    expect(createFolder(state, 'Orphan', 'f999999999999').ok).toBe(false);
  });

  it('does not change the state it was given', () => {
    const before = emptyFolders();
    createFolder(before, 'A', null, nextId);
    expect(before).toEqual(emptyFolders());
  });
});

describe('newFolderId', () => {
  it('makes ids that pass the stored-data check', () => {
    expect(newFolderId()).toMatch(/^f[0-9a-f]{12}$/);
    expect(newFolderId()).not.toBe(newFolderId());
  });
});

describe('renameFolder', () => {
  it('renames, and rejects a name used beside it', () => {
    const { state, id } = build([
      ['A', null],
      ['B', null],
    ]);
    expect(renameFolder(state, id.A, 'B').error).toMatch(/already exists/);
    expect(renameFolder(state, id.A, 'a').ok).toBe(true); // same folder, different case
    expect(renameFolder(state, id.A, 'C').state.folders[id.A].name).toBe('C');
    expect(renameFolder(state, 'f999999999999', 'Z').ok).toBe(false);
  });
});

describe('moveFolder', () => {
  const { state, id } = build([
    ['A', null],
    ['B', 'A'],
    ['C', 'B'],
    ['D', null],
  ]);

  it('moves a folder with everything inside it', () => {
    const moved = moveFolder(state, id.B, id.D);
    expect(moved.ok).toBe(true);
    expect(pathTo(moved.state, id.C).map((f) => f.name)).toEqual(['D', 'B', 'C']);
    expect(moveFolder(state, id.B, null).state.folders[id.B].parent).toBeNull();
  });

  it('refuses to put a folder inside itself or its own subfolder', () => {
    expect(folderMoveError(state, id.A, id.A)).toMatch(/inside itself/);
    expect(folderMoveError(state, id.A, id.C)).toMatch(/inside itself/);
    expect(moveFolder(state, id.A, id.B).ok).toBe(false);
  });

  it('refuses a no-op, a missing target, a name clash and too much depth', () => {
    expect(folderMoveError(state, id.B, id.A)).toMatch(/already there/);
    expect(folderMoveError(state, id.B, 'f999999999999')).toMatch(/gone/);
    const clash = build([
      ['X', null],
      ['Y', null],
      ['Same', 'X'],
    ]);
    const other = createFolder(clash.state, 'Same', clash.id.Y, nextId);
    expect(folderMoveError(other.state, clash.id.Same, clash.id.Y)).toMatch(/already exists/);
    const deep = build(
      Array.from({ length: MAX_DEPTH }, (_, i) => [`L${i}`, i ? `L${i - 1}` : null]),
    );
    const withTop = createFolder(deep.state, 'Top', null, nextId);
    expect(folderMoveError(withTop.state, withTop.id, deep.id[`L${MAX_DEPTH - 1}`])).toMatch(
      /levels/,
    );
  });

  it('lists descendants', () => {
    expect([...descendantIds(state, id.A)].sort()).toEqual([id.B, id.C].sort());
  });
});

describe('genes in folders', () => {
  it('shows ungrouped genes at the top level and grouped genes in their folders', () => {
    const { state, id } = build([['A', null]]);
    const symbols = ['BRCA1', 'TP53'];
    const placed = setGeneFolders(state, 'TP53', [id.A]);
    expect(genesIn(placed, null, symbols)).toEqual(['BRCA1']);
    expect(genesIn(placed, id.A, symbols)).toEqual(['TP53']);
  });

  it('lets a gene be in several folders and ignores unknown ones', () => {
    const { state, id } = build([
      ['A', null],
      ['B', null],
    ]);
    const placed = setGeneFolders(state, 'TP53', [id.A, id.B, id.A, 'f999999999999']);
    expect(foldersOfGene(placed, 'TP53')).toEqual([id.A, id.B]);
    expect(genesIn(placed, id.A, ['TP53'])).toEqual(['TP53']);
    expect(genesIn(placed, id.B, ['TP53'])).toEqual(['TP53']);
    expect(genesIn(setGeneFolders(placed, 'TP53', []), null, ['TP53'])).toEqual(['TP53']);
  });

  it('moves a gene out of one folder and into another', () => {
    const { state, id } = build([
      ['A', null],
      ['B', null],
    ]);
    const inA = moveGene(state, 'TP53', null, id.A).state;
    expect(foldersOfGene(inA, 'TP53')).toEqual([id.A]);
    const inB = moveGene(inA, 'TP53', id.A, id.B).state;
    expect(foldersOfGene(inB, 'TP53')).toEqual([id.B]);
    expect(foldersOfGene(moveGene(inB, 'TP53', id.B, null).state, 'TP53')).toEqual([]);
    expect(moveGene(inB, 'TP53', id.B, 'f999999999999').ok).toBe(false);
  });

  it('keeps the other folders when a gene is moved out of one', () => {
    const { state, id } = build([
      ['A', null],
      ['B', null],
    ]);
    const both = setGeneFolders(state, 'TP53', [id.A, id.B]);
    expect(foldersOfGene(moveGene(both, 'TP53', id.A, null).state, 'TP53')).toEqual([id.B]);
  });

  it('forgets a deleted gene and prunes genes that are no longer saved', () => {
    const { state, id } = build([['A', null]]);
    const placed = setGeneFolders(setGeneFolders(state, 'TP53', [id.A]), 'BRCA1', [id.A]);
    expect(removeGene(placed, 'TP53').placement).toEqual({ BRCA1: [id.A] });
    const pruned = pruneGenes(placed, ['BRCA1']);
    expect(pruned.changed).toBe(true);
    expect(pruned.state.placement).toEqual({ BRCA1: [id.A] });
    expect(pruneGenes(pruned.state, ['BRCA1']).changed).toBe(false);
  });
});

describe('deleteFolder', () => {
  const layout = () => {
    const { state, id } = build([
      ['A', null],
      ['B', 'A'],
      ['C', 'B'],
      ['Other', null],
    ]);
    let s = setGeneFolders(state, 'TP53', [id.A]); // only in A
    s = setGeneFolders(s, 'BRCA1', [id.B, id.Other]); // in B and in Other
    s = setGeneFolders(s, 'CFTR', [id.C]); // only in C
    return { s, id };
  };

  it('deleting only the folder moves subfolders up and keeps every gene saved', () => {
    const { s, id } = layout();
    const r = deleteFolder(s, id.A);
    expect(r.ok).toBe(true);
    expect(r.genesToDelete).toEqual([]);
    expect(r.state.folders[id.A]).toBeUndefined();
    expect(r.state.folders[id.B].parent).toBeNull();
    expect(foldersOfGene(r.state, 'TP53')).toEqual([]); // back at the top level
    expect(foldersOfGene(r.state, 'CFTR')).toEqual([id.C]);
  });

  it('renames a subfolder that would clash when it moves up', () => {
    const { state, id } = build([
      ['A', null],
      ['Notes', null],
      ['Notes', 'A'],
    ]);
    const r = deleteFolder(state, id.A);
    expect(
      Object.values(r.state.folders)
        .map((f) => f.name)
        .sort(),
    ).toEqual(['Notes', 'Notes (2)']);
  });

  it('deleting with contents lists only genes that are in no other folder', () => {
    const { s, id } = layout();
    const r = deleteFolder(s, id.A, { withContents: true });
    expect(r.genesToDelete.sort()).toEqual(['CFTR', 'TP53']);
    expect(Object.keys(r.state.folders)).toEqual([id.Other]);
    expect(foldersOfGene(r.state, 'BRCA1')).toEqual([id.Other]); // kept: still in Other
  });

  it('reports a missing folder and leaves the original state alone', () => {
    const { s, id } = layout();
    expect(deleteFolder(s, 'f999999999999').ok).toBe(false);
    deleteFolder(s, id.A, { withContents: true });
    expect(s.folders[id.A]).toBeDefined();
  });
});

describe('flatFolders and pathTo', () => {
  it('lists folders depth-first with path labels, optionally skipping some', () => {
    const { state, id } = build([
      ['B', null],
      ['A', null],
      ['Sub', 'A'],
    ]);
    expect(flatFolders(state).map((f) => f.label)).toEqual(['A', 'A / Sub', 'B']);
    expect(flatFolders(state, new Set([id.A])).map((f) => f.label)).toEqual(['B']);
    expect(pathTo(state, 'f999999999999')).toEqual([]);
  });
});

describe('sanitizeFolders', () => {
  it('returns an empty layout for junk', () => {
    for (const junk of [null, 5, 'x', [], {}, { folders: 'no' }]) {
      expect(sanitizeFolders(junk)).toEqual(emptyFolders());
    }
  });

  it('keeps valid folders and drops bad ids, names, parents and loops', () => {
    const a = 'f000000000001';
    const b = 'f000000000002';
    const c = 'f000000000003';
    const loopA = 'f0000000000aa';
    const raw = {
      folders: {
        [a]: { id: a, name: 'Good', parent: null },
        [b]: { id: b, name: 'Child', parent: a },
        [c]: { id: c, name: '', parent: null }, // empty name
        bad: { id: 'bad', name: 'Bad id', parent: null },
        f000000000004: { id: 'f000000000004', name: 'Lost', parent: 'f0000000000ff' }, // parent missing
        f000000000005: { id: 'f000000000005', name: 'Mismatch', parent: null, ...{ id: a } },
        [loopA]: { id: loopA, name: 'Loop', parent: loopA }, // its own parent
      },
      placement: {
        TP53: [a, a, 'f0000000000ff'],
        'bad symbol!': [a],
        BRCA1: 'not an array',
        CFTR: ['f0000000000ff'],
      },
    };
    const clean = sanitizeFolders(raw);
    expect(Object.keys(clean.folders).sort()).toEqual([a, b]);
    expect(clean.placement).toEqual({ TP53: [a] });
  });

  it('drops folders nested deeper than the limit', () => {
    const folders = {};
    let parent = null;
    for (let i = 1; i <= MAX_DEPTH + 2; i += 1) {
      const id = `f${String(i).padStart(12, '0')}`;
      folders[id] = { id, name: `L${i}`, parent };
      parent = id;
    }
    expect(Object.keys(sanitizeFolders({ folders, placement: {} }).folders)).toHaveLength(
      MAX_DEPTH,
    );
  });
});

describe('folderStore', () => {
  it('saves and loads, and starts empty', () => {
    saveFolders(emptyFolders());
    expect(loadFolders()).toEqual(emptyFolders());
    const { state } = build([['Cancer', null]]);
    saveFolders(state);
    expect(Object.values(loadFolders().folders).map((f) => f.name)).toEqual(['Cancer']);
    saveFolders(emptyFolders());
  });
});
