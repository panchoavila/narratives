// measure.test.ts — spec §3: font strings, the Pretext-backed measurer, and vertical metrics.
//
// Widths come from the stub canvas: a letter is 0.5 x size, a space 0.25 x size, weight >= 600 x1.1,
// italic x0.9, soft hyphen 0. At 16px: a letter is 8, a space 4, so "aaaa aaaa" is 68 wide.

import { beforeAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPretextMeasurer,
  fontString,
  type FontSpec,
  type MeasuredLine,
  type Measurer,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import { installStubCanvas } from './stub-canvas';

beforeAll(() => {
  installStubCanvas();
});

afterEach(() => {
  installStubCanvas();
});

const SERIF = '"Stub Serif", serif';

function roman(size = 16, weight = 400): FontSpec {
  return { family: SERIF, weight, style: 'normal', size };
}

function italic(size = 16, weight = 400): FontSpec {
  return { family: SERIF, weight, style: 'italic', size };
}

function prepared(m: Measurer, items: Array<{ text: string; font: FontSpec }>) {
  return m.prepare(items);
}

function linesOf(m: Measurer, handle: ReturnType<Measurer['prepare']>, maxWidth: number): MeasuredLine[] {
  const out: MeasuredLine[] = [];
  let cursor: MeasuredLine['end'] | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const line = m.nextLine(handle, maxWidth, cursor);
    if (!line) return out;
    out.push(line);
    cursor = line.end;
  }
  throw new Error('nextLine did not reach the end of the paragraph');
}

/** The line as text. Pretext reports a space at a run boundary as the next fragment's
 *  `gapBefore`, not as a character, so a gap reads back as one space. */
function joined(line: MeasuredLine): string {
  return line.fragments.map((f) => (f.gapBefore > 0 ? ' ' : '') + f.text).join('');
}

describe('fontString', () => {
  it('writes weight, size and family for a roman font', () => {
    expect(fontString(roman(16))).toBe('400 16px "Stub Serif", serif');
  });

  it('prefixes italic and keeps the weight for an italic bold font', () => {
    expect(fontString(italic(18, 700))).toBe('italic 700 18px "Stub Serif", serif');
  });

  it('does not put letter spacing into the font string', () => {
    expect(fontString({ ...roman(16), letterSpacing: 2 })).toBe(fontString(roman(16)));
  });
});

describe('naturalWidth', () => {
  let m: Measurer;
  beforeEach(() => {
    m = createPretextMeasurer();
  });

  it('measures letters and spaces at the stub rates', () => {
    expect(m.naturalWidth('aaaa aaaa', roman(16))).toBe(68);
  });

  it('measures empty text as zero', () => {
    expect(m.naturalWidth('', roman(16))).toBe(0);
  });

  it('applies the 1.1 factor to a bold weight', () => {
    expect(m.naturalWidth('aaaa', roman(16, 700))).toBeCloseTo(35.2, 6);
  });

  it('applies the 1.1 factor to weight 600, the bold threshold', () => {
    expect(m.naturalWidth('aaaa', roman(16, 600))).toBeCloseTo(35.2, 6);
  });

  it('applies the 0.9 factor to italic', () => {
    expect(m.naturalWidth('aaaa', italic(16))).toBeCloseTo(28.8, 6);
  });

  it('measures a soft hyphen as zero width', () => {
    expect(m.naturalWidth('a­b', roman(16))).toBe(16);
  });

  it('adds letter spacing to the width of a run', () => {
    const plainWidth = m.naturalWidth('aaaa', roman(16));
    const spaced = m.naturalWidth('aaaa', { ...roman(16), letterSpacing: 2 });
    expect(spaced).toBeGreaterThan(plainWidth);
  });
});

describe('metrics', () => {
  let m: Measurer;
  beforeEach(() => {
    m = createPretextMeasurer();
  });

  it('reads cap height and font ascent and descent from the canvas', () => {
    const metrics = m.metrics(roman(16));
    expect(metrics.capHeight).toBeCloseTo(11.2, 6);
    expect(metrics.ascent).toBeCloseTo(12.8, 6);
    expect(metrics.descent).toBeCloseTo(3.2, 6);
  });

  it('falls back to 0.7, 0.8 and 0.2 of the size when the canvas reports no metrics', () => {
    // A 37px size is unused by the other tests, so the measurer cannot answer from its cache.
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
      getContext() {
        return { font: '', measureText: () => ({ width: 0 }) };
      }
    };
    const metrics = createPretextMeasurer().metrics(roman(37));
    expect(metrics.capHeight).toBeCloseTo(0.7 * 37, 6);
    expect(metrics.ascent).toBeCloseTo(0.8 * 37, 6);
    expect(metrics.descent).toBeCloseTo(0.2 * 37, 6);
  });
});

describe('nextLine', () => {
  it('breaks at a space and reports the width without the trailing space', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaa aaaa aaaa', font: roman(16) }]);
    const first = m.nextLine(handle, 80);
    expect(first).not.toBeNull();
    expect(first!.width).toBe(68);
    expect(joined(first!)).toBe('aaaa aaaa');
    expect(first!.hyphenated).toBe(false);
  });

  it('removes trailing spaces from the last fragment of a line', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaa aaaa bbbb', font: roman(16) }]);
    const first = m.nextLine(handle, 68)!;
    expect(first.width).toBe(68);
    expect(joined(first).endsWith(' ')).toBe(false);
    expect(first.fragments[first.fragments.length - 1].text.endsWith(' ')).toBe(false);
  });

  it('continues from a cursor and returns null once the paragraph is exhausted', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaa aaaa aaaa', font: roman(16) }]);
    const lines = linesOf(m, handle, 80);
    expect(lines.map(joined)).toEqual(['aaaa aaaa', 'aaaa']);
    expect(lines[1].width).toBe(32);
    expect(m.nextLine(handle, 80, lines[1].end)).toBeNull();
  });

  it('returns null for a paragraph whose items are all empty', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: '', font: roman(16) }]);
    expect(m.nextLine(handle, 100)).toBeNull();
  });

  it('cuts a word wider than the slot between graphemes, so every line makes progress', () => {
    // Ten letters are 80px. At a 24px slot three letters fit per line: 3, 3, 3, 1.
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaaaaaaaa', font: roman(16) }]);
    const lines = linesOf(m, handle, 24);
    expect(lines.map((l) => joined(l).length)).toEqual([3, 3, 3, 1]);
    lines.forEach((l) => expect(l.width).toBeLessThanOrEqual(24));
  });

  it('treats a maxWidth below 1 as 1, so one grapheme is cut per line and the loop ends', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaa', font: roman(16) }]);
    const lines = linesOf(m, handle, 0);
    expect(lines.map((l) => joined(l))).toEqual(['a', 'a', 'a', 'a']);
  });

  it('reports itemIndex against the original items when an earlier item is empty', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [
      { text: '', font: roman(16) },
      { text: 'aa', font: roman(16) },
    ]);
    const line = m.nextLine(handle, 100)!;
    expect(line.fragments[0].itemIndex).toBe(1);
  });

  it('measures fragments of different fonts in one line', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [
      { text: 'aaaa ', font: roman(16) },
      { text: 'bbbb', font: italic(16) },
    ]);
    const line = m.nextLine(handle, 200)!;
    expect(joined(line)).toBe('aaaa bbbb');
    // 'aaaa' 32 + space 4 + italic 'bbbb' 4 x 8 x 0.9 = 28.8
    expect(line.width).toBeCloseTo(64.8, 6);
  });

  it('breaks at a soft hyphen, paints a hyphen and includes it in the width', () => {
    // 'aaaa' 32 + painted hyphen 8 = 40 fits; the whole word (68) does not.
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaa­aaaa', font: roman(16) }]);
    const lines = linesOf(m, handle, 40);
    expect(lines.length).toBe(2);
    expect(lines[0].hyphenated).toBe(true);
    expect(joined(lines[0])).toBe('aaaa-');
    expect(lines[0].width).toBeCloseTo(40, 6);
    expect(lines[1].hyphenated).toBe(false);
    expect(joined(lines[1])).toBe('aaaa');
  });

  it('does not flag a line as hyphenated when it breaks at a space', () => {
    const m = createPretextMeasurer();
    const handle = prepared(m, [{ text: 'aaaa aaaa', font: roman(16) }]);
    const lines = linesOf(m, handle, 40);
    expect(lines.map((l) => l.hyphenated)).toEqual([false, false]);
  });
});

describe('lineStats', () => {
  let m: Measurer;
  beforeEach(() => {
    m = createPretextMeasurer();
  });

  it('counts the lines a paragraph wraps to and the widest of them', () => {
    const handle = prepared(m, [{ text: 'aaaa aaaa aaaa', font: roman(16) }]);
    expect(m.lineStats(handle, 80)).toEqual({ lineCount: 2, maxLineWidth: 68 });
  });

  it('reports one line of the full natural width when the paragraph fits', () => {
    const handle = prepared(m, [{ text: 'aaaa aaaa aaaa', font: roman(16) }]);
    expect(m.lineStats(handle, 200)).toEqual({ lineCount: 1, maxLineWidth: 104 });
  });
});
