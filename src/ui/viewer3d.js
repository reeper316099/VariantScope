// 3D viewer (3Dmol.js, bundled; loaded on first use). Cartoon coloured by pLDDT, variants as
// spheres on C-alpha atoms, click/hover, smooth zoom to a selected residue.
import { densityWindows } from '../core/stats.js';
import { CLASS_STYLE, cssVar, densityColor, plddtBand, plddtColor } from './palette.js';
import { formatAf } from '../core/format.js';

const SPHERE_RADIUS = { pathogenic: 1.3, benign: 1.0, uncertain: 0.8 };
const SEVERITY = [
  'Pathogenic',
  'Likely pathogenic',
  'Conflicting',
  'VUS',
  'Likely benign',
  'Benign',
];

// Loads the 3Dmol ES module the first time it is needed (keeps the first page load small).
let libraryPromise;
function loadLibrary() {
  libraryPromise ??= import('3dmol/build/3Dmol.es6.js');
  return libraryPromise;
}

// True if the user asked the system to reduce motion.
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Creates a viewer inside `container`; onSelect(variantId) is called when a sphere is clicked.
export async function createStructureViewer(container, { onSelect }) {
  const $3Dmol = await loadLibrary();
  const viewer = $3Dmol.createViewer(container, {
    backgroundColor: cssVar('--viewer-bg') || '#ffffff',
  });
  const tooltip = document.createElement('div');
  tooltip.className = 'viewer-tooltip';
  tooltip.hidden = true;
  container.append(tooltip);

  const state = {
    colorMode: 'plddt', // 'plddt' | 'density' | 'plain'
    showBenign: false,
    showUncertain: false,
    variants: [],
    byResidue: new Map(), // position -> variants at that residue (numbering OK only)
    plddt: null,
    density: null,
    length: 0,
    selectedId: null,
    label: null,
    spinning: false,
    loaded: false,
  };

  // Returns the colour of one atom for the current colour mode (3Dmol calls this per atom).
  const colorOf = (atom) => {
    if (state.colorMode === 'density' && state.density) {
      return densityColor(
        state.density.max ? state.density.counts[atom.resi - 1] / state.density.max : 0,
      );
    }
    if (state.colorMode === 'plain') return '#9CA3AF';
    return plddtColor(atom.b); // AlphaFold stores pLDDT in the B-factor column
  };

  // Variants whose spheres are currently visible, grouped by sphere group.
  const visibleGroups = () => {
    const groups = { pathogenic: new Set(), benign: new Set(), uncertain: new Set() };
    for (const v of state.variants) {
      const group = CLASS_STYLE[v.classification].group;
      if (group === 'benign' && !state.showBenign) continue;
      if (group === 'uncertain' && !state.showUncertain) continue;
      groups[group].add(v.position);
    }
    return groups;
  };

  // Redraws cartoon colours and variant spheres from the current state.
  const restyle = () => {
    if (!state.loaded) return;
    viewer.setStyle({}, { cartoon: { colorfunc: colorOf } });
    const groups = visibleGroups();
    // Draw least severe first so pathogenic spheres end up on top.
    for (const group of ['uncertain', 'benign', 'pathogenic']) {
      if (groups[group].size === 0) continue;
      const color = { pathogenic: '#FF6B6B', benign: '#22C55E', uncertain: '#94A3B8' }[group];
      viewer.addStyle(
        { resi: [...groups[group]], atom: 'CA' },
        { sphere: { radius: SPHERE_RADIUS[group], color } },
      );
    }
    const selected = state.variants.find((v) => v.clinvarId === state.selectedId);
    if (selected) {
      viewer.addStyle(
        { resi: [selected.position], atom: 'CA' },
        { sphere: { radius: 2.1, color: '#FACC15', opacity: 0.85 } },
      );
    }
    viewer.render();
  };

  // Builds the hover text for a residue: its pLDDT and any variants at that position.
  const describeResidue = (atom) => {
    const lines = [
      `${atom.resn} ${atom.resi}`,
      `pLDDT ${atom.b.toFixed(1)}${plddtBand(atom.b) ? ` (${plddtBand(atom.b).label})` : ''}`,
    ];
    for (const v of state.byResidue.get(atom.resi) ?? []) {
      lines.push(`${v.proteinChange}: ${v.classification}, gnomAD AF ${formatAf(v.gnomad.af)}`);
    }
    return lines;
  };

  // Picks the most severe variant at a residue (used when a sphere is clicked).
  const representative = (position) => {
    const here = state.byResidue.get(position) ?? [];
    return (
      [...here].sort(
        (a, b) => SEVERITY.indexOf(a.classification) - SEVERITY.indexOf(b.classification),
      )[0] ?? null
    );
  };

  // Is a residue showing a sphere right now? (Hidden groups are not clickable.)
  const isVisibleResidue = (position) => {
    const groups = visibleGroups();
    return (
      groups.pathogenic.has(position) ||
      groups.benign.has(position) ||
      groups.uncertain.has(position)
    );
  };

  viewer.setClickable({ atom: 'CA' }, true, (atom) => {
    if (!isVisibleResidue(atom.resi)) return;
    const variant = representative(atom.resi);
    if (variant) onSelect(variant.clinvarId);
  });
  viewer.setHoverable(
    { atom: 'CA' },
    true,
    (atom, _viewer, event) => {
      tooltip.replaceChildren(
        ...describeResidue(atom).map((line) =>
          Object.assign(document.createElement('div'), { textContent: line }),
        ),
      );
      const box = container.getBoundingClientRect();
      tooltip.style.setProperty(
        'left',
        `${Math.min(event.clientX - box.left + 12, box.width - 220)}px`,
      );
      tooltip.style.setProperty('top', `${event.clientY - box.top + 12}px`);
      tooltip.hidden = false;
    },
    () => {
      tooltip.hidden = true;
    },
  );

  const resizeObserver = new ResizeObserver(() => viewer.resize());
  resizeObserver.observe(container);
  const onTheme = () => {
    viewer.setBackgroundColor(cssVar('--viewer-bg') || '#ffffff', 1);
    viewer.render();
  };
  window.addEventListener('vs:theme', onTheme);
  const onFullscreen = () => viewer.resize();
  document.addEventListener('fullscreenchange', onFullscreen);

  return {
    // Loads a structure and the variants to show on it (only variants with matching numbering).
    load({ pdbText, variants, plddt, length }) {
      viewer.clear();
      viewer.addModel(pdbText, 'pdb');
      state.variants = variants;
      state.byResidue = new Map();
      for (const v of variants)
        state.byResidue.set(v.position, [...(state.byResidue.get(v.position) ?? []), v]);
      state.plddt = plddt;
      state.length = length;
      state.density = densityWindows(
        variants
          .filter((v) => CLASS_STYLE[v.classification].group === 'pathogenic')
          .map((v) => v.position),
        length,
      );
      state.selectedId = null;
      state.label = null;
      state.loaded = true;
      restyle();
      viewer.zoomTo();
      viewer.render();
    },

    // Switches the cartoon colouring: 'plddt' | 'density' | 'plain'.
    setColorMode(mode) {
      state.colorMode = mode;
      restyle();
    },

    // Shows or hides benign and VUS/conflicting spheres.
    setVisibility({ benign, uncertain }) {
      state.showBenign = benign;
      state.showUncertain = uncertain;
      restyle();
    },

    // Highlights a variant (or clears with null), shows its label and smoothly zooms to it.
    select(variantId) {
      state.selectedId = variantId;
      if (state.label) viewer.removeLabel(state.label);
      state.label = null;
      const variant = state.variants.find((v) => v.clinvarId === variantId);
      restyle();
      if (!variant) return;
      state.label = viewer.addLabel(
        variant.proteinChange,
        {
          fontSize: 14,
          fontColor: '#ffffff',
          backgroundColor: '#0B1F3A',
          backgroundOpacity: 0.9,
          borderColor: '#FACC15',
          borderThickness: 1.5,
          inFront: true,
        },
        { resi: [variant.position], atom: 'CA' },
      );
      // Zoom to a 21-residue neighbourhood so the surrounding fold stays visible.
      const from = Math.max(1, variant.position - 10);
      const to = Math.min(state.length, variant.position + 10);
      viewer.zoomTo({ resi: `${from}-${to}` }, reducedMotion() ? 0 : 700);
      viewer.render();
    },

    // Resets the camera to show the whole protein.
    reset() {
      viewer.zoomTo({}, reducedMotion() ? 0 : 400);
      viewer.render();
    },

    // Starts or stops automatic rotation; returns whether it is now spinning.
    toggleSpin() {
      state.spinning = !state.spinning;
      if (state.spinning) viewer.spin('y', 1);
      else viewer.spin(false);
      return state.spinning;
    },

    // Enters or leaves fullscreen for the viewer card.
    toggleFullscreen(target) {
      if (document.fullscreenElement) return document.exitFullscreen();
      return target.requestFullscreen();
    },

    // Returns the current view as a PNG data URL.
    pngDataUrl() {
      viewer.render();
      return viewer.pngURI();
    },

    // Frees listeners (viewer itself is garbage collected with its container).
    destroy() {
      resizeObserver.disconnect();
      window.removeEventListener('vs:theme', onTheme);
      document.removeEventListener('fullscreenchange', onFullscreen);
      viewer.clear();
    },
  };
}
