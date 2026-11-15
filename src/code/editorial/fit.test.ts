// fit.test.ts — spec §5: sizing a text object into a box, one mode at a time.
//
// Hand arithmetic at body size 18 with the stub canvas (letter 0.5 x size, space 0.25 x size):
//   'aaaa' = 36, space = 4.5, 'aaaa aaaa' = 76.5, 'aaaa aaaa aaaa' = 117.
//   Per 100px of font size: 'aaaa' = 200, space = 25, 'aaaa aaaa bbbb' = 650, best 2-line split = 425,
//   best 3-line split = 200 (each word alone).
// Body leading 1.2, so a size-18 line is round(18 x 1.2) = 22px tall.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPretextMeasurer,
  fitText,
  type FitMode,
  type FittedText,
  type FontSpec,
  type InlineRun,
  type TypeStyle,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import { installStubCanvas } from './stub-canvas';

beforeAll(() => {
  installStubCanvas();
});

const BODY = 18;
const SERIF = '"Stub Serif", serif';

function style(overrides: Partial<TypeStyle> = {}): TypeStyle {
  return { family: SERIF, weight: 400, style: 'normal', scale: 1, leading: 1.2, ...overrides };
}

function run(text: string): InlineRun[] {
  return [{ text }];
}

function fit(
  text: string,
  box: { width: number; maxHeight: number },
  mode: FitMode,
  s: TypeStyle = style(),
  bodySize = BODY,
): FittedText {
  return fitText(run(text), s, mode, box, bodySize, createPretextMeasurer());
}

const NONE: FitMode = { kind: 'none' };
const TRACK: FitMode = { kind: 'tracking' };
const WIDTH_AUTO: FitMode = { kind: 'width', lines: 'auto', maxLines: 3, maxScale: 2 };
const LINES_AUTO: FitMode = { kind: 'lines', lines: 'auto', maxLines: 3, maxScale: 2 };

function lineTexts(out: FittedText): string[] {
  return out.lines.map((l) => l.text);
}

describe('empty text', () => {
  it('returns no lines, the box width and zero height', () => {
    const out = fit('', { width: 80, maxHeight: 100 }, NONE);
    expect(out).toEqual({ lines: [], width: 80, height: 0, clipped: false });
  });
});

describe('none: the style sets the size and the text wraps', () => {
  it('sets the size to round(scale x bodySize) and the line height to round(size x leading)', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 200 }, NONE);
    expect(out.lines[0].font.size).toBe(18);
    expect(out.lines[0].height).toBe(22);
  });

  it('wraps at the box width, breaking after the word that still fits', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 200 }, NONE);
    expect(lineTexts(out)).toEqual(['aaaa aaaa', 'aaaa']);
    expect(out.lines[0].width).toBeCloseTo(76.5, 6);
    expect(out.lines[1].width).toBeCloseTo(36, 6);
  });

  it('stacks lines at y = sum of the previous line heights', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 200 }, NONE);
    expect(out.lines.map((l) => l.y)).toEqual([0, 22]);
    expect(out.height).toBe(44);
    expect(out.width).toBe(80);
  });

  it('reports clipped false when the text fits the height', () => {
    expect(fit('aaaa aaaa aaaa', { width: 80, maxHeight: 100 }, NONE).clipped).toBe(false);
  });

  it('reports clipped true but keeps every line when the text is taller than the box', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 40 }, NONE);
    expect(out.clipped).toBe(true);
    expect(lineTexts(out)).toEqual(['aaaa aaaa', 'aaaa']);
  });

  it('places a centred line at (box width - line width) / 2', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 200 }, NONE, style({ align: 'center' }));
    expect(out.lines[0].x).toBeCloseTo((80 - 76.5) / 2, 6);
    expect(out.lines[1].x).toBeCloseTo((80 - 36) / 2, 6);
  });

  it('places an end-aligned line flush with the right edge', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 200 }, NONE, style({ align: 'end' }));
    expect(out.lines[0].x).toBeCloseTo(80 - 76.5, 6);
    expect(out.lines[1].x).toBeCloseTo(80 - 36, 6);
  });

  it('places a start-aligned line at x = 0', () => {
    const out = fit('aaaa aaaa aaaa', { width: 80, maxHeight: 200 }, NONE, style({ align: 'start' }));
    expect(out.lines.every((l) => l.x === 0)).toBe(true);
  });

  it('rounds the size of a fractional scale to a whole pixel', () => {
    // 0.6 x 18 = 10.8, rounded to 11. Line height round(11 x 1.2) = 13. 'aaaa' = 4 x 5.5 = 22.
    const out = fit('aaaa', { width: 200, maxHeight: 100 }, NONE, style({ scale: 0.6 }));
    expect(out.lines[0].font.size).toBe(11);
    expect(out.lines[0].height).toBe(13);
    expect(out.lines[0].width).toBeCloseTo(22, 6);
  });

  it('applies tracking em as letter spacing in px, in every mode but tracking', () => {
    const out = fit('aaaa', { width: 200, maxHeight: 100 }, NONE, style({ tracking: 0.05 }));
    expect(out.lines[0].font.letterSpacing).toBeCloseTo(0.9, 6);
  });

  it('gives every line the family, weight and style of the text style', () => {
    const out = fit('aaaa', { width: 200, maxHeight: 100 }, NONE, style({ style: 'italic', weight: 700 }));
    const font: FontSpec = out.lines[0].font;
    expect(font.family).toBe(SERIF);
    expect(font.weight).toBe(700);
    expect(font.style).toBe('italic');
  });

  it('uppercases the text when the style asks for it', () => {
    const out = fit('abc', { width: 200, maxHeight: 100 }, NONE, style({ uppercase: true }));
    expect(lineTexts(out)).toEqual(['ABC']);
  });

  it('collapses runs of whitespace to one space', () => {
    const out = fit('a    b', { width: 200, maxHeight: 100 }, NONE);
    expect(lineTexts(out)).toEqual(['a b']);
  });

  it('breaks at each newline as a forced line, whatever the width', () => {
    const out = fit('aa\nbb', { width: 200, maxHeight: 100 }, NONE);
    expect(lineTexts(out)).toEqual(['aa', 'bb']);
    expect(out.lines.map((l) => l.y)).toEqual([0, 22]);
  });

  it('cuts a word that cannot fit a zero-width box between graphemes, with no hang and no NaN', () => {
    // E8(c): a zero box cannot hold any font, so the text is set at the 1px minimum. Each 0.5px letter
    // is then two to a line, which is what the wrap produces at that size.
    const out = fit('aaaa', { width: 0, maxHeight: 100 }, NONE);
    expect(out.lines.length).toBe(2);
    expect(out.lines.every((l) => l.font.size === 1)).toBe(true);
    expect(out.lines.every((l) => Number.isFinite(l.width) && Number.isFinite(l.y))).toBe(true);
  });
});

describe('tracking: one line stretched to the box width', () => {
  it('spreads three letters across the box with letter spacing (100 - 27) / 2 = 36.5', () => {
    // 'abc' at 18px is 27px wide; with n = 3 graphemes there are 2 gaps.
    const out = fit('abc', { width: 100, maxHeight: 100 }, TRACK);
    expect(out.lines.length).toBe(1);
    expect(out.lines[0].font.size).toBe(18);
    expect(out.lines[0].font.letterSpacing).toBeCloseTo(36.5, 6);
    expect(out.lines[0].width).toBe(100);
  });

  it('ignores the tracking em in this mode and uses the computed spacing instead', () => {
    const out = fit('abc', { width: 100, maxHeight: 100 }, TRACK, style({ tracking: 0.5 }));
    expect(out.lines[0].font.letterSpacing).toBeCloseTo(36.5, 6);
  });

  it('shrinks the size instead when the natural width already exceeds the box', () => {
    // 'aaaaaaaaaa' is 90px at 18px; a 45px box gives size 18 x 45 / 90 = 9 and no spacing.
    const out = fit('aaaaaaaaaa', { width: 45, maxHeight: 100 }, TRACK);
    expect(out.lines[0].font.size).toBe(9);
    expect(out.lines[0].font.letterSpacing ?? 0).toBe(0);
    expect(out.lines[0].width).toBe(45);
  });

  it('shrinks a single grapheme to the box width at most, because spacing needs at least two graphemes', () => {
    // 'a' is 9px at 18px; the shrink rule would make it 18 x 100 / 9 = 200px, past the 100px box (E8c).
    // It is set at 100px, which is 50px wide: the line reports that width, not the box's.
    const out = fit('a', { width: 100, maxHeight: 100 }, TRACK);
    expect(out.lines[0].font.size).toBe(100);
    expect(out.lines[0].width).toBe(50);
  });

  it('stretches every forced line on its own', () => {
    const out = fit('abc\nabc', { width: 100, maxHeight: 200 }, TRACK);
    expect(out.lines.length).toBe(2);
    expect(out.lines.every((l) => Math.abs((l.font.letterSpacing ?? 0) - 36.5) < 1e-6)).toBe(true);
  });

  it('reports a height equal to the sum of its line heights', () => {
    const out = fit('abc\nabc', { width: 100, maxHeight: 200 }, TRACK);
    expect(out.height).toBe(out.lines.reduce((sum, l) => sum + l.height, 0));
  });
});

describe('width: one size for all lines, the widest line fills the box', () => {
  it('picks the 2-line split at 23.52px, the largest size whose height fits 60px', () => {
    // k = 1: 100 x 100 / 650 = 15.38px, height 18.46. k = 2: 100 x 100 / 425 = 23.529px, height 56.47.
    // k = 3: 36px (capped), height 129.6, which does not fit. The largest size that fits is k = 2.
    // The size is rounded DOWN to 2 decimals (23.52), so the widest line can never exceed the box.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 60 }, WIDTH_AUTO);
    expect(out.lines.length).toBe(2);
    expect(out.lines.every((l) => l.font.size === 23.52)).toBe(true);
    expect(out.height).toBeCloseTo(56.448, 2);
    expect(lineTexts(out).join(' ')).toBe('aaaa aaaa bbbb');
  });

  it('fills the box width with its widest line', () => {
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 60 }, WIDTH_AUTO);
    const widest = Math.max(...out.lines.map((l) => l.width));
    expect(widest).toBeCloseTo(100, 1);
    expect(widest).toBeLessThanOrEqual(100 + 0.01);
  });

  it('uses the single line when the height allows nothing else and the size is the largest that fits', () => {
    // Only k = 1 fits 20px: 15.38px, height 18.46.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 20 }, WIDTH_AUTO);
    expect(out.lines.length).toBe(1);
    expect(out.lines[0].font.size).toBeCloseTo(15.38, 2);
  });

  it('takes the 3-line split when the height allows it, at the 36px cap', () => {
    // maxScale 2 x 18 = 36px caps the size; three lines are 3 x 36 x 1.2 = 129.6px.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 200 }, { kind: 'width', lines: 3, maxLines: 3, maxScale: 2 });
    expect(lineTexts(out)).toEqual(['aaaa', 'aaaa', 'bbbb']);
    expect(out.lines.every((l) => l.font.size === 36)).toBe(true);
    expect(out.lines.every((l) => Math.abs(l.width - 72) < 1e-6)).toBe(true);
  });

  it('clamps a numeric line count to the number of words', () => {
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 200 }, { kind: 'width', lines: 10, maxLines: 3, maxScale: 2 });
    expect(out.lines.length).toBe(3);
  });

  it('caps the size at maxScale x bodySize, so a single short word does not grow without bound', () => {
    // 'aa' is 100px per 100px of size: 100 x 1000 / 100 = 1000px, capped at 36px. Width 2 x 18 = 36.
    const out = fit('aa', { width: 1000, maxHeight: 200 }, { kind: 'width', lines: 'auto', maxLines: 1, maxScale: 2 });
    expect(out.lines[0].font.size).toBe(36);
    expect(out.lines[0].width).toBeCloseTo(36, 6);
  });

  it('keeps forced lines and ignores the line count when the text has newlines', () => {
    const out = fit('aaaa\nbbbb', { width: 100, maxHeight: 200 }, { kind: 'width', lines: 1, maxLines: 1, maxScale: 2 });
    expect(lineTexts(out)).toEqual(['aaaa', 'bbbb']);
    expect(out.lines.every((l) => l.font.size === 36)).toBe(true);
  });

  it('scales the smallest candidate down so its height equals the box height when nothing fits', () => {
    // Smallest candidate is k = 1 at 18.46px tall. Scaling to 10px: size 15.38 x 10 / 18.46 = 8.33px.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 10 }, WIDTH_AUTO);
    expect(out.lines.length).toBe(1);
    expect(out.lines[0].font.size).toBeCloseTo(8.33, 2);
    expect(out.height).toBeCloseTo(10, 2);
  });

  it('finishes with finite numbers when the box has no height', () => {
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 0 }, WIDTH_AUTO);
    expect(Number.isFinite(out.height)).toBe(true);
    expect(out.lines.every((l) => Number.isFinite(l.width) && Number.isFinite(l.font.size))).toBe(true);
  });
});

describe('lines: each line sized on its own to fill the box width', () => {
  it('uses the only candidate that fits 60px: one line at 100 x 100 / 650 = 15.38px', () => {
    // Two-line candidates total 70.84px and three-line 129.6px, both over 60px.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 60 }, LINES_AUTO);
    expect(out.lines.length).toBe(1);
    expect(out.lines[0].font.size).toBeCloseTo(100 / 6.5, 2);
    expect(out.lines[0].width).toBeCloseTo(100, 1);
  });

  it('picks the 3-line candidate with the largest total height that fits 1000px, each at the 36px cap', () => {
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 1000 }, LINES_AUTO);
    expect(lineTexts(out)).toEqual(['aaaa', 'aaaa', 'bbbb']);
    expect(out.lines.every((l) => l.font.size === 36)).toBe(true);
    expect(out.height).toBeCloseTo(129.6, 6);
  });

  it('scales every line so the total equals the box height when no candidate fits', () => {
    // Smallest total is the single line, 18.46px. Scaled to 5px, the single line is about 4.17px.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 5 }, LINES_AUTO);
    expect(out.lines.length).toBe(1);
    expect(out.height).toBeCloseTo(5, 2);
  });

  it('keeps forced lines and sizes each one independently', () => {
    const out = fit('aaaa\nbb', { width: 100, maxHeight: 200 }, { kind: 'lines', lines: 'auto', maxLines: 2, maxScale: 2 });
    expect(lineTexts(out)).toEqual(['aaaa', 'bb']);
    // 'aaaa' is capped at 36px. 'bb' is 100 x 100 / 100 = 100px, capped at 36px as well.
    expect(out.lines.map((l) => l.font.size)).toEqual([36, 36]);
  });
});

describe('box: the largest whole-pixel size whose wrapped text fits', () => {
  const boxFit: FitMode = { kind: 'box', minScale: 0.5, maxScale: 2 };

  it('finds the largest size whose one line fits the box height (33px, 40px tall)', () => {
    // 'aaaa' is 2 x size wide, always one line at width 100 up to 50px. Height round(size x 1.2) must be
    // at most 40: 33 x 1.2 = 39.6 rounds to 40, while 34 x 1.2 = 40.8 rounds to 41.
    const out = fit('aaaa', { width: 100, maxHeight: 40 }, boxFit);
    expect(out.clipped).toBe(false);
    expect(out.lines[0].font.size).toBe(33);
    expect(out.height).toBeLessThanOrEqual(40);
  });

  it('uses the maximum size when everything fits', () => {
    // maxScale 2 x 18 = 36px. 'aaaa' at 36px is 72px wide; the box is 1000px wide and 1000px tall.
    const out = fit('aaaa', { width: 1000, maxHeight: 1000 }, boxFit);
    expect(out.lines[0].font.size).toBe(36);
  });

  it('wraps the text for real at the size it chose', () => {
    // With maxScale 1 the size is 18px. 'aaaa aaaa bbbb' at 18px is 117px, so it wraps to 2 lines.
    const out = fit('aaaa aaaa bbbb', { width: 100, maxHeight: 1000 }, { kind: 'box', minScale: 0.5, maxScale: 1 });
    expect(out.lines.every((l) => l.font.size === 18)).toBe(true);
    expect(lineTexts(out)).toEqual(['aaaa aaaa', 'bbbb']);
  });

  it('reports clipped and uses the smallest size when even that does not fit', () => {
    // Smallest size is round(0.5 x 18) = 9px, one line of height round(9 x 1.2) = 11px, but the box is 5px.
    const out = fit('aaaa', { width: 100, maxHeight: 5 }, boxFit);
    expect(out.clipped).toBe(true);
    expect(out.lines[0].font.size).toBe(9);
  });

  it('converges over a very large range without failing', () => {
    // The largest size is round(100 x 18) = 1800px, but E8(c) caps a size at the 1000px box width.
    const out = fit('a', { width: 1000, maxHeight: 1_000_000 }, { kind: 'box', minScale: 0.5, maxScale: 100 });
    expect(out.lines[0].font.size).toBe(1000);
    expect(out.clipped).toBe(false);
  });
});
