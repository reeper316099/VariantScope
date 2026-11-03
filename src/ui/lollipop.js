// Lollipop plot (Chart.js, bundled): x = residue, pathogenic above the baseline, benign below,
// height = -log10(gnomAD AF) capped, with a pLDDT strip under the axis and drag-to-zoom.
import { Chart, LinearScale, PointElement, ScatterController, Tooltip } from 'chart.js';
import { formatAf } from '../core/format.js';
import { CLASS_STYLE, NO_PLDDT_COLOR, cssVar, plddtColor } from './palette.js';

Chart.register(ScatterController, LinearScale, PointElement, Tooltip);

// Height cap: absent variants are drawn at the cap; present ones at -log10(AF), at most the cap.
export const HEIGHT_CAP = 7;
// Variants with unknown frequency (gnomAD failed or ambiguous) sit just above/below the baseline.
const UNKNOWN_HEIGHT = 0.5;
const STRIP_HEIGHT = 12;

// Height of a lollipop for a variant (before the sign for pathogenic/benign is applied).
export function lollipopHeight(variant) {
  if (variant.rarity === 'unknown') return UNKNOWN_HEIGHT;
  if (variant.rarity === 'absent' || !variant.gnomad.af) return HEIGHT_CAP;
  return Math.min(HEIGHT_CAP, -Math.log10(variant.gnomad.af));
}

// Creates the chart on `canvas`; onSelect(variantId) is called when a lollipop is clicked.
export function createLollipop(canvas, { onSelect }) {
  const state = {
    variants: [],
    length: 1,
    plddt: null,
    showUncertain: false,
    selectedId: null,
    drag: null,
  };

  // Builds the dataset for one group of classifications.
  const dataset = (label, group, sign, colorVar) => ({
    label,
    group,
    data: [],
    pointRadius: 5,
    pointHoverRadius: 7,
    borderWidth: 2,
    hitRadius: 8,
    colorVar,
  });

  // Plugin 1: draws the stem of every lollipop from the baseline up/down to its head.
  const stems = {
    id: 'stems',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const baseline = scales.y.getPixelForValue(0);
      ctx.save();
      ctx.lineWidth = 1;
      chart.data.datasets.forEach((set, i) => {
        if (!chart.isDatasetVisible(i)) return;
        ctx.strokeStyle = set.stemColor;
        ctx.beginPath();
        chart.getDatasetMeta(i).data.forEach((point) => {
          ctx.moveTo(point.x, baseline);
          ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      });
      ctx.restore();
    },
  };

  // Plugin 2: pLDDT heat strip under the x axis, drawn per pixel column for the visible range.
  const strip = {
    id: 'plddtStrip',
    afterDraw(chart) {
      const { ctx, chartArea, scales, height } = chart;
      const top = height - STRIP_HEIGHT - 4;
      const from = scales.x.min;
      const span = scales.x.max - scales.x.min;
      ctx.save();
      for (let px = Math.floor(chartArea.left); px < chartArea.right; px++) {
        const residue = Math.round(
          from + ((px - chartArea.left) / (chartArea.right - chartArea.left)) * span,
        );
        ctx.fillStyle = state.plddt ? plddtColor(state.plddt[residue - 1]) : NO_PLDDT_COLOR;
        ctx.fillRect(px, top, 1, STRIP_HEIGHT);
      }
      ctx.fillStyle = cssVar('--text-muted');
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('pLDDT', 4, top + STRIP_HEIGHT / 2);
      ctx.restore();
    },
  };

  // Plugin 3: ring around the selected lollipop, and the rubber band while dragging to zoom.
  const overlay = {
    id: 'overlay',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((set, i) => {
        if (!chart.isDatasetVisible(i)) return;
        chart.getDatasetMeta(i).data.forEach((point, index) => {
          if (set.data[index].variant.clinvarId !== state.selectedId) return;
          ctx.save();
          ctx.strokeStyle = '#FACC15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });
      });
    },
    afterDraw(chart) {
      if (!state.drag) return;
      const { ctx, chartArea } = chart;
      const left = Math.min(state.drag.start, state.drag.end);
      ctx.save();
      ctx.fillStyle = 'rgb(18 72 107 / 20%)';
      ctx.fillRect(
        left,
        chartArea.top,
        Math.abs(state.drag.end - state.drag.start),
        chartArea.bottom - chartArea.top,
      );
      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: 'scatter',
    data: { datasets: [] },
    plugins: [stems, strip, overlay],
    options: {
      animation: false,
      maintainAspectRatio: false,
      layout: { padding: { bottom: STRIP_HEIGHT + 8 } },
      interaction: { mode: 'nearest', intersect: true },
      onClick: (_event, elements) => {
        if (state.justDragged || elements.length === 0) return;
        const { datasetIndex, index } = elements[0];
        onSelect(chart.data.datasets[datasetIndex].data[index].variant.clinvarId);
      },
      scales: {
        x: {
          type: 'linear',
          min: 1,
          max: 1,
          title: { display: true, text: 'Residue position' },
          border: { display: true },
        },
        y: {
          min: -HEIGHT_CAP - 0.6,
          max: HEIGHT_CAP + 0.6,
          title: {
            display: true,
            text: ['−log10(gnomAD AF)', 'pathogenic ↑  benign ↓'],
          },
          ticks: { callback: (value) => (Number.isInteger(value) ? Math.abs(value) : '') },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw.variant.proteinChange,
            label: (item) => {
              const v = item.raw.variant;
              return [
                `${v.classification} (ClinVar: ${v.clinvarLabel})`,
                `Review: ${v.reviewStatus || 'not available'}`,
                `gnomAD AF: ${formatAf(v.gnomad.af)} (${v.rarity})`,
              ];
            },
          },
        },
      },
    },
  });

  // Applies the current theme colours to axes, grid and stems.
  const applyTheme = () => {
    const text = cssVar('--text-muted');
    const grid = cssVar('--border');
    for (const axis of ['x', 'y']) {
      const scale = chart.options.scales[axis];
      scale.ticks.color = text;
      scale.title.color = text;
      scale.grid = { color: (ctx) => (axis === 'y' && ctx.tick.value === 0 ? text : grid) };
      scale.border = { color: text };
    }
    chart.data.datasets.forEach((set) => {
      set.stemColor = cssVar(set.colorVar);
    });
    chart.update('none');
  };
  window.addEventListener('vs:theme', applyTheme);

  // Drag-to-zoom: press, drag horizontally, release. A tiny drag counts as a click instead.
  const xOf = (event) => event.clientX - canvas.getBoundingClientRect().left;
  const inArea = (x) => x >= chart.chartArea.left && x <= chart.chartArea.right;
  canvas.addEventListener('pointerdown', (event) => {
    state.justDragged = false;
    if (inArea(xOf(event))) state.drag = { start: xOf(event), end: xOf(event) };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.drag) return;
    state.drag.end = Math.min(chart.chartArea.right, Math.max(chart.chartArea.left, xOf(event)));
    chart.draw();
  });
  window.addEventListener('pointerup', () => {
    const drag = state.drag;
    state.drag = null;
    if (!drag) return;
    if (Math.abs(drag.end - drag.start) > 6) {
      state.justDragged = true;
      const a = chart.scales.x.getValueForPixel(Math.min(drag.start, drag.end));
      const b = chart.scales.x.getValueForPixel(Math.max(drag.start, drag.end));
      chart.options.scales.x.min = Math.max(1, Math.round(a));
      chart.options.scales.x.max = Math.min(
        state.length,
        Math.max(Math.round(b), Math.round(a) + 5),
      );
    }
    chart.update('none');
  });

  // Rebuilds the datasets from state (variants, VUS toggle).
  const rebuild = () => {
    const groups = {
      pathogenic: dataset('Pathogenic / Likely pathogenic', 'pathogenic', 1, '--accent'),
      benign: dataset('Benign / Likely benign', 'benign', -1, '--benign'),
      uncertain: dataset('VUS / Conflicting', 'uncertain', 1, '--vus'),
    };
    for (const variant of state.variants) {
      const style = CLASS_STYLE[variant.classification];
      const set = groups[style.group];
      if (style.group === 'uncertain' && !state.showUncertain) continue;
      const sign = style.group === 'benign' ? -1 : 1;
      set.data.push({ x: variant.position, y: sign * lollipopHeight(variant), variant });
    }
    chart.data.datasets = Object.values(groups).map((set) => ({
      ...set,
      pointStyle: set.data.map((d) => CLASS_STYLE[d.variant.classification].pointStyle),
      pointBackgroundColor: set.data.map((d) =>
        d.variant.rarity === 'unknown' ? 'transparent' : cssVar(set.colorVar),
      ),
      pointBorderColor: cssVar(set.colorVar),
      stemColor: cssVar(set.colorVar),
    }));
    chart.options.scales.x.min = 1;
    chart.options.scales.x.max = state.length;
    chart.update('none');
  };

  return {
    // Shows variants (numbering OK only) for a protein of the given length.
    update({ variants, length, plddt }) {
      Object.assign(state, { variants, length, plddt, selectedId: null });
      rebuild();
      applyTheme();
    },
    // Shows or hides VUS and conflicting lollipops.
    setShowUncertain(show) {
      state.showUncertain = show;
      rebuild();
    },
    // Canvas pixel position of a variant's lollipop head, or null if it is not drawn.
    pointPixel(variantId) {
      for (let i = 0; i < chart.data.datasets.length; i++) {
        const index = chart.data.datasets[i].data.findIndex(
          (d) => d.variant.clinvarId === variantId,
        );
        if (index !== -1) {
          const { x, y } = chart.getDatasetMeta(i).data[index];
          return { x, y };
        }
      }
      return null;
    },
    // Highlights the selected variant with a ring.
    select(variantId) {
      canvas.dataset.selectedId = variantId ?? '';
      state.selectedId = variantId;
      chart.draw();
    },
    // Returns to the full-length view.
    resetZoom() {
      chart.options.scales.x.min = 1;
      chart.options.scales.x.max = state.length;
      chart.update('none');
    },
    // Returns the chart as a PNG data URL (used for the plot download).
    pngDataUrl: () => chart.toBase64Image(),
    destroy() {
      window.removeEventListener('vs:theme', applyTheme);
      chart.destroy();
    },
  };
}
