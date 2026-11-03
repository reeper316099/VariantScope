// Shared selection: choosing a variant in the 3D view, plot or table updates all three.
const listeners = new Set();
let selectedId = null;

export const selection = {
  // The ClinVar id of the selected variant, or null.
  get id() {
    return selectedId;
  },
  // Selects a variant (or clears with null) and tells every subscriber which view caused it.
  select(clinvarId, source = 'other') {
    selectedId = clinvarId;
    for (const listener of listeners) listener(clinvarId, source);
  },
  // Registers a listener; returns a function that removes it.
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
