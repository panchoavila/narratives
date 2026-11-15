// geometry.test.ts — spec §4: body grid resolution and page geometry.
//
// Hand derivation used throughout. The sample sentence has 88 characters, 17 of them spaces and 71
// letters, so its natural width at size 100 is 71 x 50 + 17 x 25 = 3975 and k = 3975 / 8800 = 159/352.
// With measure [28, 38, 52] and bodySize [14, 18], leading 1.4, gap 1 line and 2-line margins:
//
//   viewport   s=18 lh gap margin  -> final  lh  columns  columnWidth  font  margin  chars/line
//   1440 x 900  25  25   50          (4)      25    4        316        18     50      38.865
//   1180 x 820  25 -> 15 (lh 21)     (4)      21    4        258        15     42      38.078
//    820 x 1180 25 -> 14 (lh 20)     (3)      20    3        233        14     40      36.845
//    390 x 844  25 -> 17 (lh 24)     (1)      24    1        294        17     48      38.286
//
// Column counts are the largest n whose columns hold >= 28 characters at the size they imply.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPretextMeasurer,
  pageGeometry,
  resolveBodyGrid,
  type BodyGrid,
  type FlowMode,
  type FlowSpec,
  type Size,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import { baseSpec } from './fixtures';
import { installStubCanvas } from './stub-canvas';

beforeAll(() => {
  installStubCanvas();
});

function grid(width: number, height: number, spec: FlowSpec = baseSpec()): BodyGrid {
  return resolveBodyGrid(spec, { width, height }, createPretextMeasurer());
}

const VIEWPORTS: Array<[string, Size]> = [
  ['1440x900', { width: 1440, height: 900 }],
  ['1180x820', { width: 1180, height: 820 }],
  ['820x1180', { width: 820, height: 1180 }],
  ['390x844', { width: 390, height: 844 }],
];

describe('resolveBodyGrid at the reference viewports', () => {
  it('resolves 1440x900 to 4 columns of 316px at 18px with a 25px line', () => {
    const g = grid(1440, 900);
    expect(g.columns).toBe(4);
    expect(g.columnWidth).toBe(316);
    expect(g.gap).toBe(25);
    expect(g.lineHeight).toBe(25);
    expect(g.font.size).toBe(18);
    expect(g.margin).toEqual({ top: 50, right: 50, bottom: 50, left: 50 });
    expect(g.charsPerLine).toBeCloseTo(38.8651, 3);
  });

  it('resolves 1180x820 to 4 columns of 258px at 15px with a 21px line', () => {
    const g = grid(1180, 820);
    expect(g.columns).toBe(4);
    expect(g.columnWidth).toBe(258);
    expect(g.gap).toBe(21);
    expect(g.lineHeight).toBe(21);
    expect(g.font.size).toBe(15);
    expect(g.margin).toEqual({ top: 42, right: 42, bottom: 42, left: 42 });
    expect(g.charsPerLine).toBeCloseTo(38.0780, 3);
  });

  it('resolves 820x1180 to 3 columns of 233px at 14px with a 20px line', () => {
    const g = grid(820, 1180);
    expect(g.columns).toBe(3);
    expect(g.columnWidth).toBe(233);
    expect(g.gap).toBe(20);
    expect(g.lineHeight).toBe(20);
    expect(g.font.size).toBe(14);
    expect(g.margin).toEqual({ top: 40, right: 40, bottom: 40, left: 40 });
    expect(g.charsPerLine).toBeCloseTo(36.8446, 3);
  });

  it('resolves 390x844 to a single 294px column at 17px with a 24px line', () => {
    const g = grid(390, 844);
    expect(g.columns).toBe(1);
    expect(g.columnWidth).toBe(294);
    expect(g.gap).toBe(24);
    expect(g.lineHeight).toBe(24);
    expect(g.font.size).toBe(17);
    expect(g.margin).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });
    expect(g.charsPerLine).toBeCloseTo(38.2863, 3);
  });

  it('keeps the font family, weight and style of the body spec', () => {
    const g = grid(1440, 900);
    expect(g.font).toEqual({ family: '"Stub Serif", serif', weight: 400, style: 'normal', size: 18 });
  });

  it.each(VIEWPORTS)('gives whole pixel sizes, gaps and margins at %s', (_name, vp) => {
    const g = grid(vp.width, vp.height);
    for (const v of [g.lineHeight, g.columnWidth, g.gap, g.font.size, g.margin.top, g.margin.right, g.margin.bottom, g.margin.left]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it.each(VIEWPORTS)('fills each column with at least the minimum measure at %s', (_name, vp) => {
    const g = grid(vp.width, vp.height);
    expect(g.charsPerLine).toBeGreaterThanOrEqual(28);
  });

  it('does not let the viewport height change the columns or the font', () => {
    const tall = grid(1440, 2000);
    const short = grid(1440, 900);
    expect(tall.columns).toBe(short.columns);
    expect(tall.font.size).toBe(short.font.size);
    expect(tall.columnWidth).toBe(short.columnWidth);
  });
});

describe('resolveBodyGrid limits', () => {
  it('never exceeds maxColumns, however wide the viewport', () => {
    // 4000px: n = 4 gives a wide column at 18px. A1 caps the line at the measure maximum (52), so the
    // column is narrowed to it and centred; the column count and the body size are unchanged.
    const g = grid(4000, 2000);
    expect(g.columns).toBe(4);
    expect(g.charsPerLine).toBeLessThanOrEqual(52 + 0.01);
    expect(g.font.size).toBe(18);
  });

  it('keeps one column when maxColumns is 1', () => {
    expect(grid(1440, 900, baseSpec({ grid: { maxColumns: 1 } })).columns).toBe(1);
  });

  it('clamps the body size to bodySize[1] on a very wide column', () => {
    const g = grid(4000, 2000, baseSpec({ grid: { maxColumns: 1 } }));
    expect(g.font.size).toBe(18);
  });

  it('reports one column of at least 1px and the minimum size for a zero-width container, without NaN', () => {
    // Margins alone exceed the width. E8(a) scales them to 40% of a zero width, and E8(b) sets the size
    // so a line holds eight characters: a 1px column takes the 1px minimum, which may sit below bodySize[0].
    const g = grid(0, 0);
    expect(g.columns).toBe(1);
    expect(g.columnWidth).toBe(1);
    expect(g.font.size).toBe(1);
    expect(g.lineHeight).toBe(Math.max(1, Math.round(1 * g.font.size * 1.4)));
    for (const v of [g.lineHeight, g.columnWidth, g.gap, g.font.size, g.charsPerLine]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('pageGeometry', () => {
  let g1440: BodyGrid;
  beforeAll(() => {
    g1440 = grid(1440, 900);
  });
  const vp1440: Size = { width: 1440, height: 900 };

  it('places the first paged-x page at the origin, with one frame per column inside the margins', () => {
    const page = pageGeometry(0, g1440, vp1440, 'paged-x');
    expect(page.rect).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    expect(page.frames.map((f) => f.x)).toEqual([50, 391, 732, 1073]);
    expect(page.frames.every((f) => f.y === 50 && f.width === 316)).toBe(true);
  });

  it('frames are whole lines tall: 800px is 32 lines of 25px', () => {
    const page = pageGeometry(0, g1440, vp1440, 'paged-x');
    expect(page.frames[0].height).toBe(800);
    expect(page.frames[0].height % g1440.lineHeight).toBe(0);
  });

  it('separates neighbouring frames by exactly the gap', () => {
    const page = pageGeometry(0, g1440, vp1440, 'paged-x');
    for (let i = 1; i < page.frames.length; i++) {
      expect(page.frames[i].x - (page.frames[i - 1].x + page.frames[i - 1].width)).toBe(25);
    }
  });

  it('moves the second paged-x page one viewport to the right', () => {
    const page = pageGeometry(2, g1440, vp1440, 'paged-x');
    expect(page.rect.x).toBe(2880);
    expect(page.frames[0].x).toBe(2930);
  });

  it('stacks paged-y pages down the flow, one viewport apart', () => {
    const page = pageGeometry(1, g1440, vp1440, 'paged-y');
    expect(page.rect).toEqual({ x: 0, y: 900, width: 1440, height: 900 });
    expect(page.frames[0].y).toBe(950);
    expect(page.frames[0].x).toBe(50);
  });

  it('gives 1180x820 frames of 258px at x 42, 321, 600 and 879, 735px tall', () => {
    const g = grid(1180, 820);
    const page = pageGeometry(0, g, { width: 1180, height: 820 }, 'paged-x');
    expect(page.frames.map((f) => f.x)).toEqual([42, 321, 600, 879]);
    expect(page.frames[0].width).toBe(258);
    expect(page.frames[0].height).toBe(735);
  });

  it('gives 820x1180 frames of 233px at x 40, 293 and 546, 1100px tall', () => {
    const g = grid(820, 1180);
    const page = pageGeometry(0, g, { width: 820, height: 1180 }, 'paged-x');
    expect(page.frames.map((f) => f.x)).toEqual([40, 293, 546]);
    expect(page.frames[0].height).toBe(1100);
  });

  it('keeps a single-column paged-y page unbounded and measured in Infinity', () => {
    const g = grid(390, 844);
    const page = pageGeometry(0, g, { width: 390, height: 844 }, 'paged-y');
    expect(page.rect).toEqual({ x: 0, y: 0, width: 390, height: Infinity });
    expect(page.frames[0]).toEqual({ x: 48, y: 48, width: 294, height: Infinity });
  });

  it('bounds a single-column paged-x page by the viewport height', () => {
    const g = grid(390, 844);
    const page = pageGeometry(0, g, { width: 390, height: 844 }, 'paged-x');
    expect(page.rect).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    // floor((844 - 96) / 24) = 31 lines = 744px.
    expect(page.frames[0]).toEqual({ x: 48, y: 48, width: 294, height: 744 });
  });

  it('makes the page unbounded when the viewport is too short to hold four lines', () => {
    // 1440 x 160: the margins are at most 40% of the height (E8a), 64px, so the frame is 96px:
    // floor(96 / 25) x 25 = 75px, under 4 lines. At 175px the capped margins leave four lines.
    const g = grid(1440, 160);
    const page = pageGeometry(0, g, { width: 1440, height: 160 }, 'paged-x');
    expect(page.rect.height).toBe(Infinity);
    expect(page.frames.every((f) => f.height === Infinity)).toBe(true);
  });

  it('keeps a page bounded at exactly four lines', () => {
    // 1440 x 200: the frame is 100px, which is exactly 4 lines.
    const g = grid(1440, 200);
    const page = pageGeometry(0, g, { width: 1440, height: 200 }, 'paged-x');
    expect(page.rect.height).toBe(200);
    expect(page.frames[0].height).toBe(100);
  });

  it('never produces NaN for a zero-height container', () => {
    const g = grid(1440, 0);
    const modes: FlowMode[] = ['paged-x', 'paged-y'];
    for (const mode of modes) {
      const page = pageGeometry(0, g, { width: 1440, height: 0 }, mode);
      expect(Number.isNaN(page.rect.height)).toBe(false);
      expect(Number.isNaN(page.rect.y)).toBe(false);
      expect(page.frames.some((f) => Number.isNaN(f.height))).toBe(false);
    }
  });
});
