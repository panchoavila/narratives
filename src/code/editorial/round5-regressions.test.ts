// round5-regressions.test.ts — one test per defect the final review's second pass proved (A–K), each
// named after its defect and the amendment that fixes it (E1–E8). The inputs are the reviewer's.

import { beforeAll, describe, expect, it } from 'vitest';
import { installStubCanvas } from './stub-canvas';
import {
  buildEditorialPreset,
  createPretextMeasurer,
  fitText,
  layoutFlow,
  type EditorialTheme,
  type FlowDocument,
  type FlowLayout,
  type FlowSpec,
  type InlineRun,
  type MediaObjectBlock,
  type ParagraphBlock,
  type TextObjectBlock,
  type TypeStyle,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import {
  allLines,
  allObjects,
  baseSpec,
  env,
  expectRound5Invariants,
  findObject,
  linesOf,
  normalText,
  strandedCrossheads,
  words,
  EPS,
} from './fixtures';

beforeAll(() => {
  installStubCanvas();
});

const THEME: EditorialTheme = {
  display: { family: '"Stub Display", serif', weight: 700 },
  sans: { family: '"Stub Sans", sans-serif', weight: 400 },
  serif: { family: '"Stub Serif", serif', weight: 400 },
};

const SHY = '­';

function para(id: string, text: string): ParagraphBlock {
  return { kind: 'paragraph', id, role: 'body', runs: [{ text }] };
}

function crosshead(id: string, text: string): ParagraphBlock {
  return { kind: 'paragraph', id, role: 'crosshead', runs: [{ text }] };
}

/** A string of exactly `n` characters made of words. */
function ofLength(n: number, word = 'head'): string {
  let text = '';
  while (text.length < n) text += `${word} `;
  return text.slice(0, n).trimEnd().padEnd(n, 'x');
}

// ─── A (→ E1): a crossheaded page never loses a crosshead ─────────────────────────────────────────

describe('A (E1): a crosshead is never lost, and every crosshead is painted once', () => {
  it('paints both crossheads of the interview preset at 1200 x 260 with widows 5 and orphans 3', () => {
    const preset = buildEditorialPreset('interview', THEME);
    const spec: FlowSpec = { ...preset, body: { ...preset.body, widows: 5, orphans: 3 } };
    const doc: FlowDocument = {
      blocks: [
        crosshead('h1', 'Crosshead cross cross cross'),
        crosshead('h2', 'Crosshead cross cross cross cross'),
        para('p1', words(40, 'lorem')),
      ],
    };
    const layout = layoutFlow(doc, spec, env(1200, 260, 'paged-x'));
    expect(linesOf(layout, 'h1').length, 'first crosshead not painted').toBeGreaterThan(0);
    expect(linesOf(layout, 'h2').length, 'second crosshead not painted').toBeGreaterThan(0);
    expectRound5Invariants(doc, layout, spec);
  });

  it('paints every crosshead block exactly once across a sweep of heights and leads', () => {
    const preset = buildEditorialPreset('interview', THEME);
    const problems: string[] = [];
    for (let height = 180; height <= 340; height += 20) {
      for (let lead = 10; lead <= 60; lead += 10) {
        const spec: FlowSpec = { ...preset, body: { ...preset.body, widows: 5, orphans: 3 } };
        const doc: FlowDocument = {
          blocks: [
            para('p0', words(lead, 'lead')),
            crosshead('h1', 'Crosshead cross cross cross'),
            crosshead('h2', 'Crosshead cross cross cross cross'),
            para('p1', words(40, 'lorem')),
          ],
        };
        const layout = layoutFlow(doc, spec, env(1200, height, 'paged-x'));
        for (const id of ['h1', 'h2']) {
          const count = allLines(layout).filter((l) => l.blockId === id).length;
          if (count === 0) problems.push(`h=${height} lead=${lead}: ${id} not painted`);
        }
        if (layout.stats.fallbackPages !== 0) problems.push(`h=${height} lead=${lead}: fallback`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

// ─── B (→ E3): the shrunk drop cap ───────────────────────────────────────────────────────────────

describe('B (E3): a drop cap shrunk to the lines beside it is sized for those lines', () => {
  it('sizes a cap for the rows it covers and keeps its glyph inside its rect, down to two rows', () => {
    const problems: string[] = [];
    const seen = new Set<number>();
    for (let n = 2; n <= 40; n += 1) {
      const spec = baseSpec({ body: { dropCap: { lines: 3 } } });
      const doc: FlowDocument = { blocks: [para('p1', words(n, 'extraordinary'))] };
      const layout = layoutFlow(doc, spec, env(900, 800, 'paged-x'));
      const cap = findObject(layout, 'p1-cap');
      if (cap === undefined || cap.lines === undefined) continue;
      const lh = layout.body.lineHeight;
      const bodySize = layout.body.font.size;
      const rows = Math.round(cap.rect.height / lh);
      seen.add(rows);
      // Stub metrics: the cap height of any size is 0.7 of that size (see stub-canvas.ts).
      const expectedSize = Math.round((((rows - 1) * lh + 0.7 * bodySize) / 0.7) * 100) / 100;
      const line = cap.lines[0];
      if (Math.abs(line.font.size - expectedSize) > 0.01) problems.push(`n=${n}: ${rows} rows, size ${line.font.size}, expected ${expectedSize}`);
      if (line.baseline - 0.7 * line.font.size < -EPS) problems.push(`n=${n}: the glyph rises above its rect`);
    }
    expect(seen.has(2), 'no paragraph in the sweep took a two-row cap').toBe(true);
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

// ─── C-i (→ E2): a widow pull never empties a page, and a bounded layout never falls back ───────

describe('C-i (E2): bounded pages with widows 6 never fall back to an unbounded page', () => {
  it('sweeps heights 150 to 400 and bodies of 10 to 80 words without a fallback or a tall page', () => {
    const problems: string[] = [];
    for (let height = 150; height <= 400; height += 5) {
      for (let n = 10; n <= 80; n += 2) {
        const spec = baseSpec({ grid: { maxColumns: 1 }, body: { widows: 6, orphans: 0 } });
        const doc: FlowDocument = { blocks: [para('p0', words(3, 'three')), crosshead('h', 'Head'), para('p1', words(n, 'body'))] };
        const layout = layoutFlow(doc, spec, env(400, height, 'paged-x'));
        if (layout.stats.fallbackPages !== 0) problems.push(`h=${height} n=${n}: ${layout.stats.fallbackPages} fallback pages`);
        // E8(a) caps the margins at 40% of the height, so below about 167px a four-line frame does not
        // exist; §4 then lays the page out unbounded. That is not a fallback, and it is the only case where
        // a page may be taller than the viewport.
        const frame = Math.floor((height - layout.body.margin.top - layout.body.margin.bottom) / layout.body.lineHeight) * layout.body.lineHeight;
        const canPage = frame >= 4 * layout.body.lineHeight;
        for (const page of layout.pages) {
          if (canPage && page.rect.height > height + EPS) problems.push(`h=${height} n=${n}: page ${page.index} is ${page.rect.height} tall`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

// ─── C-ii (→ E1): a cover story page stays bounded when a crosshead is kept with its paragraph ─────

describe('C-ii (E1): a cover-story page with a folio and two crossheads stays bounded', () => {
  it('keeps every page of 1200 x 260 at the viewport height, with no fallback', () => {
    const preset = buildEditorialPreset('cover-story', THEME);
    const spec: FlowSpec = { ...preset, body: { ...preset.body, widows: 0, orphans: 4, paragraphGap: 1 } };
    const doc: FlowDocument = {
      blocks: [
        { kind: 'text-object', id: 'folio', role: 'folio', runs: [{ text: 'Folio' }] },
        crosshead('h1', ofLength(27)),
        crosshead('h2', ofLength(57)),
        para('p1', words(60, 'body')),
      ],
    };
    const layout = layoutFlow(doc, spec, env(1200, 260, 'paged-x'));
    expect(layout.stats.fallbackPages).toBe(0);
    for (const page of layout.pages) {
      expect(page.rect.height, `page ${page.index} is ${page.rect.height} tall`).toBe(260);
    }
    expectRound5Invariants(doc, layout, spec);
  });
});

// ─── D-i (→ E1): a crosshead is never left at a column foot while its paragraph moves on ─────────

describe('D-i (E1): no crosshead ends a column while the next block starts in another column', () => {
  it('holds for orphans 0 to 4 and leads of 60 to 160 words in one column of 500 x 600', () => {
    const problems: string[] = [];
    for (let orphans = 0; orphans <= 4; orphans += 1) {
      for (let lead = 60; lead <= 160; lead += 1) {
        const spec = baseSpec({ grid: { maxColumns: 1 }, body: { orphans } });
        const doc: FlowDocument = {
          blocks: [para('p0', words(lead, 'lead')), crosshead('h1', 'Heading one'), crosshead('h2', 'Heading two'), para('p2', words(60, 'after'))],
        };
        const layout = layoutFlow(doc, spec, env(500, 600, 'paged-x'));
        for (const problem of strandedCrossheads(doc, layout)) problems.push(`orphans=${orphans} lead=${lead}: ${problem}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

// ─── D-ii (→ E1): a two-line crosshead is never split across columns by an object's clearance ─────

describe('D-ii (E1): a two-line crosshead keeps its lines in one column', () => {
  it('never splits a crosshead whose rows are blocked by a bottom-anchored opening object', () => {
    const split: string[] = [];
    let twoLine = 0;
    for (let height = 200; height <= 360; height += 2) {
      for (let lead = 20; lead <= 120; lead += 1) {
        const spec = baseSpec({
          grid: { maxColumns: 2 },
          roles: {
            folio: {
              fit: { kind: 'none' },
              place: { column: 0, span: 1, vertical: 'bottom', clearance: 1 },
              height: { kind: 'lines', lines: 2 },
            },
          },
        });
        const doc: FlowDocument = {
          blocks: [
            { kind: 'text-object', id: 'folio', role: 'folio', runs: [{ text: 'Folio' }] },
            para('p0', words(lead, 'lead')),
            crosshead('h1', 'A crosshead long enough to wrap onto a second line in a narrow column of this layout'),
            para('p1', words(40, 'after')),
          ],
        };
        const layout = layoutFlow(doc, spec, env(700, height, 'paged-x'));
        const lines = linesOf(layout, 'h1');
        if (new Set(lines.map((l) => l.y)).size >= 2) twoLine += 1;
        const columns = new Set(lines.map((l) => `${l.page}:${l.column}`));
        if (columns.size > 1) split.push(`h=${height} lead=${lead}`);
      }
    }
    expect(twoLine, 'the crosshead never wrapped to two lines').toBeGreaterThan(0);
    expect(split.slice(0, 5)).toEqual([]);
  });
});

// ─── E (→ E4): a caption stays directly under its picture ─────────────────────────────────────────

describe('E (E4): a caption is directly under its media, on the same page, at its width', () => {
  const media: MediaObjectBlock = { kind: 'media-object', id: 'm1', role: 'media', src: 'figure.jpg', alt: 'A figure' };
  const caption: TextObjectBlock = { kind: 'text-object', id: 'c1', role: 'caption', runs: [{ text: 'Figure one caption.' }] };
  const hero: MediaObjectBlock = { kind: 'media-object', id: 'hero', role: 'hero', src: 'hero.jpg', alt: 'Hero' };
  const heroCaption: TextObjectBlock = { kind: 'text-object', id: 'hc', role: 'caption', runs: [{ text: 'The hero caption.' }] };

  it('places the caption under the media at cover-story and profile 900 x 600, and at interview 900 x 300', () => {
    const cases: Array<[string, number, number]> = [
      ['cover-story', 900, 600],
      ['profile', 900, 600],
      ['interview', 900, 300],
    ];
    const problems: string[] = [];
    for (const [name, vw, vh] of cases) {
      for (let lead = 20; lead <= 120; lead += 10) {
        const spec = buildEditorialPreset(name as 'cover-story', THEME);
        const doc: FlowDocument = { blocks: [para('p0', words(lead, 'lead')), media, caption, para('p1', words(60, 'after'))] };
        const layout = layoutFlow(doc, spec, env(vw, vh, 'paged-x'));
        const pic = allObjects(layout).find((o) => o.id === 'm1');
        const cap = allObjects(layout).find((o) => o.id === 'c1');
        if (pic === undefined || cap === undefined) {
          problems.push(`${name} lead=${lead}: missing object`);
          continue;
        }
        if (cap.rect.y !== pic.rect.y + pic.rect.height) problems.push(`${name} lead=${lead}: caption not under its picture`);
        if (cap.page !== pic.page) problems.push(`${name} lead=${lead}: caption on page ${cap.page}, picture on ${pic.page}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('keeps a caption under an opening and a claimed picture at 900 x 600 and 900 x 300', () => {
    const problems: string[] = [];
    for (const [vh] of [[600], [300]]) {
      for (let lead = 10; lead <= 80; lead += 10) {
        const spec = buildEditorialPreset('cover-story', THEME);
        const doc: FlowDocument = { blocks: [hero, heroCaption, para('p0', words(lead, 'lead')), media, caption, para('p1', words(40, 'after'))] };
        const layout = layoutFlow(doc, spec, env(900, vh, 'paged-x'));
        try {
          expectRound5Invariants(doc, layout, spec);
        } catch (error) {
          problems.push(`h=${vh} lead=${lead}: ${(error as Error).message.split('\n')[0]}`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

// ─── F (→ E5): fitted lines name their own characters across runs and at soft hyphens ─────────────

describe('F (E5): fitted lines carry offsets into the object text as passed in', () => {
  const runs: InlineRun[] = [{ text: 'extra' + SHY + 'ordinarily long' + SHY + 'er heading ' }, { text: 'and more', em: true }];
  const style: TypeStyle = { family: '"Stub Serif", serif', weight: 400, style: 'normal', scale: 1, leading: 1.2 };

  it('gives "more" its offset in the whole text and every line a source slice that matches it', () => {
    const measurer = createPretextMeasurer();
    const fitted = fitText(runs, style, { kind: 'none' }, { width: 120, maxHeight: 1000 }, 16, measurer);
    const total = runs.map((r) => r.text).join('');
    // The line that paints "and more" starts at the "and" of the second run, wherever the first run's
    // soft hyphens and spaces put it in the concatenated text.
    const more = fitted.lines.find((l) => l.text === 'and more');
    expect(more, '"and more" is not on its own line').toBeDefined();
    if (more === undefined) return;
    expect(more.start, '"and more" starts at the wrong offset').toBe(total.indexOf('and more'));
    expect(more.end, '"and more" ends at the wrong offset').toBe(total.indexOf('and more') + 'and more'.length);
    for (const line of fitted.lines) {
      if (line.text === '') continue;
      expect(line.end, `line "${line.text}" has no source characters`).toBeGreaterThan(line.start);
      expect(normalText(total.slice(line.start, line.end)), `line "${line.text}" points at "${total.slice(line.start, line.end)}"`).toBe(normalText(line.text));
    }
  });

  it('gives a line broken at the author soft hyphen real offsets, not [0, 0]', () => {
    const measurer = createPretextMeasurer();
    const fitted = fitText([{ text: 'extra' + SHY + 'ordinarily' + SHY + 'long words follow here' }], style, { kind: 'none' }, { width: 60, maxHeight: 1000 }, 16, measurer);
    expect(fitted.lines.length).toBeGreaterThan(1);
    for (const line of fitted.lines) expect(line.end, `line "${line.text}" maps to [0, 0]`).toBeGreaterThan(0);
  });
});

// ─── G (→ E6): carriage returns are ordinary whitespace ─────────────────────────────────────────

describe('G (E6): \\r\\n and lone \\r collapse like any other whitespace', () => {
  it('keeps every fragment source-true for runs with CRLF and lone CR', () => {
    const doc: FlowDocument = {
      blocks: [
        para('p1', 'alpha\r\nbeta ' + words(30, 'gamma')),
        para('p2', 'alpha\rbeta ' + words(30, 'delta')),
      ],
    };
    const spec = baseSpec();
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    expect(linesOf(layout, 'p1')[0].fragments.map((f) => f.text).join(' ').startsWith('alpha beta')).toBe(true);
    expectRound5Invariants(doc, layout, spec);
  });

  it('paints no carriage return and keeps real offsets in a text object with CRLF and lone CR', () => {
    const style: TypeStyle = { family: '"Stub Serif", serif', weight: 400, style: 'normal', scale: 1, leading: 1.2 };
    const runs: InlineRun[] = [{ text: 'alpha\r\nbeta gamma' }, { text: '\rdelta' }];
    const fitted = fitText(runs, style, { kind: 'none' }, { width: 1000, maxHeight: 1000 }, 16, createPretextMeasurer());
    const total = runs.map((r) => r.text).join('');
    for (const line of fitted.lines) {
      expect(line.text, `line "${line.text}" paints a carriage return`).not.toMatch(/\r/);
      expect(line.end, `line "${line.text}" maps to [0, 0]`).toBeGreaterThan(line.start);
      expect(normalText(total.slice(line.start, line.end))).toBe(normalText(line.text));
    }
  });
});

// ─── I (→ E7): compact ignores a non-finite column count and the body family, weight and leading ─

describe('I (E7): compact is ignored when its columns are not finite, and its body leading is dropped', () => {
  const doc: FlowDocument = {
    blocks: [para('p0', words(30, 'opening')), para('p1', words(80, 'compact')), { kind: 'text-object', id: 'q1', role: 'quote', runs: [{ text: 'A quote set in its own style.' }] }],
  };

  it('lays the same page with compact.columns NaN as with no compact at all', () => {
    const plain = layoutFlow(doc, baseSpec(), env(1440, 900, 'paged-x'));
    const withNaN = layoutFlow(doc, { ...baseSpec(), compact: { columns: Number.NaN, body: { indent: 5 } } }, env(1440, 900, 'paged-x'));
    expect(withNaN.pages).toEqual(plain.pages);
  });

  it('ignores compact body leading: the body and the default object style keep the spec leading', () => {
    const plain = layoutFlow(doc, baseSpec(), env(1440, 900, 'paged-x'));
    const ruleless: FlowDocument = {
      blocks: [para('p0', words(30, 'opening')), { kind: 'text-object', id: 'f1', role: 'folio', runs: [{ text: 'A folio with no rule of its own, set in the body style.' }] }],
    };
    const plainRuleless = layoutFlow(ruleless, baseSpec(), env(1440, 900, 'paged-x'));
    const leading = layoutFlow(ruleless, { ...baseSpec(), compact: { columns: 4, body: { leading: 3 } } }, env(1440, 900, 'paged-x'));
    expect(leading.body.lineHeight).toBe(plain.body.lineHeight);
    expect(leading.pages).toEqual(plainRuleless.pages);
  });
});

// ─── J (→ E8): nothing is set larger than the measure it is set in ──────────────────────────────

describe('J (E8): no line or glyph is wider than its slot or column', () => {
  it('keeps at least a one-pixel column and a whole-number line when margins take 40 lines of 500 px', () => {
    const spec = baseSpec({ grid: { margin: [40, 40, 40, 40] } });
    const doc: FlowDocument = { blocks: [para('p1', words(60, 'margin'))] };
    const layout = layoutFlow(doc, spec, env(500, 600, 'paged-x'));
    expect(layout.body.columnWidth).toBeGreaterThanOrEqual(1);
    expect(layout.body.margin.left + layout.body.margin.right, 'margins exceed 40% of the viewport width').toBeLessThanOrEqual(0.4 * 500 + EPS);
    expectRound5Invariants(doc, layout, spec);
  });

  it('sizes a 200-pixel body size for an 80-pixel column down to the column', () => {
    const spec = baseSpec({ grid: { bodySize: [200, 200], maxColumns: 1, margin: [0, 0, 0, 0] } });
    const doc: FlowDocument = { blocks: [para('p1', words(20, 'size'))] };
    const layout = layoutFlow(doc, spec, env(80, 600, 'paged-x'));
    expect(layout.body.font.size, 'glyphs are larger than their column').toBeLessThanOrEqual(layout.body.columnWidth);
    expectRound5Invariants(doc, layout, spec);
  });

  it('keeps a crosshead of scale 100 inside the 263-pixel slot it is set in', () => {
    const spec = baseSpec({ body: { crosshead: { family: '"Stub Sans", sans-serif', weight: 700, style: 'normal', scale: 100, leading: 1.2, spaceBefore: 1 } } });
    const doc: FlowDocument = { blocks: [para('p0', words(30, 'lead')), crosshead('h1', 'Heading'), para('p1', words(40, 'after'))] };
    const layout = layoutFlow(doc, spec, env(500, 600, 'paged-x'));
    for (const line of linesOf(layout, 'h1')) {
      expect(line.width, `crosshead line is ${line.width} px in a ${line.slotWidth} px slot`).toBeLessThanOrEqual(line.slotWidth + 0.01);
    }
    expectRound5Invariants(doc, layout, spec);
  });
});

// ─── K (→ E3): a quote and a space are not a drop cap ───────────────────────────────────────────

describe('K (E3): a paragraph opening with a quote and a space has no drop cap', () => {
  it('sets "“ 11 men…" without a cap made of the quote and the space', () => {
    const spec = baseSpec({ body: { dropCap: { lines: 3 } } });
    const doc: FlowDocument = { blocks: [para('p1', '“ 11 men went up the hill and down again ' + words(20, 'more'))] };
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    const cap = findObject(layout, 'p1-cap');
    expect(cap, 'a cap was made from a quote and a space').toBeUndefined();
    expectRound5Invariants(doc, layout, spec);
  });
});

