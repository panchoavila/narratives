// layout.test.ts — spec §6: `layoutFlow`, end to end.
//
// Two groups. The matrix runs the invariants from fixtures.ts over the reference article at four
// viewports, both paging modes and four specs. The exact group builds small documents whose line
// breaks, frames and object positions can be worked out by hand.
//
// Hand arithmetic, shared by the exact tests:
//   1440 x 900 paged-x: 4 columns of 316px at x 50, 391, 732, 1073; top 50; 25px rows; 32 rows (800px).
//   1440 x 200 paged-x: the same columns, but frames are 100px tall, so each column holds 4 rows
//     at y 50, 75, 100, 125.
//   390 x 844 paged-y: one column of 294px at x 48, 17px type, 24px rows, unbounded.
//   Words at 18px: 'aaaa' = 36, space = 4.5. A line of 7 words is 279px, 8 words 319.5px.
//   With maxShrink 0.06 (1.08px per gap at 18px), 8 words squeeze into 316px with -0.5px per gap.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  layoutFlow,
  type FlowBlock,
  type FlowDocument,
  type FlowLayout,
  type FlowMode,
  type FlowSpec,
  type Hyphenator,
  type MediaObjectBlock,
  type ObjectRole,
  type PlacedLine,
  type PageLayout,
  type PlacedObject,
  type ParagraphBlock,
  type RoleRule,
  type TextObjectBlock,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import {
  allLines,
  allObjects,
  baseSpec,
  EPS,
  env,
  expectFinite,
  expectJustification,
  expectNoOverlap,
  expectObjectsPlacedOnce,
  expectOnGrid,
  expectTextPreserved,
  findObject,
  linesOf,
  pageAt,
  paintedRight,
  sampleDocument,
  syllableHyphenator,
  words,
  SHY,
} from './fixtures';
import { installStubCanvas } from './stub-canvas';

beforeAll(() => {
  installStubCanvas();
});

const TIMEOUT = 5000;

// ─── Builders ────────────────────────────────────────────────────────────────────────────────────

function doc(...blocks: FlowBlock[]): FlowDocument {
  return { blocks };
}

function para(id: string, text: string, role: 'body' | 'crosshead' = 'body'): ParagraphBlock {
  return { kind: 'paragraph', id, role, runs: [{ text }] };
}

function textObj(id: string, role: ObjectRole, text: string): TextObjectBlock {
  return { kind: 'text-object', id, role, runs: [{ text }] };
}

function mediaObj(id: string, role: ObjectRole, extra: Partial<MediaObjectBlock> = {}): MediaObjectBlock {
  return { kind: 'media-object', id, role, src: `${id}.jpg`, alt: id, ...extra };
}

/** A rule that places an object at the top of column 0, one column wide, with no clearance. */
function topRule(lines: number, extra: Partial<RoleRule['place']> = {}): RoleRule {
  return {
    fit: { kind: 'none' },
    place: { column: 0, span: 1, vertical: 'top', clearance: 0, ...extra },
    height: { kind: 'lines', lines },
  };
}

/** Words of a line, from its fragments. */
function wordsOf(line: PlacedLine): number {
  return line.fragments.map((f) => f.text).join('').trim().split(' ').length;
}

function contentBottom(layout: FlowLayout, page = layout.pages[layout.pages.length - 1]): number {
  const lineBottoms = page.lines.map((l) => l.y + l.height);
  const objectBottoms = page.objects.map((o) => o.rect.y + o.rect.height);
  return Math.max(...lineBottoms, ...objectBottoms);
}

// ─── The matrix ──────────────────────────────────────────────────────────────────────────────────

const VIEWPORTS: Array<[number, number]> = [
  [1440, 900],
  [1180, 820],
  [820, 1180],
  [390, 844],
];
const MODES: FlowMode[] = ['paged-x', 'paged-y'];

interface MatrixSpec {
  name: string;
  spec: FlowSpec;
  hyphen: boolean;
}

const MATRIX_SPECS: MatrixSpec[] = [
  { name: 'base', spec: baseSpec(), hyphen: false },
  { name: 'ragged', spec: baseSpec({ body: { justify: false } }), hyphen: false },
  {
    name: 'hyphenated with drop cap and paragraph gap',
    spec: baseSpec({ body: { hyphenate: true, dropCap: { lines: 3 }, paragraphGap: 1 } }),
    hyphen: true,
  },
  {
    name: 'no squeeze with tight widows and orphans',
    spec: baseSpec({ body: { maxShrink: 0, widows: 3, orphans: 3, indent: 0 } }),
    hyphen: false,
  },
];

const cache = new Map<string, FlowLayout>();

function sampleLayout(width: number, height: number, mode: FlowMode, spec: FlowSpec, hyphen: boolean): FlowLayout {
  const key = [width, height, mode, hyphen, JSON.stringify(spec)].join('|');
  const cached = cache.get(key);
  if (cached) return cached;
  const hyphenator: Hyphenator | null = hyphen ? syllableHyphenator() : null;
  const layout = layoutFlow(sampleDocument(), spec, env(width, height, mode, { hyphenator }));
  expect(layout.pages.length, 'layout produced no pages').toBeGreaterThan(0);
  cache.set(key, layout);
  return layout;
}

describe.each(VIEWPORTS)('reference article at %i x %i', (width, height) => {
  describe.each(MODES)('%s', (mode) => {
    describe.each(MATRIX_SPECS)('$name', ({ spec, hyphen }) => {
      it('places every character in order, and every object exactly once', () => {
        const doc = sampleDocument();
        const layout = sampleLayout(width, height, mode, spec, hyphen);
        expect(layout.pages.length).toBeGreaterThan(0);
        expectTextPreserved(doc, layout, spec);
        expectObjectsPlacedOnce(doc, layout);
      }, TIMEOUT);

      it('paints no line over another line, an object or its frame edge', () => {
        expectNoOverlap(sampleLayout(width, height, mode, spec, hyphen));
      }, TIMEOUT);

      it('contains no NaN, Infinity or negative size', () => {
        expectFinite(sampleLayout(width, height, mode, spec, hyphen));
      }, TIMEOUT);

      it('justifies only lines that are not last, within the stretch and shrink limits', () => {
        expectJustification(sampleLayout(width, height, mode, spec, hyphen), spec);
      }, TIMEOUT);

      it('puts every line and object on the baseline grid of its frame', () => {
        expectOnGrid(sampleLayout(width, height, mode, spec, hyphen));
      }, TIMEOUT);
    });
  });
});

// ─── Guards ──────────────────────────────────────────────────────────────────────────────────────

describe('guards: viewports that cannot hold a page', () => {
  it('lays out no pages for a zero-width viewport, with zeroed extent and stats', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(0, 900, 'paged-x'));
    expect(layout.pages).toEqual([]);
    expect(layout.extent).toEqual({ width: 0, height: 0 });
    expect(layout.body.columns).toBe(0);
    expect(layout.stats.lines).toBe(0);
    expect(layout.stats.objects).toBe(0);
    expect(layout.stats.droppedObjects).toEqual([]);
  }, TIMEOUT);

  it('lays out no pages for a zero-height viewport, so no NaN reaches the result', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 0, 'paged-y'));
    expect(layout.pages).toEqual([]);
    expectFinite(layout);
  }, TIMEOUT);

  it('lays out no pages for a non-finite viewport', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(Number.NaN, 900, 'paged-x'));
    expect(layout.pages).toEqual([]);
  }, TIMEOUT);

  it('lays a zero-height frame out on one unbounded page, with every line finite and in order', () => {
    // 1440 x 100: the frame is 0px tall, under four lines, so the page is unbounded.
    const doc = sampleDocument();
    const layout = layoutFlow(doc, baseSpec(), env(1440, 100, 'paged-x'));
    expect(layout.pages.length).toBe(1);
    expect(Number.isFinite(pageAt(layout, 0).rect.height)).toBe(true);
    expectFinite(layout);
    expectTextPreserved(doc, layout, baseSpec());
  }, TIMEOUT);
});

// ─── Text across breaks ──────────────────────────────────────────────────────────────────────────

describe('text across page and column breaks', () => {
  it('loses, duplicates and reorders no character when a paragraph breaks across pages', () => {
    // 1440 x 200 holds 16 rows per page, so the article spans many pages.
    const doc = sampleDocument();
    const layout = layoutFlow(doc, baseSpec(), env(1440, 200, 'paged-x'));
    expect(layout.pages.length).toBeGreaterThan(3);
    expectTextPreserved(doc, layout, baseSpec());
  }, TIMEOUT);

  it('keeps each word on exactly one line when a long paragraph crosses a column break', () => {
    // 35 words at 18px: lines of 8, 8, 8, 8, 3. Four lines fill column 0 of a 200px-high frame.
    const doc = doc1(para('p1', words(35)));
    const layout = layoutFlow(doc, baseSpec({ roles: {} }), env(1440, 200, 'paged-x'));
    expectTextPreserved(doc, layout, baseSpec());
    const counts = linesOf(layout, 'p1').map(wordsOf);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(35);
  }, TIMEOUT);
});

function doc1(block: FlowBlock): FlowDocument {
  return { blocks: [block] };
}

// ─── Line breaking and justification ─────────────────────────────────────────────────────────────

const ONE_PAGE_SPEC = (overrides: Parameters<typeof baseSpec>[0] = {}): FlowSpec =>
  baseSpec({ roles: {}, ...overrides });

describe('line breaking and justification at 1440 x 900', () => {
  it('squeezes eight words into the 316px slot, because -0.5px per gap costs less than stretching seven', () => {
    // 23 words: line 1 takes 8 words (319.5px) squeezed by 0.5px per gap; line 2 the same;
    // line 3 holds the last 7 words, which are ragged.
    const layout = layoutFlow(doc1(para('p1', words(23))), ONE_PAGE_SPEC(), env(1440, 900, 'paged-x'));
    const lines = linesOf(layout, 'p1');
    expect(lines.map((l) => l.width)).toEqual([319.5, 319.5, 279]);
    expect(lines.map((l) => l.wordSpacing)).toEqual([-0.5, -0.5, 0]);
    expect(lines.map((l) => l.justified)).toEqual([true, true, false]);
    expect(lines.map((l) => l.slotWidth)).toEqual([316, 316, 316]);
    expect(lines.map((l) => l.x)).toEqual([50, 50, 50]);
    expect(lines.map((l) => l.y)).toEqual([50, 75, 100]);
    expect(lines.map((l) => l.first)).toEqual([true, false, false]);
    expect(lines.map((l) => l.last)).toEqual([false, false, true]);
  }, TIMEOUT);

  it('stretches seven words to the full measure when the stretch is within maxStretch', () => {
    // 'aaaa' x 7, then a 10-letter word (90px) that cannot join the line even squeezed.
    // Seven words are 279px; 37px spread over 6 gaps is 6.17px, under 0.35 x 18 = 6.3px.
    const text = `${words(7)} aaaaaaaaaa ${words(2)}`;
    const layout = layoutFlow(doc1(para('p1', text)), ONE_PAGE_SPEC(), env(1440, 900, 'paged-x'));
    const [first] = linesOf(layout, 'p1');
    expect(wordsOf(first)).toBe(7);
    expect(first.justified).toBe(true);
    expect(first.wordSpacing).toBeCloseTo(37 / 6, 6);
    expect(first.width + first.wordSpacing * 6).toBeCloseTo(316, 6);
  }, TIMEOUT);

  it('leaves a short line ragged rather than stretching it beyond maxStretch', () => {
    // The same text with maxStretch 0.1: 6.17px per gap exceeds 0.1 x 18 = 1.8px.
    const text = `${words(7)} aaaaaaaaaa ${words(2)}`;
    const layout = layoutFlow(doc1(para('p1', text)), ONE_PAGE_SPEC({ body: { maxStretch: 0.1 } }), env(1440, 900, 'paged-x'));
    const [first] = linesOf(layout, 'p1');
    expect(first.justified).toBe(false);
    expect(first.wordSpacing).toBe(0);
    expect(first.width).toBeCloseTo(279, 6);
  }, TIMEOUT);

  it('never justifies the last line of a paragraph', () => {
    const layout = layoutFlow(doc1(para('p1', words(23))), ONE_PAGE_SPEC(), env(1440, 900, 'paged-x'));
    const p1Lines = linesOf(layout, 'p1');
    const last = p1Lines[p1Lines.length - 1];
    expect(last.last).toBe(true);
    expect(last.justified).toBe(false);
    expect(last.wordSpacing).toBe(0);
  }, TIMEOUT);

  it('never squeezes the last line of a paragraph: a squeezed candidate that would end it is refused', () => {
    // Eight words fit one line only when squeezed (319.5px in a 316px slot). A last line is never
    // squeezed, so the paragraph takes the natural break instead and every line stays in its slot.
    const layout = layoutFlow(doc1(para('p1', words(8))), ONE_PAGE_SPEC(), env(1440, 900, 'paged-x'));
    const lines = linesOf(layout, 'p1');
    expect(lines.length).toBe(2);
    const last = lines[lines.length - 1];
    expect(last.last).toBe(true);
    expect(last.justified).toBe(false);
    expect(last.wordSpacing).toBe(0);
    for (const line of lines) expect(paintedRight(line)).toBeLessThanOrEqual(line.x + line.slotWidth + EPS);
  }, TIMEOUT);

  it('cuts an unbreakable word wider than the slot between graphemes, never overflowing', () => {
    // 60 letters at 9px: 35 letters fill 315px, so the word is cut as 35 + 25 letters.
    const layout = layoutFlow(doc1(para('p1', 'x'.repeat(60))), ONE_PAGE_SPEC(), env(1440, 900, 'paged-x'));
    const lines = linesOf(layout, 'p1');
    expect(lines.map((l) => l.fragments.map((f) => f.text).join('').length)).toEqual([35, 25]);
    lines.forEach((l) => expect(paintedRight(l)).toBeLessThanOrEqual(l.x + l.slotWidth + EPS));
    expectNoOverlap(layout);
  }, TIMEOUT);

  it('finishes a short paragraph under large widow and orphan limits', () => {
    // Paragraphs shorter than the limits in a 4-row frame: the rules must not push lines forever.
    const doc = {
      blocks: [para('p1', 'aaaa aaaa'), para('p2', words(20)), para('p3', 'aaaa aaaa'), para('p4', words(9))],
    };
    const spec = ONE_PAGE_SPEC({ body: { widows: 5, orphans: 5 } });
    const layout = layoutFlow(doc, spec, env(1440, 200, 'paged-x'));
    expect(layout.pages.length).toBeGreaterThan(0);
    expectTextPreserved(doc, layout, spec);
    expectNoOverlap(layout);
  }, TIMEOUT);
});

// ─── Indent and paragraph spacing ────────────────────────────────────────────────────────────────

describe('indent and paragraph spacing', () => {
  it('indents the first line of a later paragraph by indent x size and narrows its slot by the same', () => {
    // 1 em = 18px. The second paragraph's first line: x 68, slot 298; seven words (279px) fit it,
    // stretched by 19px over 6 gaps.
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), para('p2', words(20))),
      ONE_PAGE_SPEC(),
      env(1440, 900, 'paged-x'),
    );
    const [first] = linesOf(layout, 'p2');
    expect(first.x).toBe(68);
    expect(first.slotWidth).toBe(298);
    expect(first.width).toBeCloseTo(279, 6);
    expect(first.wordSpacing).toBeCloseTo(19 / 6, 6);
  }, TIMEOUT);

  it('keeps the first paragraph of the piece flush', () => {
    const layout = layoutFlow(doc(para('p1', words(20))), ONE_PAGE_SPEC(), env(1440, 900, 'paged-x'));
    expect(linesOf(layout, 'p1')[0].x).toBe(50);
  }, TIMEOUT);

  it('keeps a paragraph that follows a crosshead flush, with one blank row above the crosshead', () => {
    // p1 on row 0; one blank row (spaceBefore 1) on row 1; the crosshead on row 2; p2 on row 3.
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), para('h1', 'Head', 'crosshead'), para('p2', words(20))),
      ONE_PAGE_SPEC(),
      env(1440, 900, 'paged-x'),
    );
    expect(linesOf(layout, 'h1')[0].y).toBe(100);
    const [p2] = linesOf(layout, 'p2');
    expect(p2.x).toBe(50);
    expect(p2.slotWidth).toBe(316);
    expect(p2.y).toBe(125);
  }, TIMEOUT);

  it('keeps a paragraph that follows an in-flow object flush, one clearance row below the object', () => {
    // The text object sits on row 2 (row 1 plus clearance 1), and text resumes on row 4.
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), textObj('q1', 'quote', 'Note'), para('p2', words(20))),
      ONE_PAGE_SPEC(),
      env(1440, 900, 'paged-x'),
    );
    expect(findObject(layout, 'q1')!.rect.y).toBe(100);
    const [p2] = linesOf(layout, 'p2');
    expect(p2.x).toBe(50);
    expect(p2.y).toBe(150);
  }, TIMEOUT);

  it('adds paragraphGap blank rows between paragraphs', () => {
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), para('p2', 'aaaa aaaa')),
      ONE_PAGE_SPEC({ body: { paragraphGap: 1 } }),
      env(1440, 900, 'paged-x'),
    );
    expect(linesOf(layout, 'p2')[0].y).toBe(100);
  }, TIMEOUT);

  it('adds no paragraph gap at the top of a column', () => {
    // 1440 x 200: p1 fills rows 0-2. With a gap, p2 would need row 4, which column 0 lacks, so p2
    // starts at the top of column 1 with no gap above it.
    const layout = layoutFlow(
      doc(para('p1', words(22)), para('p2', words(20))),
      ONE_PAGE_SPEC({ body: { paragraphGap: 1 } }),
      env(1440, 200, 'paged-x'),
    );
    const [p2] = linesOf(layout, 'p2');
    expect(p2.column).toBe(1);
    expect(p2.y).toBe(40); // E8a: 40px top margin at 200px
  }, TIMEOUT);

  it('leaves no blank row above a crosshead that starts a column', () => {
    // p1 takes two rows, so a crosshead needs three free rows and moves to column 1 at the top.
    const layout = layoutFlow(
      doc(para('p1', words(14)), para('h1', 'Head', 'crosshead'), para('p2', words(20))),
      ONE_PAGE_SPEC(),
      env(1440, 200, 'paged-x'),
    );
    const head = linesOf(layout, 'h1')[0];
    expect(head.column).toBe(1);
    expect(head.y).toBe(40); // E8a: 40px top margin at 200px
  }, TIMEOUT);
});

// ─── Crosshead keep-with-next and orphans and widows ─────────────────────────────────────────────

describe('keep-with-next, orphans and widows', () => {
  it('moves a crosshead to the next column when its column has fewer than crossheadRows + 2 free rows', () => {
    // A 2-line paragraph leaves 2 free rows on a 4-row column; a 1-row crosshead needs 3.
    const layout = layoutFlow(
      doc(para('p1', words(14)), para('h1', 'Head', 'crosshead'), para('p2', words(40))),
      ONE_PAGE_SPEC({ body: { crosshead: { ...baseSpec().body.crosshead, spaceBefore: 1 } } }),
      env(1440, 200, 'paged-x'),
    );
    expect(linesOf(layout, 'h1')[0].column).toBe(1);
  }, TIMEOUT);

  it('keeps a crosshead in its column when exactly crossheadRows + 2 rows are free', () => {
    // One line on row 0 leaves rows 1 to 3 free: three rows for a one-row crosshead.
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), para('h1', 'Head', 'crosshead'), para('p2', words(40))),
      ONE_PAGE_SPEC({ body: { crosshead: { ...baseSpec().body.crosshead, spaceBefore: 0 } } }),
      env(1440, 200, 'paged-x'),
    );
    const head = linesOf(layout, 'h1')[0];
    expect(head.column).toBe(0);
    expect(head.y).toBe(65); // E8a: 40px top margin at 200px
  }, TIMEOUT);

  it('moves a paragraph to the next column when only one line would be left at the foot of this one', () => {
    // p1 takes rows 0-2 (3 lines). p2 would have one line on row 3, below orphans 2, so it starts at
    // the top of column 1.
    const layout = layoutFlow(doc(para('p1', words(22)), para('p2', words(20))), ONE_PAGE_SPEC(), env(1440, 200, 'paged-x'));
    expect(linesOf(layout, 'p1').every((l) => l.column === 0)).toBe(true);
    const [p2] = linesOf(layout, 'p2');
    expect(p2.column).toBe(1);
    expect(p2.y).toBe(40); // E8a: 40px top margin at 200px
  }, TIMEOUT);

  it('pulls a widow back into the next column so that it has the widows minimum of lines', () => {
    // 35 words break 8, 8, 8, 8, 3. Column 0 holds four lines; a single line on column 1 is a widow,
    // so the fourth line moves with it: columns get 3 and 2 lines.
    const layout = layoutFlow(doc1(para('p1', words(35))), ONE_PAGE_SPEC(), env(1440, 200, 'paged-x'));
    const lines = linesOf(layout, 'p1');
    expect(lines.map((l) => l.column)).toEqual([0, 0, 0, 1, 1]);
    expect(lines.slice(3).map(wordsOf)).toEqual([8, 3]);
  }, TIMEOUT);
});

// ─── Drop caps ───────────────────────────────────────────────────────────────────────────────────

describe('drop cap geometry', () => {
  const capSpec = (lines: number, roles: FlowSpec['roles'] = {}) =>
    baseSpec({ roles, body: { dropCap: { lines } } });

  it('reserves the cap at the column left, two rows tall, and wraps two lines around it', () => {
    // Cap size: target (2 - 1) x 25 + 0.7 x 18 = 37.6px cap height, / 0.7 = 53.71px font.
    // Reserved width: ceil(0.5 x 53.71 + 0.5 x 18) = ceil(35.855) = 36px.
    const layout = layoutFlow(doc1(para('p1', words(40))), capSpec(2), env(1440, 900, 'paged-x'));
    const cap = findObject(layout, 'p1-cap')!;
    expect(cap.kind).toBe('dropcap');
    expect(cap.role).toBe('dropcap');
    expect(cap.rect).toEqual({ x: 50, y: 50, width: 36, height: 50 });
    expect(cap.lines![0].text).toBe('a');
    expect(cap.lines![0].font.size).toBeCloseTo(53.71, 2);
    const lines = linesOf(layout, 'p1');
    expect(lines.slice(0, 2).map((l) => [l.x, l.slotWidth])).toEqual([[86, 280], [86, 280]]);
    expect([lines[2].x, lines[2].slotWidth]).toEqual([50, 316]);
  }, TIMEOUT);

  it('does not indent the drop-cap paragraph, so its first line starts at the cap edge', () => {
    const layout = layoutFlow(doc1(para('p1', words(40))), capSpec(2), env(1440, 900, 'paged-x'));
    expect(linesOf(layout, 'p1')[0].x).toBe(86);
  }, TIMEOUT);

  it('keeps the next paragraph clear of a drop cap taller than the paragraph that holds it', () => {
    // C6: a cap is as tall as the lines beside it. p1 is one line, so it takes no cap (a cap needs two
    // lines); p2 starts on row 1 at the column edge, not beside any cap.
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), para('p2', words(12))),
      capSpec(3),
      env(1440, 900, 'paged-x'),
    );
    expect(findObject(layout, 'p1-cap')).toBeUndefined();
    const p2 = linesOf(layout, 'p2');
    expect(p2[0].y).toBe(50 + 25);
    // Not beside a cap: the first line may be indented (68), the rest start at the column edge (50).
    p2.forEach((l) => expect([50, 68]).toContain(l.x));
    expectNoOverlap(layout);
  }, TIMEOUT);

  it('moves the drop-cap paragraph to the next column when its rows are not free where it starts', () => {
    // A 2-row hero sits at the top of column 0 at 1440 x 200. p1 needs 3 free rows: column 0 has 2,
    // so the cap and its paragraph start at the top of column 1.
    const hero = mediaObj('hero', 'hero');
    const layout = layoutFlow(
      doc(hero, para('p1', words(40))),
      baseSpec({ roles: { hero: topRule(2) }, body: { dropCap: { lines: 3 } } }),
      env(1440, 200, 'paged-x'),
    );
    expect(findObject(layout, 'hero')!.rect.y).toBe(40); // E8a: 40px top margin at 200px
    const cap = findObject(layout, 'p1-cap')!;
    expect(cap.rect.x).toBe(391);
    expect(cap.rect.y).toBe(40);
  }, TIMEOUT);
});

// ─── Objects ─────────────────────────────────────────────────────────────────────────────────────

describe('objects: opening, spanning and sizing', () => {
  it('places the kicker at the top of page 0 before any text, and the headline below it', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-x'));
    const kicker = findObject(layout, 'kicker')!;
    const headline = findObject(layout, 'headline')!;
    expect(kicker.page).toBe(0);
    expect(kicker.rect.y).toBe(50);
    expect(headline.rect.y).toBeGreaterThanOrEqual(kicker.rect.y + kicker.rect.height - EPS);
    expect(linesOf(layout, 'p1')[0].y).toBeGreaterThanOrEqual(headline.rect.y);
  }, TIMEOUT);

  it('spans every column from its start column: 1073 + 316 - 50 = 1339px wide', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-x'));
    const headline = findObject(layout, 'headline')!;
    expect(headline.rect.x).toBe(50);
    expect(headline.rect.width).toBe(1339);
  }, TIMEOUT);

  it('keeps an inset object on its side, at half the span, rounded: 158px hugging the end', () => {
    const hero = mediaObj('hero', 'hero');
    const rule: RoleRule = {
      fit: { kind: 'none' },
      place: { column: 0, span: 1, vertical: 'top', clearance: 0, inset: { side: 'end', fraction: 0.5 } },
      height: { kind: 'lines', lines: 2 },
    };
    const layout = layoutFlow(doc(hero, para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 900, 'paged-x'));
    const rect = findObject(layout, 'hero')!.rect;
    expect(rect.width).toBe(158);
    expect(rect.x).toBe(50 + 316 - 158);
  }, TIMEOUT);

  it('clamps an inset fraction below 0.2 to 0.2: 316 x 0.2 = 63px hugging the start', () => {
    const rule: RoleRule = {
      fit: { kind: 'none' },
      place: { column: 0, span: 1, vertical: 'top', clearance: 0, inset: { side: 'start', fraction: 0.1 } },
      height: { kind: 'lines', lines: 2 },
    };
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 900, 'paged-x'));
    const rect = findObject(layout, 'hero')!.rect;
    expect(rect.width).toBe(63);
    expect(rect.x).toBe(50);
  }, TIMEOUT);

  it('counts a negative column from the last column: -1 is the fourth column at x 1073', () => {
    const rule = topRule(2, { column: -1 });
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 900, 'paged-x'));
    const rect = findObject(layout, 'hero')!.rect;
    expect(rect.x).toBe(1073);
    expect(rect.width).toBe(316);
  }, TIMEOUT);

  it('makes an aspect object width / ratio tall, rounded up to whole lines: 316 / 1.5 = 210.67 -> 225px', () => {
    const rule: RoleRule = { fit: { kind: 'none' }, place: { column: 0, span: 1, vertical: 'top', clearance: 0 }, height: { kind: 'aspect', ratio: 1.5 } };
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 900, 'paged-x'));
    expect(findObject(layout, 'hero')!.rect.height).toBe(225);
  }, TIMEOUT);

  it('lets a media block own aspect override the role ratio: 316 / 2 = 158 -> 175px', () => {
    const rule: RoleRule = { fit: { kind: 'none' }, place: { column: 0, span: 1, vertical: 'top', clearance: 0 }, height: { kind: 'aspect', ratio: 1.5 } };
    const layout = layoutFlow(
      doc(mediaObj('hero', 'hero', { aspect: 2 }), para('p1', 'aaaa')),
      baseSpec({ roles: { hero: rule } }),
      env(1440, 900, 'paged-x'),
    );
    expect(findObject(layout, 'hero')!.rect.height).toBe(175);
  }, TIMEOUT);

  it('runs a fill object from its top to the bottom of the frame: 800px on 1440 x 900', () => {
    const rule: RoleRule = { fit: { kind: 'none' }, place: { column: 0, span: 1, vertical: 'top', clearance: 0 }, height: { kind: 'fill' } };
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 900, 'paged-x'));
    const rect = findObject(layout, 'hero')!.rect;
    expect(rect.y).toBe(50);
    expect(rect.height).toBe(800);
  }, TIMEOUT);

  it('clamps an object taller than its frame to the frame and marks it clipped', () => {
    // 40 lines on a 100px frame: clamped to 100px.
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: topRule(40) } }), env(1440, 200, 'paged-x'));
    const hero = findObject(layout, 'hero')!;
    expect(hero.rect.height).toBe(100);
    expect(hero.clipped).toBe(true);
    expect(layout.stats.clippedObjects).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('places a bottom object against the frame bottom: 150 - 50 = y 100 on a 100px frame', () => {
    const rule = topRule(2, { vertical: 'bottom' });
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 200, 'paged-x'));
    expect(findObject(layout, 'hero')!.rect.y).toBe(90); // E8a: frame 40 to 140, so 140 - 50
  }, TIMEOUT);

  it('places a middle object on the grid: 50 + floor(25 / 25) x 25 = y 75', () => {
    const rule = topRule(2, { vertical: 'middle' });
    const layout = layoutFlow(doc(mediaObj('hero', 'hero'), para('p1', 'aaaa')), baseSpec({ roles: { hero: rule } }), env(1440, 200, 'paged-x'));
    expect(findObject(layout, 'hero')!.rect.y).toBe(65); // E8a: frame top 40, + 25
  }, TIMEOUT);

  it('slides an object that collides with an earlier object down until it is free', () => {
    // Hero A takes rows 0-1 (y 50-100). Hero B, placed at the top, slides to row 2 (y 100).
    const layout = layoutFlow(
      doc(mediaObj('a', 'hero'), mediaObj('b', 'hero')),
      baseSpec({ roles: { hero: topRule(2) } }),
      env(1440, 200, 'paged-x'),
    );
    expect(findObject(layout, 'a')!.rect.y).toBe(40); // E8a: frame top 40
    expect(findObject(layout, 'b')!.rect.y).toBe(90);
  }, TIMEOUT);

  it('slides a bottom object that collides with an earlier object up until it is free', () => {
    // A (2 rows) sits at 100-150. B (1 row) starts at 125, collides, and slides up to 75-100.
    const layout = layoutFlow(
      doc(mediaObj('a', 'hero'), mediaObj('b', 'media')),
      baseSpec({ roles: { hero: topRule(2, { vertical: 'bottom' }), media: topRule(1, { vertical: 'bottom' }) } }),
      env(1440, 200, 'paged-x'),
    );
    expect(findObject(layout, 'a')!.rect.y).toBe(90); // E8a: frame bottom 140
    expect(findObject(layout, 'b')!.rect.y).toBe(65);
  }, TIMEOUT);

  it('carries an object that cannot fit below its neighbour to the next page, at the top', () => {
    // A takes rows 0-2 (50-125). B needs 2 rows and only row 3 is free, so it is carried to page 1.
    const layout = layoutFlow(
      doc(mediaObj('a', 'hero'), mediaObj('b', 'media')),
      baseSpec({ roles: { hero: topRule(3), media: topRule(2) } }),
      env(1440, 200, 'paged-x'),
    );
    const b = findObject(layout, 'b')!;
    expect(layout.pages.length).toBe(2);
    expect(b.page).toBe(1);
    expect(b.rect.y).toBe(40); // E8a: frame top 40
    expectObjectsPlacedOnce(doc(mediaObj('a', 'hero'), mediaObj('b', 'media')), layout);
  }, TIMEOUT);
});

describe('objects: in-flow, page-positioned and carried', () => {
  it('places an object without a role rule at the current row plus clearance, and resumes text below it', () => {
    // p1 on row 0. The note sits on row 2 (row 1 plus clearance 1), 25px tall. Text resumes on row 4.
    const layout = layoutFlow(
      doc(para('p1', 'aaaa aaaa'), textObj('n1', 'signature', 'Note'), para('p2', 'aaaa aaaa')),
      ONE_PAGE_SPEC(),
      env(1440, 900, 'paged-x'),
    );
    const note = findObject(layout, 'n1')!;
    expect(note.rect.y).toBe(100);
    expect(note.rect.height).toBe(25);
    expect(linesOf(layout, 'p2')[0].y).toBe(150);
  }, TIMEOUT);

  it('places a page-positioned object first at the top of its column, with the text before it flowing below', () => {
    // The media block is reached after p1. Its page restarts: the object takes rows 0-3 (100px), then
    // p1 begins on row 4 (y 150).
    const spec = baseSpec({ roles: { media: { fit: { kind: 'none' }, place: { column: 'anchor', span: 1, vertical: 'top', clearance: 0 }, height: { kind: 'lines', lines: 4 } } } });
    const layout = layoutFlow(doc(para('p1', 'aaaa aaaa'), mediaObj('m1', 'media'), para('p2', 'aaaa aaaa')), spec, env(1440, 900, 'paged-x'));
    const m1 = findObject(layout, 'm1')!;
    expect(m1.page).toBe(0);
    expect(m1.rect).toEqual({ x: 50, y: 50, width: 316, height: 100 });
    expect(linesOf(layout, 'p1')[0].y).toBe(150);
    expectObjectsPlacedOnce(doc(para('p1', 'aaaa aaaa'), mediaObj('m1', 'media'), para('p2', 'aaaa aaaa')), layout);
  }, TIMEOUT);

  it('lets an in-flow object anchored after the text has filled the last column be placed, not dropped', () => {
    // 1440 x 200 with a long article: the media block is anchored after many pages of text. It is
    // clamped to the 100px frame height and must still be placed exactly once.
    const doc2 = doc(para('p1', words(60)), mediaObj('m1', 'media', { aspect: 1.5 }), para('p2', words(60)));
    const layout = layoutFlow(doc2, baseSpec(), env(1440, 200, 'paged-x'));
    expectObjectsPlacedOnce(doc2, layout);
    expect(findObject(layout, 'm1')!.clipped).toBe(true);
  }, TIMEOUT);

  it('keeps every line at least minSlot wide when an in-flow object spans two columns', () => {
    // A span-2 obstacle blocks two columns for its rows. Rows beside it are skipped, not zero-width.
    // minSlot = max(0.3 x 316, 6 x 18) = 108px.
    const doc2 = doc(para('p1', words(30)), mediaObj('m1', 'media'), para('p2', words(30)));
    const layout = layoutFlow(doc2, baseSpec(), env(1440, 900, 'paged-x'));
    const lines = allLines(layout);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => expect(l.slotWidth).toBeGreaterThanOrEqual(108 - EPS));
    expectTextPreserved(doc2, layout, baseSpec());
    expectObjectsPlacedOnce(doc2, layout);
  }, TIMEOUT);

  it('places every object of the article exactly once, with page-positioned media on a tight page', () => {
    const spec = baseSpec({ roles: { ...sampleSpecRoles(), media: topRule(3, { column: 'anchor' }) } });
    const layout = layoutFlow(sampleDocument(), spec, env(1440, 200, 'paged-x'));
    expectObjectsPlacedOnce(sampleDocument(), layout);
    expectNoOverlap(layout);
  }, TIMEOUT);
});

function sampleSpecRoles(): FlowSpec['roles'] {
  return baseSpec().roles;
}

// ─── Restart bounds ──────────────────────────────────────────────────────────────────────────────

describe('bounded work', () => {
  it('finishes a document of many objects on a tight page and places each once', () => {
    const blocks: FlowBlock[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(para(`p${i}`, words(12)));
      blocks.push(mediaObj(`m${i}`, 'media'));
    }
    const d = doc(...blocks);
    const layout = layoutFlow(d, baseSpec({ roles: { media: topRule(2, { column: 'anchor' }) } }), env(1440, 200, 'paged-x'));
    expectObjectsPlacedOnce(d, layout);
    expectTextPreserved(d, layout, baseSpec());
    expect(layout.pages.length).toBeLessThanOrEqual(2000);
  }, TIMEOUT);
});

// ─── Page geometry in the result ─────────────────────────────────────────────────────────────────

describe('result geometry', () => {
  it('sets the paged-x extent to pages x viewport width and the viewport height', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-x'));
    expect(layout.extent).toEqual({ width: layout.pages.length * 1440, height: 900 });
  }, TIMEOUT);

  it('sets the paged-y extent to the viewport width and the sum of page heights', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-y'));
    const total = layout.pages.reduce((sum: number, p: PageLayout) => sum + p.rect.height, 0);
    expect(layout.extent.width).toBe(1440);
    expect(layout.extent.height).toBeCloseTo(total, 6);
  }, TIMEOUT);

  it('keeps every full paged-y page at the viewport height and stacks them one viewport apart', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-y'));
    layout.pages.slice(0, -1).forEach((p: PageLayout, i: number) => {
      expect(p.rect.height).toBe(900);
      expect(p.rect.y).toBe(i * 900);
    });
  }, TIMEOUT);

  it('shrinks the last paged-y page to its content plus the bottom margin: 50px at 1440 x 900', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-y'));
    const last = layout.pages[layout.pages.length - 1];
    expect(last.rect.height).toBe(contentBottom(layout, last) - last.rect.y + 50);
    expect(last.rect.height).toBeLessThanOrEqual(900);
  }, TIMEOUT);

  it('sizes an unbounded single-column page to its content plus the bottom margin: 144 + 48 = 192px', () => {
    // 390 x 844: one 294px column, 17px type, 24px rows, unbounded. 23 words break 7, 7, 7, 2:
    // four lines from y 48, so the last line ends at 48 + 4 x 24 = 144.
    const layout = layoutFlow(doc1(para('p1', words(23))), ONE_PAGE_SPEC(), env(390, 844, 'paged-y'));
    const page = pageAt(layout, 0);
    expect(layout.pages.length).toBe(1);
    expect(linesOf(layout, 'p1').length).toBe(4);
    expect(page.rect.height).toBe(192);
    // The frame ends where the content ends; the bottom margin belongs to the page, not the frame.
    expect(page.frames[0].y + page.frames[0].height).toBe(144);
    expectFinite(layout);
  }, TIMEOUT);

  it('reports the layout body grid it used', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-x'));
    expect(layout.body.lineHeight).toBe(25);
    expect(layout.body.columns).toBe(4);
    expect(layout.body.columnWidth).toBe(316);
    expect(layout.viewport).toEqual({ width: 1440, height: 900 });
    expect(layout.mode).toBe('paged-x');
    expect(layout.specId).toBe('test-spec');
  }, TIMEOUT);
});

// ─── Stats ───────────────────────────────────────────────────────────────────────────────────────

describe('stats', () => {
  it('counts lines, justified and ragged body lines, hyphenated lines and objects from the placed result', () => {
    const spec = baseSpec();
    const layout = sampleLayout(1440, 900, 'paged-x', spec, false);
    const lines = allLines(layout);
    const objects: PlacedObject[] = allObjects(layout);
    expect(layout.stats.lines).toBe(lines.length);
    expect(layout.stats.justified).toBe(lines.filter((l) => l.justified).length);
    expect(layout.stats.ragged).toBe(lines.filter((l) => l.role === 'body' && !l.last && !l.justified).length);
    expect(layout.stats.hyphenated).toBe(lines.filter((l) => l.hyphenated).length);
    expect(layout.stats.objects).toBe(objects.length);
    expect(layout.stats.clippedObjects).toBe(objects.filter((o) => o.clipped).length);
    expect(layout.stats.droppedObjects).toEqual([]);
  }, TIMEOUT);
});

// ─── Hyphenation in the flow ─────────────────────────────────────────────────────────────────────

describe('hyphenation in the flow', () => {
  it('never paints a soft hyphen, and paints the hyphen only at a line end', () => {
    const spec = baseSpec({ body: { hyphenate: true } });
    const layout = sampleLayout(1440, 900, 'paged-x', spec, true);
    for (const line of allLines(layout)) {
      for (const f of line.fragments) expect(f.text.includes(SHY)).toBe(false);
      if (line.hyphenated) expect(line.fragments[line.fragments.length - 1].text.endsWith('-')).toBe(true);
    }
    expect(layout.stats.hyphenated).toBeGreaterThan(0);
  }, TIMEOUT);

  it('hyphenates nothing when the spec does not ask for it, even with a hyphenator in the environment', () => {
    const layout = sampleLayout(1440, 900, 'paged-x', baseSpec(), true);
    expect(layout.stats.hyphenated).toBe(0);
  }, TIMEOUT);

  it('never hyphenates a crosshead line', () => {
    const spec = baseSpec({ body: { hyphenate: true } });
    const layout = sampleLayout(1440, 900, 'paged-x', spec, true);
    expect(allLines(layout).filter((l) => l.role === 'crosshead').every((l) => !l.hyphenated)).toBe(true);
  }, TIMEOUT);

  it('never breaks a link: no fragment of an href run contains a soft hyphen or ends in a painted hyphen', () => {
    const spec = baseSpec({ body: { hyphenate: true } });
    const layout = sampleLayout(1440, 900, 'paged-x', spec, true);
    const linked = allLines(layout).flatMap((l) => l.fragments).filter((f) => f.href !== undefined);
    expect(linked.length).toBeGreaterThan(0);
    for (const f of linked) {
      expect(f.text.includes(SHY)).toBe(false);
      expect(f.text.endsWith('-')).toBe(false);
    }
  }, TIMEOUT);
});

// ─── Text objects ────────────────────────────────────────────────────────────────────────────────

describe('text objects', () => {
  it('keeps every line of a fitted text object inside the object box', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-x'));
    for (const page of layout.pages) {
      for (const obj of page.objects) {
        if (!obj.lines) continue;
        for (const line of obj.lines) {
          expect(line.x).toBeGreaterThanOrEqual(-EPS);
          expect(line.x + line.width).toBeLessThanOrEqual(obj.rect.width + EPS);
          expect(line.y).toBeGreaterThanOrEqual(-EPS);
          expect(line.y + line.height).toBeLessThanOrEqual(obj.rect.height + EPS);
        }
      }
    }
  }, TIMEOUT);
});
