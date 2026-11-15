// editorial/geometry.ts — the whole-pixel geometry of a flow for one viewport: the body grid (the
// baseline unit, column count and width, gap, margins, measure) and the frames of each page. This is
// the one place where a relative FlowSpec becomes pixels, so the layout engine and the renderer read
// the same numbers. Pure: the only measurement is one sample string asked of the Measurer.

import type { BodyGrid, FlowMode, FlowSpec, Measurer, PageGeometry, Rect, Size } from './types';

/** Sample whose average character width calibrates the body font. */
const SAMPLE = 'the quick brown fox jumps over the lazy dog and packs my box with five dozen liquor jugs';
/** Average character width, in em, used when the measurer reports no usable width. */
const FALLBACK_CHAR_EM = 0.5;
/** Most passes of the size ↔ column-count fixed point. */
const MAX_PASSES = 4;
/** A page shorter than this many lines is too short to page and is laid out unbounded. */
const MIN_PAGE_LINES = 4;

interface GridPass {
  columns: number;
  columnWidth: number;
  /** The body size the accepted column count implies. */
  sizeN: number;
  lineHeight: number;
  gap: number;
  margin: BodyGrid['margin'];
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** E8(a): a pair of margins never takes more than 40% of its axis. An over-large pair is scaled down
 *  in proportion, to whole pixels that add up to exactly 40%. */
function limitMargins(margin: BodyGrid['margin'], viewport: Size): BodyGrid['margin'] {
  const limited = (a: number, b: number, axis: number): [number, number] => {
    const most = Math.floor(0.4 * axis);
    if (a + b <= most) return [a, b];
    const first = Math.round((most * a) / (a + b));
    return [first, most - first];
  };
  const [left, right] = limited(margin.left, margin.right, viewport.width);
  const [top, bottom] = limited(margin.top, margin.bottom, viewport.height);
  return { top, right, bottom, left };
}

export function resolveBodyGrid(spec: FlowSpec, viewport: Size, measurer: Measurer): BodyGrid {
  const { family, weight, leading } = spec.body;
  const [measureMin, measureIdeal] = spec.grid.measure;
  const [marginTop, marginRight, marginBottom, marginLeft] = spec.grid.margin;
  const minSize = Math.max(1, Math.round(spec.grid.bodySize[0]));
  const maxSize = Math.round(spec.grid.bodySize[1]);
  const maxColumns = Math.max(1, Math.floor(spec.grid.maxColumns));

  const sampleWidth = measurer.naturalWidth(SAMPLE, { family, weight, style: 'normal', size: 100 });
  const measured = sampleWidth / (SAMPLE.length * 100);
  const charEm = Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_CHAR_EM;

  const pass = (size: number): GridPass => {
    const lineHeight = Math.max(1, Math.round(size * leading));
    const gap = Math.max(1, Math.round(spec.grid.gap * lineHeight));
    const margin = limitMargins(
      {
        top: Math.round(marginTop * lineHeight),
        right: Math.round(marginRight * lineHeight),
        bottom: Math.round(marginBottom * lineHeight),
        left: Math.round(marginLeft * lineHeight),
      },
      viewport,
    );
    const contentWidth = viewport.width - margin.left - margin.right;
    const judge = (columns: number) => {
      const columnWidth = Math.max(1, Math.floor((contentWidth - (columns - 1) * gap) / columns));
      // E8(b): a line holds at least eight characters, so the size gives way to the column width.
      const fitting = Math.max(1, Math.floor(columnWidth / (8 * charEm)));
      const sizeN = Math.min(clamp(Math.round(columnWidth / (measureIdeal * charEm)), minSize, maxSize), fitting);
      return { columnWidth, sizeN, chars: columnWidth / (sizeN * charEm) };
    };
    for (let columns = maxColumns; columns > 1; columns--) {
      const candidate = judge(columns);
      if (candidate.chars >= measureMin) {
        return { columns, columnWidth: candidate.columnWidth, sizeN: candidate.sizeN, lineHeight, gap, margin };
      }
    }
    const single = judge(1);
    return { columns: 1, columnWidth: single.columnWidth, sizeN: single.sizeN, lineHeight, gap, margin };
  };

  // Size and column count depend on each other: repeat at most MAX_PASSES times. The grid is built
  // from the size that was passed in, so its line height is always round(size * leading).
  let size = maxSize;
  let used = size;
  let result = pass(used);
  for (let i = 0; i < MAX_PASSES; i++) {
    used = size;
    result = pass(used);
    if (result.sizeN === used) break;
    size = result.sizeN;
  }

  const charsPerLine = result.columnWidth / (used * charEm);
  // A1: a line never exceeds the measure maximum. A wider column is narrowed to it and the columns
  // are centred in the content width, the slack shared between the two margins.
  if (charsPerLine > spec.grid.measure[2]) {
    const columnWidth = Math.max(1, Math.floor(spec.grid.measure[2] * used * charEm));
    const contentWidth = viewport.width - result.margin.left - result.margin.right;
    const extra = contentWidth - (result.columns * columnWidth + (result.columns - 1) * result.gap);
    const shift = Math.floor(extra / 2);
    return {
      font: { family, weight, style: 'normal', size: used },
      lineHeight: result.lineHeight,
      columns: result.columns,
      columnWidth,
      gap: result.gap,
      margin: {
        top: result.margin.top,
        right: result.margin.right + extra - shift,
        bottom: result.margin.bottom,
        left: result.margin.left + shift,
      },
      charsPerLine: columnWidth / (used * charEm),
    };
  }

  return {
    font: { family, weight, style: 'normal', size: used },
    lineHeight: result.lineHeight,
    columns: result.columns,
    columnWidth: result.columnWidth,
    gap: result.gap,
    margin: result.margin,
    charsPerLine,
  };
}

export function pageGeometry(index: number, grid: BodyGrid, viewport: Size, mode: FlowMode): PageGeometry {
  const { lineHeight: lh, margin, columns, columnWidth, gap } = grid;
  const frameHeight = Math.floor((viewport.height - margin.top - margin.bottom) / lh) * lh;
  const unbounded = (mode === 'paged-y' && columns === 1) || frameHeight < MIN_PAGE_LINES * lh;

  let rect: Rect;
  if (unbounded) {
    rect = { x: 0, y: 0, width: viewport.width, height: Infinity };
  } else if (mode === 'paged-x') {
    rect = { x: index * viewport.width, y: 0, width: viewport.width, height: viewport.height };
  } else {
    rect = { x: 0, y: index * viewport.height, width: viewport.width, height: viewport.height };
  }

  const height = unbounded ? Infinity : frameHeight;
  const frames: Rect[] = [];
  for (let i = 0; i < columns; i++) {
    frames.push({
      x: rect.x + margin.left + i * (columnWidth + gap),
      y: rect.y + margin.top,
      width: columnWidth,
      height,
    });
  }
  return { index, rect, frames };
}
