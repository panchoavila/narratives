// review-regressions.test.ts — one test per reproduction of the final review (round 4) and per
// amendment C1–C14. Each guards the defect named in its title.

import { beforeAll, describe, expect, it } from 'vitest';
import { stubWidth } from './stub-canvas';
import {
  buildEditorialPreset,
  createPretextMeasurer,
  fitText,
  layoutFlow,
  parseEditorialMarkdown,
  type EditorialTheme,
  type FlowBlock,
  type FlowDocument,
  type FlowLayout,
  type FlowSpec,
  type FontSpec,
  type PlacedLine,
  type PlacedObject,
  type PageLayout,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import { allLines, allObjects, baseSpec, defaultRoles, env, sampleDocument, words, EPS } from './fixtures';

const THEME: EditorialTheme = {
  display: { family: '"Stub Serif", serif', weight: 700 },
  sans: { family: '"Stub Sans", sans-serif', weight: 700 },
  serif: { family: '"Stub Serif", serif', weight: 400 },
};

// ─── A canvas that rejects invalid fonts the way a browser does ──────────────────────────────────

/** Canvas ignores a font assignment it cannot parse, keeping the previous font. Records every font
 *  that was accepted, so tests can count them. */
const acceptedFonts = new Set<string>();
/** Every font any measurement asked the canvas for, valid or not. */
const attemptedFonts = new Set<string>();

function fontIsValid(font: string): boolean {
  // Only fonts carrying the engine's weight are checked; Pretext's own internal "1px serif" is not ours.
  const match = /^(?:italic )?(-?\d+(?:\.\d+)?|NaN|Infinity|-Infinity) (-?\d+(?:\.\d+)?|NaN|Infinity)px /.exec(font);
  if (!match) return true;
  const weight = Number(match[1]);
  const size = Number(match[2]);
  return Number.isFinite(weight) && weight >= 1 && weight <= 1000 && Number.isFinite(size) && size > 0;
}

class StrictContext {
  private current = '10px sans-serif';
  set font(value: string) {
    attemptedFonts.add(value);
    if (!fontIsValid(value)) return;
    this.current = value;
    acceptedFonts.add(value);
  }
  get font(): string {
    return this.current;
  }
  measureText(text: string) {
    const size = Number(/ (\d+(?:\.\d+)?)px /.exec(this.current)?.[1] ?? 10);
    return {
      width: stubWidth(text, this.current),
      actualBoundingBoxAscent: size * 0.7,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: size * 0.8,
      fontBoundingBoxDescent: size * 0.2,
    };
  }
}

class StrictOffscreenCanvas {
  width: number;
  height: number;
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return new StrictContext();
  }
}

beforeAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = StrictOffscreenCanvas;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────

function para(id: string, text: string) {
  return { kind: 'paragraph' as const, id, role: 'body' as const, runs: [{ text }] };
}

function crosshead(id: string, text: string) {
  return { kind: 'paragraph' as const, id, role: 'crosshead' as const, runs: [{ text }] };
}

function allFonts(layout: FlowLayout): FontSpec[] {
  const fonts: FontSpec[] = [layout.body.font];
  for (const page of layout.pages) {
    for (const line of page.lines) {
      fonts.push(line.font);
      for (const fragment of line.fragments) fonts.push(fragment.font);
    }
    for (const object of page.objects) for (const line of object.lines ?? []) fonts.push(line.font);
  }
  return fonts;
}

function expectSaneLayout(layout: FlowLayout): void {
  for (const font of allFonts(layout)) {
    expect(Number.isFinite(font.weight) && font.weight >= 1 && font.weight <= 1000, `weight ${font.weight}`).toBe(true);
    expect(Number.isFinite(font.size) && font.size >= 1, `size ${font.size}`).toBe(true);
  }
  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const value of [line.x, line.y, line.width, line.slotWidth, line.height, line.baseline, line.wordSpacing]) {
        expect(Number.isFinite(value), `line value ${value}`).toBe(true);
      }
      expect(line.width).toBeGreaterThanOrEqual(0);
      expect(line.slotWidth).toBeGreaterThanOrEqual(0);
      expect(line.height).toBeGreaterThanOrEqual(0);
    }
    for (const object of page.objects) {
      for (const value of [object.rect.x, object.rect.y, object.rect.width, object.rect.height]) {
        expect(Number.isFinite(value), `object value ${value}`).toBe(true);
      }
      expect(object.rect.width).toBeGreaterThanOrEqual(0);
      expect(object.rect.height).toBeGreaterThanOrEqual(0);
    }
  }
  expect(Number.isFinite(layout.body.charsPerLine)).toBe(true);
  expect(layout.body.columns).toBeGreaterThanOrEqual(1);
  expect(layout.stats.fallbackPages).toBe(0);
}

function overlapsLineObject(line: PlacedLine, object: PlacedObject): boolean {
  const r = object.rect;
  return line.x < r.x + r.width && r.x < line.x + line.slotWidth && line.y < r.y + r.height && r.y < line.y + line.height;
}

function expectNoLineOverlaps(layout: FlowLayout): void {
  const problems: string[] = [];
  for (const page of layout.pages) {
    page.lines.forEach((a, i) => {
      page.lines.slice(i + 1).forEach((b) => {
        if (a.x < b.x + b.slotWidth && b.x < a.x + a.slotWidth && a.y < b.y + b.height && b.y < a.y + a.height) {
          problems.push(`line ${a.blockId}@${a.y} over ${b.blockId}@${b.y}`);
        }
      });
      for (const object of page.objects) {
        if (overlapsLineObject(a, object)) problems.push(`line ${a.blockId}@${a.y} over object ${object.id}`);
      }
    });
  }
  expect(problems.slice(0, 5)).toEqual([]);
}

function expectNoPageOverlap(layout: FlowLayout): void {
  const pages: PageLayout[] = layout.pages;
  for (let i = 1; i < pages.length; i += 1) {
    const prev = pages[i - 1].rect;
    const cur = pages[i].rect;
    const overlap =
      layout.mode === 'paged-x'
        ? cur.x < prev.x + prev.width - EPS
        : cur.y < prev.y + prev.height - EPS;
    expect(overlap, `page ${i} overlaps page ${i - 1}`).toBe(false);
  }
}

/** The C3 property: every fragment's source slice, transformed, is its painted text. */
function expectSourceProperty(doc: FlowDocument, layout: FlowLayout, spec: FlowSpec): void {
  const problems: string[] = [];
  const upperCrosshead = spec.body.crosshead.uppercase === true;
  for (const page of layout.pages) {
    for (const line of page.lines) {
      const block = doc.blocks[line.block];
      if (block === undefined || block.kind !== 'paragraph') {
        problems.push(`line ${line.blockId} has no paragraph block ${line.block}`);
        continue;
      }
      const upper = line.role === 'crosshead' && upperCrosshead;
      line.fragments.forEach((fragment, index) => {
        const source = block.runs[fragment.run]?.text ?? '';
        if (!(0 <= fragment.start && fragment.start < fragment.end && fragment.end <= source.length)) {
          problems.push(`${line.blockId}: range ${fragment.start}..${fragment.end} of ${source.length}`);
          return;
        }
        const transformed = T(source.slice(fragment.start, fragment.end), upper);
        const painted = P(fragment.text, line.hyphenated && index === line.fragments.length - 1);
        if (transformed !== painted) problems.push(`${line.blockId}: "${transformed}" vs "${painted}"`);
      });
    }
  }
  expect(problems.slice(0, 5)).toEqual([]);
}

/** T of the C3 property: collapse ordinary whitespace, drop soft hyphens, upper-case when asked. */
function T(text: string, upper: boolean): string {
  const collapsed = text.replace(/[ \t\n\f\v]+/g, ' ').replace(/­/g, '');
  return upper ? collapsed.toUpperCase() : collapsed;
}

/** P of the C3 property: drop soft hyphens and a painted line-end hyphen, trim. */
function P(text: string, lineEndHyphen: boolean): string {
  let out = text.replace(/­/g, '');
  if (lineEndHyphen) out = out.replace(/-$/, '');
  return out.trim();
}

// ─── R1 / C1: no font Canvas would reject ─────────────────────────────────────────────────────────

describe('R1 C1 fonts: weight 800 crosshead and weight 750 body with strong runs never reach Canvas invalid', () => {
  it('lays out a crosshead of weight 800 with a bold run, and a body of weight 750 with a strong run', () => {
    const spec = baseSpec({
      body: { weight: 750, crosshead: { family: '"Stub Sans", sans-serif', weight: 800, style: 'normal', scale: 0.9, leading: 1.2, spaceBefore: 1 } as never },
    });
    const doc: FlowDocument = {
      blocks: [
        { kind: 'paragraph', id: 'h1', role: 'crosshead', runs: [{ text: 'A ' }, { text: 'bold', strong: true }, { text: ' idea' }] },
        { kind: 'paragraph', id: 'p1', role: 'body', runs: [{ text: 'Body ' }, { text: 'strong', strong: true }, { text: ' words ' + words(30, 'body') }] },
      ],
    };
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    expect(linesOfId(layout, 'h1').length).toBeGreaterThan(0);
    expectSaneLayout(layout);
    for (const line of allLines(layout)) {
      for (const fragment of line.fragments) expect(fragment.font.weight).toBeLessThanOrEqual(1000);
    }
    const invalid = [...attemptedFonts].filter((font) => !fontIsValid(font));
    expect(invalid, 'fonts a browser canvas rejects were requested').toEqual([]);
  });
});

function linesOfId(layout: FlowLayout, id: string): PlacedLine[] {
  return allLines(layout).filter((l) => l.blockId === id);
}

// ─── R2 / C2: hostile spec values ─────────────────────────────────────────────────────────────────

describe('R2 C2 hostile spec: every table entry lays out finite, positive, quickly', () => {
  const cases: Array<{ name: string; mutate: (s: FlowSpec) => void; viewport?: 'wide' | 'unbounded' }> = [
    { name: 'crosshead tracking NaN', mutate: (s) => ((s.body.crosshead as { tracking?: number }).tracking = Number.NaN) },
    { name: 'crosshead tracking +Infinity', mutate: (s) => ((s.body.crosshead as { tracking?: number }).tracking = Number.POSITIVE_INFINITY) },
    { name: 'crosshead tracking -Infinity', mutate: (s) => ((s.body.crosshead as { tracking?: number }).tracking = Number.NEGATIVE_INFINITY) },
    { name: 'body weight NaN', mutate: (s) => (s.body.weight = Number.NaN) },
    { name: 'body weight Infinity', mutate: (s) => (s.body.weight = Number.POSITIVE_INFINITY) },
    { name: 'bodySize max 0', mutate: (s) => (s.grid.bodySize = [14, 0]) },
    { name: 'tracking -1 on a style', mutate: (s) => (s.roles.headline = { ...s.roles.headline!, style: { ...s.roles.headline!.style!, tracking: -1 } }) },
    { name: 'leading -1 on the body', mutate: (s) => (s.body.leading = -1) },
    { name: 'measure max 0', mutate: (s) => (s.grid.measure = [20, 30, 0]) },
    { name: 'margins far larger than the viewport', mutate: (s) => (s.grid.margin = [200, 200, 200, 200]) },
    { name: 'maxColumns 1e8', mutate: (s) => (s.grid.maxColumns = 1e8) },
    { name: 'clearance 1e6 on an opening object of an unbounded page', mutate: (s) => { s.roles.headline = { ...s.roles.headline!, place: { ...s.roles.headline!.place, clearance: 1e6 } }; }, viewport: 'unbounded' },
    { name: 'maxLines 1e6 on a headline', mutate: (s) => { s.roles.headline = { ...s.roles.headline!, fit: { kind: 'width', lines: 'auto', maxLines: 1e6, maxScale: 3 } }; } },
    { name: 'scale NaN on the headline', mutate: (s) => { s.roles.headline = { ...s.roles.headline!, style: { ...s.roles.headline!.style!, scale: Number.NaN } }; } },
  ];
  for (const c of cases) {
    it(`${c.name}`, () => {
      const spec = baseSpec({ roles: defaultRoles() });
      c.mutate(spec);
      const viewport = c.viewport === 'unbounded' ? env(390, 844, 'paged-y') : env(1440, 900, 'paged-x');
      const started = Date.now();
      const layout = layoutFlow(sampleDocument(), spec, viewport);
      const elapsed = Date.now() - started;
      expect(elapsed, `${elapsed} ms`).toBeLessThan(500);
      expectSaneLayout(layout);
    });
  }
});

// ─── R3 / C3: upper-case crossheads report offsets inside their text ─────────────────────────────

describe('R3 C3 offsets: an upper-case crosshead wrapped over several lines keeps offsets inside its text', () => {
  it('keeps every fragment range inside its run and in source order in the report preset', () => {
    const text = 'A crosshead long enough to wrap across several lines in a narrow report column for the offset check';
    const doc: FlowDocument = { blocks: [para('p0', words(40, 'lead')), crosshead('h1', text), para('p1', words(60, 'after'))] };
    const spec = buildEditorialPreset('report', THEME);
    const layout = layoutFlow(doc, spec, env(390, 844, 'paged-x'));
    expect(new Set(linesOfId(layout, 'h1').map((l) => l.y)).size, 'crosshead did not wrap').toBeGreaterThan(1);
    expectSourceProperty(doc, layout, spec);
  });
});

// ─── R4 / C4: an unbounded page is one page; no pages overlap ────────────────────────────────────

describe('R4 C4 pages: an unbounded page is one page, and no two pages overlap', () => {
  it('lays the review preset at 390 x 844 paged-y on exactly one page with the badge clear of the headline', () => {
    const spec = buildEditorialPreset('review', THEME);
    const layout = layoutFlow(sampleDocument(), spec, env(390, 844, 'paged-y'));
    expect(layout.pages.length).toBe(1);
    expectNoPageOverlap(layout);
    expectNoLineOverlaps(layout);
    expectSaneLayout(layout);
  });

  it('keeps pages of a short paged-x layout from overlapping', () => {
    const spec = buildEditorialPreset('review', THEME);
    const layout = layoutFlow(sampleDocument(), spec, env(390, 200, 'paged-x'));
    expect(layout.pages.length).toBeGreaterThan(0);
    expectNoPageOverlap(layout);
    expectNoLineOverlaps(layout);
    expectSaneLayout(layout);
  });
});

// ─── R5 / C5: a crosshead never strands away from its paragraph ──────────────────────────────────

describe('R5 C5 crosshead keep-with-next: a crosshead sits with the paragraph it heads', () => {
  const stranded = (layout: FlowLayout): string[] => {
    const lines = allLines(layout);
    const problems: string[] = [];
    lines.forEach((line, i) => {
      if (line.role !== 'crosshead' || i + 1 >= lines.length) return;
      const next = lines[i + 1];
      const last = i + 1 < lines.length && lines[i + 1].blockId === line.blockId ? null : line;
      if (last !== null && next.blockId !== line.blockId && (next.page !== line.page || next.column !== line.column)) {
        problems.push(`crosshead ${line.blockId} at column ${line.column} page ${line.page}, next ${next.blockId} in column ${next.column} page ${next.page}`);
      }
    });
    return problems;
  };

  it('does not strand a three-line crosshead at the foot of a column (report, after a 146-word lead)', () => {
    const found: string[] = [];
    let widest = 0;
    for (let lead = 60; lead <= 260; lead += 1) {
      const doc: FlowDocument = {
        blocks: [
          para('p0', words(lead, 'lead')),
          crosshead('h1', 'A three line crosshead in the report layout that is long enough to wrap across three lines of the narrow column'),
          para('p1', words(80, 'following')),
        ],
      };
      const layout = layoutFlow(doc, buildEditorialPreset('report', THEME), env(1440, 900, 'paged-x'));
      widest = Math.max(widest, new Set(linesOfId(layout, 'h1').map((l) => l.y)).size);
      found.push(...stranded(layout).map((p) => `lead ${lead}: ${p}`));
    }
    expect(widest, 'the crosshead never wrapped to three lines').toBeGreaterThanOrEqual(3);
    expect(found.slice(0, 3)).toEqual([]);
  });

  it('does not strand a crosshead when paragraphGap is 2', () => {
    const found: string[] = [];
    for (let lead = 250; lead <= 700; lead += 1) {
      const doc: FlowDocument = {
        blocks: [para('p0', words(lead, 'lead')), crosshead('h1', 'A crosshead before a gapped paragraph'), para('p1', words(80, 'following'))],
      };
      found.push(...stranded(layoutFlow(doc, baseSpec({ grid: { maxColumns: 3 }, body: { paragraphGap: 2 } }), env(1440, 900, 'paged-x'))).map((p) => `lead ${lead}: ${p}`));
    }
    expect(found.slice(0, 3)).toEqual([]);
  });
});

// ─── R6 / C3: the cap's neighbour is never mistaken for the cap ──────────────────────────────────

describe('R6 C3 drop cap: a neighbour equal to the cap is not part of the cap', () => {
  it('starts the first body fragment after the cap when the next character equals the cap', () => {
    const doc: FlowDocument = { blocks: [para('p1', '11 men went up the hill and down again ' + words(20, 'more'))] };
    const spec = baseSpec({ body: { dropCap: { lines: 3 } } });
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    const cap = layout.pages.flatMap((p) => p.objects).find((o) => o.role === 'dropcap')!;
    expect(cap).toBeDefined();
    const capText = cap.lines![0].text;
    expect(capText).toBe('1');
    const first = linesOfId(layout, 'p1')[0].fragments[0];
    expect(first.text.startsWith('1 men'), `first fragment "${first.text}"`).toBe(true);
    expect(first.start, 'first fragment includes the cap').toBeGreaterThanOrEqual(capText.length);
    expectSourceProperty(doc, layout, spec);
  });

  it('does the same for an upper-case paragraph beginning AARDVARKS', () => {
    const doc: FlowDocument = { blocks: [para('p1', 'AARDVARKS are animals ' + words(20, 'more'))] };
    const spec = baseSpec({ body: { dropCap: { lines: 3 } } });
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    const cap = layout.pages.flatMap((p) => p.objects).find((o) => o.role === 'dropcap')!;
    expect(cap.lines![0].text).toBe('A');
    const first = linesOfId(layout, 'p1')[0].fragments[0];
    expect(first.start, `first fragment "${first.text}"`).toBeGreaterThanOrEqual(1);
  });
});

// ─── R7 / C6: cap height follows the lines beside it; no neighbour is wrapped ────────────────────

describe('R7 C6 drop cap height: rows beside a cap are the cap paragraph\'s own lines', () => {
  for (let count = 4; count <= 30; count += 1) {
    it(`a ${count}-word paragraph after a 21-line opening object keeps its cap beside its own lines`, () => {
      const doc: FlowDocument = {
        blocks: [
          { kind: 'text-object', id: 'hero', role: 'hero', runs: [{ text: 'Hero' }] },
          para('p1', words(count, 'cap')),
          para('p2', words(30, 'next')),
        ],
      };
      const spec = baseSpec({
        body: { dropCap: { lines: 3 } },
        roles: {
          hero: { fit: { kind: 'none' }, place: { column: 0, span: 1, vertical: 'top', clearance: 0 }, height: { kind: 'lines', lines: 21 } },
        },
      });
      const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
      const cap = layout.pages.flatMap((p) => p.objects).find((o) => o.role === 'dropcap');
      if (cap === undefined) return;
      const lh = layout.body.lineHeight;
      const capRows = cap.rect.height / lh;
      const beside = allLines(layout).filter(
        (l) =>
          l.page === cap.page &&
          l.column === 0 &&
          l.y >= cap.rect.y - EPS &&
          l.y < cap.rect.y + cap.rect.height - EPS &&
          l.x >= cap.rect.x + cap.rect.width - EPS,
      );
      expect(beside.every((l) => l.blockId === 'p1'), 'another paragraph is set beside the cap').toBe(true);
      expect(beside.length, `cap ${capRows} rows, ${beside.length} lines beside it`).toBe(capRows);
      expect(capRows).toBeGreaterThanOrEqual(2);
    });
  }
});

// ─── R8 / C7: a pull never empties a page; a bounded layout never falls back ─────────────────────

describe('R8 C7 widows: a pull never empties the page, and a bounded layout never falls back', () => {
  it('lays 31 words at 400 x 192 paged-x with widows 6 and orphans 0 on bounded pages', () => {
    const doc: FlowDocument = { blocks: [para('p1', words(31, 'pull'))] };
    const found: string[] = [];
    for (let n = 25; n <= 40; n += 1) {
      const layout = layoutFlow({ blocks: [para('p1', words(n, 'extraordinary'))] }, baseSpec({ grid: { maxColumns: 1 }, body: { widows: 6, orphans: 0 } }), env(400, 192, 'paged-x'));
      if (layout.stats.fallbackPages !== 0) found.push(`n=${n} fallback ${layout.stats.fallbackPages}`);
      for (const page of layout.pages) if (page.rect.height !== 192) found.push(`n=${n} page ${page.index} height ${page.rect.height}`);
    }
    expect(found.slice(0, 3)).toEqual([]);
  });
});

// ─── R9 / C3: un-collapsed whitespace keeps the offsets exact ────────────────────────────────────

describe('R9 C3 whitespace: runs with un-collapsed whitespace keep exact source offsets', () => {
  it('satisfies the source property for runs with double spaces, tabs and newlines', () => {
    const doc: FlowDocument = { blocks: [para('p1', 'alpha  beta\tgamma\nomega  ' + words(30, 'delta')), para('p2', 'x\n\ny  z')] };
    const spec = baseSpec();
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    expectSourceProperty(doc, layout, spec);
  });
});

// ─── R10 / C8: fit cost with a huge maxLines ─────────────────────────────────────────────────────

describe('R10 C8 fit cost: a 200-word headline with a huge maxLines fits in a few milliseconds', () => {
  for (const kind of ['width', 'lines'] as const) {
    it(`fits a 200-word ${kind} headline with maxLines 200`, () => {
      const measurer = createPretextMeasurer();
      const started = Date.now();
      fitText(
        [{ text: words(200, 'headline') }],
        { family: '"Stub Serif", serif', weight: 700, style: 'normal', scale: 1, leading: 1.1 },
        { kind, lines: 'auto', maxLines: 200, maxScale: 3 },
        { width: 800, maxHeight: 4000 },
        16,
        measurer,
      );
      expect(Date.now() - started).toBeLessThan(100);
    });
  }
});

// ─── R11 / C9: metrics per face, not per size ────────────────────────────────────────────────────

describe('R11 C9 metrics: one measurement per face, scaled to the size', () => {
  it('does not accept a new canvas font for every fractional size of one face', () => {
    const measurer = createPretextMeasurer();
    const before = acceptedFonts.size;
    for (let size = 13; size < 15; size += 0.01) {
      measurer.metrics({ family: '"Stub Serif", serif', weight: 400, style: 'normal', size });
    }
    expect(acceptedFonts.size - before, 'canvas fonts set for one face').toBeLessThanOrEqual(2);
  });
});

// ─── C11: word gaps count no-break spaces ────────────────────────────────────────────────────────

describe('C11 gaps: word gaps count U+0020 and U+00A0 inside fragments, and fragments that follow a gap', () => {
  it('counts a no-break space inside a fragment as a word gap', () => {
    const doc: FlowDocument = { blocks: [para('p1', 'a b c ' + words(12, 'gap'))] };
    const layout = layoutFlow(doc, baseSpec(), env(1440, 900, 'paged-x'));
    for (const line of linesOfId(layout, 'p1')) {
      let expected = 0;
      line.fragments.forEach((f, i) => {
        expected += (f.text.match(/[  ]/g) ?? []).length;
        if (f.gapBefore > 0 || (i > 0 && f.gapBefore > 0)) expected += 1;
      });
      expect(line.gaps).toBe(expected);
    }
    expect(linesOfId(layout, 'p1')[0].gaps).toBeGreaterThanOrEqual(2);
  });
});

// ─── C12: captions are text objects after their media ────────────────────────────────────────────

describe('C12 captions: a Markdown caption becomes a caption text object after its media', () => {
  it('turns the quoted title of an image into a caption block', () => {
    const blocks = parseEditorialMarkdown('![A view](hero.jpg "The caption")');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('media-object');
    expect('caption' in blocks[0]).toBe(false);
    expect(blocks[1]).toMatchObject({ kind: 'text-object', role: 'caption', id: 'c1' });
  });
});

// ─── C13: block indices on lines and objects ─────────────────────────────────────────────────────

describe('C13 block index: lines and objects name their source block', () => {
  it('gives every line and object the index of its block, and the drop cap its paragraph and run', () => {
    const doc = sampleDocument();
    const layout = layoutFlow(doc, baseSpec({ body: { dropCap: { lines: 3 } } }), env(1440, 900, 'paged-x'));
    for (const page of layout.pages) {
      for (const line of page.lines) expect(doc.blocks[line.block]?.id).toBe(line.blockId);
      for (const object of page.objects) {
        if (object.role === 'dropcap') {
          expect(object.run).toBe(0);
          expect(doc.blocks[object.block]?.id).toBe(object.id.replace(/-cap$/, ''));
        } else {
          expect(doc.blocks[object.block]?.id).toBe(object.id);
        }
      }
    }
  });
});

// ─── C14: compact rules when the grid is narrow ──────────────────────────────────────────────────

describe('C14 compact: the compact rules apply when the grid has no more columns than compact.columns', () => {
  const headlineRule = { fit: { kind: 'none' as const }, place: { column: 0 as const, span: 1 as const, vertical: 'top' as const, clearance: 1 }, height: { kind: 'text' as const }, style: { family: '"Stub Serif", serif', weight: 700, style: 'normal' as const, scale: 2, leading: 1 } };

  it('spans the headline across the page when compact applies', () => {
    const spec = baseSpec({ grid: { maxColumns: 3 }, roles: { headline: headlineRule } });
    spec.compact = { columns: 3, roles: { headline: { place: { column: 0, span: 'all', vertical: 'top', clearance: 1 } } } };
    const layout = layoutFlow({ blocks: [{ kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: 'Head' }] }, para('p1', words(20))] }, spec, env(1440, 900, 'paged-x'));
    const frames = layout.pages[0].frames;
    const full = frames[frames.length - 1].x + layout.body.columnWidth - frames[0].x;
    expect(layout.body.columns).toBe(3);
    expect(objectOn(layout, 'headline')!.rect.width).toBe(full);
  });

  it('keeps the headline in one column when the grid has more columns than compact.columns', () => {
    const spec = baseSpec({ grid: { maxColumns: 3 }, roles: { headline: headlineRule } });
    spec.compact = { columns: 2, roles: { headline: { place: { column: 0, span: 'all', vertical: 'top', clearance: 1 } } } };
    const layout = layoutFlow({ blocks: [{ kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: 'Head' }] }, para('p1', words(20))] }, spec, env(1440, 900, 'paged-x'));
    expect(objectOn(layout, 'headline')!.rect.width).toBe(layout.body.columnWidth);
  });
});

function objectOn(layout: FlowLayout, id: string): PlacedObject | undefined {
  return allObjects(layout).find((o) => o.id === id);
}

// Keep the block type import used.
export type { FlowBlock };
