// layout-regressions.test.ts — one test per defect seen in the first live render (round 2), each
// named after the defect it guards. Scenarios are small and hand-built so the expected geometry can
// be read off the spec; the preset-level ones use `buildEditorialPreset` with a stub theme.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { installStubCanvas } from './stub-canvas';
import {
  buildEditorialPreset,
  createPretextMeasurer,
  fitText,
  layoutFlow,
  resolveBodyGrid,
  type EditorialTheme,
  type FlowBlock,
  type FlowDocument,
  type FlowLayout,
  type PageLayout,
  type PlacedLine,
  type FlowSpec,
  type PlacedObject,
  type InlineRun,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import { allLines, allObjects, baseSpec, defaultRoles, env, linesOf, sampleDocument, syllableHyphenator, words, EPS } from './fixtures';

function defaultRolesWith(overrides: Partial<FlowSpec['roles']>): FlowSpec['roles'] {
  return { ...defaultRoles(), ...overrides };
}

const THEME: EditorialTheme = {
  display: { family: '"Stub Serif", serif', weight: 700 },
  sans: { family: '"Stub Sans", sans-serif', weight: 700 },
  serif: { family: '"Stub Serif", serif', weight: 400 },
};

beforeAll(() => {
  installStubCanvas();
});

function para(id: string, text: string): FlowBlock {
  return { kind: 'paragraph', id, role: 'body', runs: [{ text }] };
}

function objectOn(layout: FlowLayout, id: string): PlacedObject | undefined {
  for (const page of layout.pages) {
    const found = page.objects.find((o) => o.id === id);
    if (found) return found;
  }
  return undefined;
}


function frameBottom(page: PageLayout, column: number): number {
  const frame = page.frames[column];
  return frame.y + frame.height;
}

// ─── D1 / A2: a fill object takes the height left below its final position ──────────────────────

describe('D1 cover-story: a fill hero that slides stays on its page and fills to the frame bottom', () => {
  it('keeps the fill hero on page 0, below the full-width headline, ending at the frame bottom', () => {
    const doc: FlowDocument = {
      blocks: [
        { kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: 'A headline across the spread' }] },
        { kind: 'media-object', id: 'hero', role: 'hero', aspect: 1.2 },
        para('p1', words(220, 'word')),
      ],
    };
    const spec = baseSpec({
      roles: {
        headline: {
          style: { family: '"Stub Serif", serif', weight: 700, style: 'normal', scale: 2.2, leading: 1.05 },
          fit: { kind: 'width', lines: 'auto', maxLines: 2, maxScale: 3 },
          place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
          height: { kind: 'text' },
        },
        hero: {
          fit: { kind: 'none' },
          place: { column: -2, span: 2, vertical: 'top', clearance: 1 },
          height: { kind: 'fill' },
        },
      },
    });
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    const hero = objectOn(layout, 'hero');
    const headline = objectOn(layout, 'headline');
    expect(hero, 'hero was carried off page 0').toBeDefined();
    expect(hero!.page).toBe(0);
    expect(headline).toBeDefined();
    expect(hero!.rect.y).toBeGreaterThanOrEqual(headline!.rect.y + headline!.rect.height - EPS);
    const page = layout.pages[0];
    const column = hero!.rect.x < page.frames[1].x ? 0 : 1;
    const endsAtFrame = Math.abs(hero!.rect.y + hero!.rect.height - frameBottom(page, column)) < EPS;
    expect(endsAtFrame, 'fill hero must end at the frame bottom').toBe(true);
  });
});

// ─── D2 / A4: the drop cap starts on the first free row of the column, searching down ─────────────

describe('D2 drop cap: under opening objects the cap starts on the first free rows of the column', () => {
  it('places the cap in column 0 below a full-width headline on a three-column page', () => {
    const doc: FlowDocument = {
      blocks: [
        { kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: 'Opening headline' }] },
        para('p1', words(160, 'opening')),
      ],
    };
    const spec = baseSpec({ grid: { maxColumns: 3 }, body: { dropCap: { lines: 3 } } });
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    expect(layout.body.columns).toBe(3);
    const cap = objectOn(layout, 'p1-cap');
    expect(cap, 'drop cap was dropped or moved away from the first column').toBeDefined();
    expect(cap!.page).toBe(0);
    expect(cap!.rect.x).toBe(layout.pages[0].frames[0].x);
    const headline = objectOn(layout, 'headline')!;
    expect(cap!.rect.y).toBeGreaterThanOrEqual(headline.rect.y + headline.rect.height - EPS);
    const column0 = linesOf(layout, 'p1').filter((l) => l.column === 0);
    expect(column0.length, 'column 0 has no body text').toBeGreaterThan(0);
  });

  it('keeps the drop cap on a single-column page below the opening headline', () => {
    const doc: FlowDocument = {
      blocks: [
        { kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: 'Opening headline' }] },
        para('p1', words(60, 'opening')),
      ],
    };
    const spec = baseSpec({ grid: { maxColumns: 1 }, body: { dropCap: { lines: 3 } } });
    const layout = layoutFlow(doc, spec, env(390, 844, 'paged-x'));
    expect(objectOn(layout, 'p1-cap'), 'drop cap was dropped on a single-column page').toBeDefined();
  });
});

// ─── D3: the report hero is placed in the free columns at the top of page 1 ─────────────────────

describe('D3 report: the hero at column 2 spanning all columns stays on page 1 when columns 2-4 are free', () => {
  it('places the report hero on page 0', () => {
    const layout = layoutFlow(sampleDocument(), buildEditorialPreset('report', THEME), env(1440, 900, 'paged-x'));
    const hero = objectOn(layout, 'hero');
    expect(hero, 'hero was carried to a later page').toBeDefined();
    expect(hero!.page).toBe(0);
  });
});

// ─── D4 / A5: a widow never sits alone at the top of a page ─────────────────────────────────────

describe('D4 widows at a page break: a continuation page never starts with one line of a paragraph', () => {
  it('leaves at least widows lines on each page a paragraph continues onto', () => {
    const offending: string[] = [];
    for (let n = 40; n <= 200; n += 7) {
      const doc: FlowDocument = { blocks: [para('p', words(n, 'breaker'))] };
      const spec = baseSpec({ grid: { maxColumns: 1 }, body: { widows: 2, orphans: 2 } });
      const layout = layoutFlow(doc, spec, env(390, 400, 'paged-x'));
      const counts = layout.pages.map((page) => page.lines.filter((l) => l.blockId === 'p').length);
      for (let k = 1; k < counts.length; k += 1) {
        if (counts[k - 1] > 0 && counts[k] === 1) offending.push(`n=${n} page ${k} has 1 line`);
      }
    }
    expect(offending).toEqual([]);
  });
});

// ─── D5 / A1: the measure maximum caps the line length ──────────────────────────────────────────

describe('D5 interview: the measure maximum caps characters per line', () => {
  it('never sets a line longer than measure[2] characters at 1440 wide', () => {
    const spec = buildEditorialPreset('interview', THEME);
    const grid = resolveBodyGrid(spec, { width: 1440, height: 900 }, createPretextMeasurer());
    expect(grid.charsPerLine).toBeLessThanOrEqual(spec.grid.measure[2] + EPS);
  });

  it('centres the capped columns in the content width', () => {
    const spec = baseSpec({ grid: { maxColumns: 1, measure: [20, 30, 40] } });
    const grid = resolveBodyGrid(spec, { width: 2000, height: 900 }, createPretextMeasurer());
    expect(grid.charsPerLine).toBeLessThanOrEqual(40 + EPS);
    const right = 2000 - grid.margin.right - grid.columnWidth;
    expect(Math.abs(grid.margin.left - right)).toBeLessThanOrEqual(1);
  });
});

// ─── D6 / A6: body text never sits above or beside stacked opening text ─────────────────────────

describe('D6 opening shadow: body text never runs above, or beside, an opening text object', () => {
  it('keeps body lines of a column below an inset opening deck that overlaps the column', () => {
    const doc: FlowDocument = {
      blocks: [
        {
          kind: 'text-object',
          id: 'deck',
          role: 'deck',
          runs: [{ text: 'An inset deck that leaves room beside it' }],
        },
        { kind: 'text-object', id: 'byline', role: 'byline', runs: [{ text: 'By a reader' }] },
        para('p1', words(120, 'shadow')),
      ],
    };
    const spec = baseSpec({
      grid: { maxColumns: 3 },
      roles: {
        deck: {
          style: { family: '"Stub Serif", serif', weight: 400, style: 'italic', scale: 1.3, leading: 1.3 },
          fit: { kind: 'none' },
          place: { column: 0, span: 1, vertical: 'top', inset: { side: 'start', fraction: 0.6 }, clearance: 1 },
          height: { kind: 'text' },
        },
        byline: {
          style: { family: '"Stub Sans", sans-serif', weight: 400, style: 'normal', scale: 0.85, leading: 1.3 },
          fit: { kind: 'none' },
          place: { column: 0, span: 1, vertical: 'top', clearance: 0 },
          height: { kind: 'text' },
        },
      },
    });
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    const deck = objectOn(layout, 'deck')!;
    const deckBottom = deck.rect.y + deck.rect.height;
    const column0 = linesOf(layout, 'p1').filter((l) => l.column === 0);
    expect(column0.length).toBeGreaterThan(0);
    for (const line of column0) {
      expect(line.y, `body line at ${line.y} runs above the deck bottom ${deckBottom}`).toBeGreaterThanOrEqual(deckBottom - EPS);
    }
  });
});

// ─── D7 / A7: the opening column starts body text on page 0 ─────────────────────────────────────

describe('D7 review: body text starts at openingColumn on page 0', () => {
  it('starts body text in column 2 on page 0, leaving columns 0 and 1 to the opening objects', () => {
    const spec = baseSpec({ grid: { maxColumns: 4 }, body: { openingColumn: 2 } });
    const layout = layoutFlow(sampleDocument(), spec, env(1440, 900, 'paged-x'));
    expect(layout.body.columns).toBe(4);
    const page0 = layout.pages[0].lines.filter((l) => l.role === 'body');
    expect(page0.length).toBeGreaterThan(0);
    expect(page0.every((l) => l.column >= 2), 'body text in columns 0-1 on page 0').toBe(true);
  });

  it('ignores openingColumn when the page has no more columns than it', () => {
    const spec = baseSpec({ grid: { maxColumns: 2 }, body: { openingColumn: 2 } });
    const layout = layoutFlow(sampleDocument(), spec, env(1440, 900, 'paged-x'));
    expect(layout.body.columns).toBe(2);
    const columns = new Set(layout.pages[0].lines.filter((l) => l.role === 'body').map((l) => l.column));
    expect(columns.has(0)).toBe(true);
  });
});

// ─── D8 / A3 + A2: unbounded pages set anchored objects in flow; fill follows the aspect ─────────

describe('D8 unbounded 390 x 844: anchored objects stay in the flow and fill follows the aspect', () => {
  it('sets a page-positioned quote where its block is reached, not claimed to the top', () => {
    const doc: FlowDocument = {
      blocks: [
        para('p1', words(90, 'flow')),
        { kind: 'text-object', id: 'quote', role: 'quote', runs: [{ text: 'A quotation in the flow' }] },
        para('p2', words(30, 'after')),
      ],
    };
    const spec = baseSpec({
      grid: { maxColumns: 1 },
      roles: {
        quote: {
          style: { family: '"Stub Serif", serif', weight: 400, style: 'italic', scale: 1.4, leading: 1.3 },
          fit: { kind: 'none' },
          place: { column: 0, span: 1, vertical: 'middle', clearance: 1 },
          height: { kind: 'text' },
        },
      },
    });
    const layout = layoutFlow(doc, spec, env(390, 844, 'paged-y'));
    const quote = objectOn(layout, 'quote')!;
    const firstLine = linesOf(layout, 'p1')[0];
    expect(quote.rect.y, 'quote was set above the first paragraph').toBeGreaterThan(firstLine.y);
  });

  it('gives a fill hero the aspect height on an unbounded page', () => {
    const doc: FlowDocument = {
      blocks: [{ kind: 'media-object', id: 'hero', role: 'hero', aspect: 2 }, para('p1', words(20, 'fill'))],
    };
    const spec = baseSpec({
      grid: { maxColumns: 1 },
      roles: {
        hero: { fit: { kind: 'none' }, place: { column: 0, span: 1, vertical: 'top', clearance: 0 }, height: { kind: 'fill' } },
      },
    });
    const layout = layoutFlow(doc, spec, env(390, 844, 'paged-y'));
    const hero = objectOn(layout, 'hero')!;
    const lh = layout.body.lineHeight;
    const wanted = Math.ceil(layout.body.columnWidth / 2 / lh - 1e-9) * lh;
    expect(hero.rect.height).toBe(wanted);
  });
});

// ─── D9 / A8: a second layout of a 1,000-word piece stays under one frame ───────────────────────

describe('D9 profile at 820 x 1180 paged-y: a warm layout fits one 16 ms frame', () => {
  it('lays out a 1,000-word piece in under 16 ms on the second call', () => {
    const doc: FlowDocument = {
      blocks: [
        ...sampleDocument().blocks,
        ...Array.from({ length: 12 }, (_, i) => para(`x${i}`, words(80, `wide${i}`))),
      ],
    };
    const spec = buildEditorialPreset('profile', THEME);
    const measurer = createPretextMeasurer();
    const run = () => layoutFlow(doc, spec, { viewport: { width: 820, height: 1180 }, mode: 'paged-y', measurer, hyphenator: null });
    run();
    const started = performance.now();
    run();
    const elapsed = performance.now() - started;
    expect(elapsed, `second layout took ${elapsed.toFixed(1)} ms`).toBeLessThan(16);
  });
});

describe('A8 restarts: an opening object is fitted once, not again on every page restart', () => {
  it('runs the opening headline width probe once when two page-positioned quotes force restarts on page 0', () => {
    const headline = 'Opening headline';
    let probes = 0;
    const real = createPretextMeasurer();
    const counting = {
      ...real,
      naturalWidth(text: string, font: { size: number; family: string; weight: number; style: 'normal' | 'italic' }) {
        if (text === headline && font.size === 100) probes += 1;
        return real.naturalWidth(text, font);
      },
    };
    const doc: FlowDocument = {
      blocks: [
        { kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: headline }] },
        para('p1', words(40, 'first')),
        { kind: 'text-object', id: 'quote1', role: 'quote', runs: [{ text: 'First quotation' }] },
        para('p2', words(40, 'second')),
        { kind: 'text-object', id: 'quote2', role: 'quote', runs: [{ text: 'Second quotation' }] },
        para('p3', words(40, 'third')),
      ],
    };
    const middle = {
      style: { family: '"Stub Serif", serif', weight: 400, style: 'italic' as const, scale: 1.4, leading: 1.3 },
      fit: { kind: 'none' as const },
      place: { column: 0, span: 1, vertical: 'middle' as const, clearance: 1 },
      height: { kind: 'text' as const },
    };
    const spec = baseSpec({ roles: { ...defaultRolesWith({ quote: middle }) } });
    const layout = layoutFlow(doc, spec, { viewport: { width: 1440, height: 900 }, mode: 'paged-x', measurer: counting, hyphenator: null });
    expect(objectOn(layout, 'quote1')?.page, 'quote1 not placed on page 0').toBe(0);
    expect(objectOn(layout, 'quote2')?.page, 'quote2 not placed on page 0').toBe(0);
    expect(probes, `headline fitted ${probes} times`).toBe(1);
  });
});

// ─── A9: no literal invisible characters in editorial source ────────────────────────────────────

describe('A9 source hygiene: soft hyphens are written as escapes', () => {
  it('contains no literal invisible characters in the editorial modules', () => {
    const dir = join(__dirname, '../../../packages/revyme-runtime-scene/src/editorial');
    const invisible = /[\u00AD\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/u;
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => invisible.test(readFileSync(join(dir, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});


// ─── Round 3 ─────────────────────────────────────────────────────────────────────────────────────

const SHY_CHAR = '­';

/** Every non-finite number in a value, by path. */
function nonFinitePaths(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) nonFinitePaths(child, `${path}.${key}`, out);
  }
}

function expectAllFinite(layout: FlowLayout): void {
  const bad: string[] = [];
  nonFinitePaths(layout, 'layout', bad);
  expect(bad.slice(0, 10)).toEqual([]);
}

/** A measurer that counts calls and the characters `nextLine` materialises. */
function countingMeasurer() {
  const real = createPretextMeasurer();
  const counts = { naturalWidth: 0, nextLineCalls: 0, nextLineChars: 0 };
  const measurer = {
    ...real,
    naturalWidth(text: string, font: Parameters<typeof real.naturalWidth>[1]) {
      counts.naturalWidth += 1;
      return real.naturalWidth(text, font);
    },
    nextLine(prepared: Parameters<typeof real.nextLine>[0], maxWidth: number, start?: Parameters<typeof real.nextLine>[2]) {
      counts.nextLineCalls += 1;
      const line = real.nextLine(prepared, maxWidth, start);
      if (line !== null) counts.nextLineChars += line.fragments.reduce((n, f) => n + f.text.length, 0);
      return line;
    },
  };
  return { measurer, counts };
}

function paragraphOf(id: string, text: string) {
  return { kind: 'paragraph' as const, id, role: 'body' as const, runs: [{ text }] };
}

function allText(layout: FlowLayout): string {
  return allLines(layout)
    .map((l) => l.fragments.map((f) => f.text.replace(new RegExp(SHY_CHAR, 'g'), '')).join(''))
    .join(' ');
}

// ─── F2 / B2: a paragraph that ends on the last row is finished ──────────────────────────────────

describe('F2 B2 widows and orphans: a paragraph that ends on a column\'s last row never adds a page', () => {
  it('keeps every paragraph of 1 to 120 words on one page when its lines fill the column exactly', () => {
    const offending: string[] = [];
    for (let n = 1; n <= 120; n += 1) {
      const doc = { blocks: [paragraphOf('p', words(n, 'abcde'))] };
      const layout = layoutFlow(doc, baseSpec({ grid: { maxColumns: 1 }, body: { widows: 1, orphans: 1 } }), env(400, 300, 'paged-x'));
      const capacity = layout.pages[0].frames[0].height / layout.body.lineHeight;
      const lines = linesOf(layout, 'p').length;
      if (lines <= capacity && layout.pages.length !== 1) offending.push(`n=${n} lines=${lines} pages=${layout.pages.length}`);
      if (layout.pages.some((page) => page.lines.length === 0 && page.objects.length === 0)) offending.push(`n=${n} empty page`);
    }
    expect(offending).toEqual([]);
  });

  it('never ends a layout with an empty last page under orphans 7 and widows 2', () => {
    const offending: string[] = [];
    for (let n = 1; n <= 120; n += 1) {
      const doc = { blocks: [paragraphOf('p', words(n, 'abcde'))] };
      const layout = layoutFlow(doc, baseSpec({ grid: { maxColumns: 1 }, body: { widows: 2, orphans: 7 } }), env(400, 300, 'paged-x'));
      const last = layout.pages[layout.pages.length - 1];
      if (last.lines.length === 0 && last.objects.length === 0) offending.push(`n=${n} pages=${layout.pages.map((p) => p.lines.length)}`);
    }
    expect(offending).toEqual([]);
  });
});

// ─── F3 / B3: blocks are identified by position, not by id ───────────────────────────────────────

describe('F3 B3 repeated block ids: two blocks with the same id keep their own text', () => {
  it('paints the text of both paragraphs that share the id p1', () => {
    const doc = {
      blocks: [
        paragraphOf('p1', 'alpha ' + words(20, 'first')),
        paragraphOf('p1', 'omega ' + words(20, 'second')),
      ],
    };
    const layout = layoutFlow(doc, baseSpec(), env(1440, 900, 'paged-x'));
    const text = allText(layout);
    expect(text).toContain('alpha');
    expect(text).toContain('omega');
    expect(linesOf(layout, 'p1').every((l) => l.blockId === 'p1')).toBe(true);
  });
});

// ─── F4 / B4: a crosshead never strands at a page foot ───────────────────────────────────────────

describe('F4 B4 crosshead keep-with-next: a crosshead is never the last line of a page', () => {
  it('ends no page with a crosshead line under orphans 3 on a single column', () => {
    const doc = {
      blocks: [
        paragraphOf('p1', words(20, 'opening')),
        { kind: 'paragraph' as const, id: 'h1', role: 'crosshead' as const, runs: [{ text: 'Heading' }] },
        paragraphOf('p2', words(60, 'following')),
      ],
    };
    const layout = layoutFlow(doc, baseSpec({ grid: { maxColumns: 1 }, body: { orphans: 3 } }), env(400, 300, 'paged-x'));
    for (const page of layout.pages) {
      const last = page.lines[page.lines.length - 1];
      expect(last?.role, `page ${page.index} ends with a crosshead`).not.toBe('crosshead');
    }
  });

  it('moves a crosshead with the paragraph it heads: the next line after a crosshead is in its column', () => {
    const offending: string[] = [];
    for (const vh of [200, 240, 280, 320, 360]) {
      const doc = {
        blocks: [
          paragraphOf('p1', words(37, 'opening')),
          { kind: 'paragraph' as const, id: 'h1', role: 'crosshead' as const, runs: [{ text: 'Heading' }] },
          paragraphOf('p2', words(90, 'following')),
        ],
      };
      const layout = layoutFlow(doc, baseSpec({ grid: { maxColumns: 2 }, body: { orphans: 3 } }), env(700, vh, 'paged-x'));
      const lines = allLines(layout);
      lines.forEach((line, i) => {
        if (line.role !== 'crosshead' || i + 1 >= lines.length) return;
        const next = lines[i + 1];
        if (next.page !== line.page || next.column !== line.column) offending.push(`vh=${vh} heading at column ${line.column} followed by column ${next.column}`);
      });
    }
    expect(offending).toEqual([]);
  });
});

// ─── F5 / B5: unbounded pages are one column; extents and frames match the pages ─────────────────

describe('F5 B5 unbounded and last pages: one column, extent covers every page, frames end at the content', () => {
  it('lays an unbounded page out in one column whatever maxColumns asks', () => {
    const layout = layoutFlow({ blocks: [paragraphOf('p', words(400, 'wide'))] }, baseSpec({ grid: { maxColumns: 2 } }), env(900, 120, 'paged-x'));
    expect(layout.body.columns).toBe(1);
    expect(layout.pages[0].frames).toHaveLength(1);
    expect(linesOf(layout, 'p').every((l) => l.column === 0)).toBe(true);
  });

  it('makes the paged-x extent cover the tallest page', () => {
    const layout = layoutFlow({ blocks: [paragraphOf('p', words(400, 'wide'))] }, baseSpec(), env(900, 120, 'paged-x'));
    const tallest = Math.max(120, ...layout.pages.map((p) => p.rect.height));
    expect(layout.extent.height).toBe(tallest);
  });

  it('ends the last bounded paged-y page\'s frames at its content bottom', () => {
    const layout = layoutFlow({ blocks: [paragraphOf('p', words(300, 'tall'))] }, baseSpec({ grid: { maxColumns: 3 } }), env(820, 1180, 'paged-y'));
    const last = layout.pages[layout.pages.length - 1];
    const contentBottom = Math.max(...last.lines.map((l) => l.y + l.height), ...last.objects.map((o) => o.rect.y + o.rect.height));
    expect(last.frames[0].y + last.frames[0].height).toBeCloseTo(contentBottom, 6);
  });
});

// ─── F6 / B6: a claimed object keeps the column and row where its block was reached ──────────────

describe('F6 B6 claimed objects: column anchors keep the reached column, row anchors the reached row', () => {
  const asideRule = (vertical: 'top' | 'anchor', column: number | 'anchor') => ({
    aside: {
      style: { family: '"Stub Serif", serif', weight: 400, style: 'italic' as const, scale: 1, leading: 1.3 },
      fit: { kind: 'none' as const },
      place: { column, span: 1, vertical, clearance: 1 },
      height: { kind: 'text' as const },
    },
  });
  const asideDoc = (lead: number) => ({
    blocks: [
      paragraphOf('p0', words(lead, 'filler')),
      { kind: 'text-object' as const, id: 'aside', role: 'aside' as const, runs: [{ text: 'A note' }] },
      paragraphOf('p1', words(12, 'after')),
    ],
  });

  it('places a top-anchored aside in the column where its block was reached, not in column 0', () => {
    let found: { lead: number; column: number; x: number } | null = null;
    for (let lead = 200; lead <= 900 && found === null; lead += 10) {
      const base = layoutFlow(asideDoc(lead) as FlowDocument, baseSpec({ grid: { maxColumns: 3 }, roles: asideRule('top', 'anchor') as never }), env(1440, 900, 'paged-x'));
      const p0 = linesOf(base, 'p0');
      const reached = p0[p0.length - 1]?.column;
      if (reached === 1) found = { lead, column: 1, x: base.pages[0].frames[1].x };
    }
    expect(found, 'no paragraph length ends in column 1').not.toBeNull();
    const withAside = layoutFlow(asideDoc(found!.lead) as FlowDocument, baseSpec({ grid: { maxColumns: 3 }, roles: asideRule('top', 'anchor') as never }), env(1440, 900, 'paged-x'));
    expect(objectOn(withAside, 'aside')!.rect.x).toBe(found!.x);
  });

  it('places a row-anchored aside below the text reached before it', () => {
    let found: { lead: number; bottom: number; x: number } | null = null;
    for (let lead = 200; lead <= 900 && found === null; lead += 10) {
      const base = layoutFlow(asideDoc(lead) as FlowDocument, baseSpec({ grid: { maxColumns: 3 }, roles: asideRule('anchor', 'anchor') as never }), env(1440, 900, 'paged-x'));
      const p0 = linesOf(base, 'p0');
      const last = p0[p0.length - 1];
      if (last.column === 1) found = { lead, bottom: last.y + last.height, x: base.pages[0].frames[1].x };
    }
    expect(found, 'no paragraph length ends in column 1').not.toBeNull();
    const withAside = layoutFlow(asideDoc(found!.lead) as FlowDocument, baseSpec({ grid: { maxColumns: 3 }, roles: asideRule('anchor', 'anchor') as never }), env(1440, 900, 'paged-x'));
    const aside = objectOn(withAside, 'aside')!;
    expect(aside.rect.x).toBe(found!.x);
    expect(aside.rect.y, 'aside placed at the frame top, above the text reached').toBeGreaterThanOrEqual(found!.bottom - EPS);
  });
});

// ─── F7 / B7: hostile spec values never reach the result ─────────────────────────────────────────

describe('F7 B7 hostile values: NaN and infinite spec numbers resolve to neutral values', () => {
  it('produces only finite numbers from non-finite inset, lines, clearance, scales and spacing', () => {
    const spec = baseSpec({
      body: { widows: Number.NaN, orphans: -3, indent: Number.NaN, paragraphGap: Number.POSITIVE_INFINITY, dropCap: { lines: Number.NaN }, crosshead: { spaceBefore: Number.NaN } as never },
      roles: {
        hero: {
          fit: { kind: 'none' },
          place: { column: 0, span: 1, vertical: 'top', inset: { side: 'start', fraction: Number.NaN }, clearance: Number.NaN },
          height: { kind: 'lines', lines: Number.NaN },
          maxHeight: Number.NaN,
        },
        headline: {
          style: { family: '"Stub Serif", serif', weight: 700, style: 'normal', scale: Number.NaN, leading: Number.NaN },
          fit: { kind: 'width', lines: Number.NaN, maxLines: Number.NaN, maxScale: Number.NaN },
          place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
          height: { kind: 'text' },
        },
      },
    });
    const doc = {
      blocks: [
        { kind: 'text-object' as const, id: 'headline', role: 'headline' as const, runs: [{ text: 'Hostile headline' }] },
        { kind: 'media-object' as const, id: 'hero', role: 'hero' as const, aspect: Number.NaN },
        paragraphOf('p1', words(40, 'hostile')),
      ],
    };
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    expect(layout.pages.length).toBeGreaterThan(0);
    expectAllFinite(layout);
  });
});

// ─── F8 / B8: the last-line test lays out nothing beyond the line it needs ───────────────────────

describe('F8 B8 last-line test: characters materialised stay linear in the paragraph length', () => {
  it('materialises at most a few characters per character of a 5,000-word paragraph', () => {
    const text = words(5000, 'lorem');
    const { measurer, counts } = countingMeasurer();
    layoutFlow({ blocks: [paragraphOf('p', text)] }, baseSpec(), { viewport: { width: 1440, height: 900 }, mode: 'paged-x', measurer, hyphenator: null });
    expect(counts.nextLineChars, `${counts.nextLineChars} chars for ${text.length}`).toBeLessThanOrEqual(4 * text.length);
  });
});

// ─── F9 / B9: fit width and lines cost one measurement per word ──────────────────────────────────

describe('F9 B9 fit cost: naturalWidth calls grow with the words, not their square', () => {
  for (const kind of ['width', 'lines'] as const) {
    it(`measures a 120-word ${kind} headline in O(words) calls`, () => {
      const runs: InlineRun[] = [{ text: words(120, 'headline') }];
      const { measurer, counts } = countingMeasurer();
      fitText(
        runs,
        { family: '"Stub Serif", serif', weight: 700, style: 'normal', scale: 1, leading: 1.1 },
        { kind, lines: 'auto', maxLines: 3, maxScale: 3 },
        { width: 800, maxHeight: 4000 },
        16,
        measurer,
      );
      expect(counts.naturalWidth, `${counts.naturalWidth} calls for 120 words`).toBeLessThanOrEqual(4 * 120 + 40);
    });
  }
});

// ─── F10 / B10: whitespace collapses only ordinary spaces ────────────────────────────────────────

describe('F10 B10 whitespace: a no-break space stays a no-break space', () => {
  it('keeps U+00A0 inside a fitted line', () => {
    const fitted = fitText(
      [{ text: 'A B C' }],
      { family: '"Stub Serif", serif', weight: 400, style: 'normal', scale: 1, leading: 1.3 },
      { kind: 'none' },
      { width: 1000, maxHeight: 1000 },
      16,
      createPretextMeasurer(),
    );
    expect(fitted.lines[0].text).toContain(' ');
  });
});

// ─── F12 / B11: a drop cap from a linked first run keeps the link ────────────────────────────────

describe('F12 B11 drop cap href: the cap carries the link of the first run', () => {
  it('gives the cap the href of a paragraph that starts with a link', () => {
    const doc = {
      blocks: [
        {
          kind: 'paragraph' as const,
          id: 'p1',
          role: 'body' as const,
          runs: [{ text: 'Linked opening words', href: 'https://example.com/' }, { text: ' and more text ' + words(30, 'more') }],
        },
      ],
    };
    const layout = layoutFlow(doc, baseSpec({ body: { dropCap: { lines: 3 } } }), env(1440, 900, 'paged-x'));
    const cap = objectOn(layout, 'p1-cap');
    expect(cap, 'no drop cap').toBeDefined();
    expect(cap!.href).toBe('https://example.com/');
  });
});

// ─── F13 / B11: a drop cap is never placed twice ─────────────────────────────────────────────────

describe('F13 B11 drop cap rewinds: one cap per paragraph after a rewind to its first line', () => {
  it('finds at most one cap for the paragraph across heights that force orphan rewinds', () => {
    const offending: string[] = [];
    for (let vh = 200; vh <= 420; vh += 17) {
      const doc = {
        blocks: [paragraphOf('p1', words(40, 'capped')), paragraphOf('p2', words(30, 'next'))],
      };
      const layout = layoutFlow(doc, baseSpec({ grid: { maxColumns: 2 }, body: { dropCap: { lines: 3 }, orphans: 3 } }), env(700, vh, 'paged-x'));
      const caps = allObjects(layout).filter((o) => o.role === 'dropcap');
      if (caps.length > 1) offending.push(`vh=${vh} caps=${caps.length}`);
    }
    expect(offending).toEqual([]);
  });
});

// ─── F16: fitted lines never exceed the box ──────────────────────────────────────────────────────

describe('F16 fit lines: every line of a lines fit stays inside the box width', () => {
  it('keeps each line within the box for widths swept across a text', () => {
    const offending: string[] = [];
    for (let width = 100; width <= 400; width += 13) {
      const fitted = fitText(
        [{ text: 'Alpha beta gamma delta epsilon zeta eta theta iota kappa' }],
        { family: '"Stub Serif", serif', weight: 700, style: 'normal', scale: 1, leading: 1.1 },
        { kind: 'lines', lines: 'auto', maxLines: 4, maxScale: 6 },
        { width, maxHeight: 2000 },
        16,
        createPretextMeasurer(),
      );
      for (const line of fitted.lines) {
        if (line.width > width) offending.push(`box ${width}: line ${line.width}`);
      }
    }
    expect(offending).toEqual([]);
  });
});

// ─── B12: baselines ──────────────────────────────────────────────────────────────────────────────

describe('B12 baselines: every line sits at the metric-derived baseline', () => {
  const measurer = createPretextMeasurer();
  const baselineOf = (height: number, font: Parameters<typeof measurer.metrics>[0]) => {
    const m = measurer.metrics(font);
    return (height - (m.ascent + m.descent)) / 2 + m.ascent;
  };

  it('gives every placed body and crosshead line its baseline', () => {
    const doc: FlowDocument = { blocks: [...sampleDocument().blocks] };
    const layout = layoutFlow(doc, baseSpec({ body: { dropCap: null } }), env(1440, 900, 'paged-x'));
    const lines = allLines(layout);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.baseline, `line ${line.blockId} at ${line.y}`).toBeCloseTo(baselineOf(line.height, line.font), 6);
    }
  });

  it('gives every fitted object line its baseline', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1440, 900, 'paged-x'));
    const objectLines = allObjects(layout).flatMap((o) => o.lines ?? []);
    expect(objectLines.length).toBeGreaterThan(0);
    for (const line of objectLines) {
      expect(line.baseline, `object line ${line.text}`).toBeCloseTo(baselineOf(line.height, line.font), 6);
    }
  });

  it('puts the drop cap on the baseline of its paragraph\'s Nth line', () => {
    const spec = baseSpec({ body: { dropCap: { lines: 3 } } });
    const layout = layoutFlow({ blocks: [paragraphOf('p1', words(60, 'cap'))] }, spec, env(1440, 900, 'paged-x'));
    const cap = objectOn(layout, 'p1-cap')!;
    const lh = layout.body.lineHeight;
    const bodyBaseline = baselineOf(lh, layout.body.font);
    expect(cap.lines![0].baseline).toBeCloseTo(2 * lh + bodyBaseline, 6);
  });
});

// ─── B13 / C3: T(source slice) equals P(painted text), in range and in source order ─────────────

/** T of the C3 property: collapse ordinary whitespace, drop soft hyphens, upper-case when asked. */
function tOf(text: string, upper: boolean): string {
  const collapsed = text.replace(/[ \t\n\f\v]+/g, ' ').replace(/­/g, '');
  return upper ? collapsed.toUpperCase() : collapsed;
}

/** P of the C3 property: drop soft hyphens and a painted line-end hyphen, trim. */
function pOf(text: string, lineEndHyphen: boolean): string {
  let out = text.replace(/­/g, '');
  if (lineEndHyphen) out = out.replace(/-$/, '');
  return out.trim();
}

function sourceProblems(doc: FlowDocument, layout: FlowLayout, spec: FlowSpec): string[] {
  const problems: string[] = [];
  const upperCrosshead = spec.body.crosshead.uppercase === true;
  for (const page of layout.pages) {
    for (const line of page.lines) {
      const block = doc.blocks[line.block];
      if (block === undefined || block.kind !== 'paragraph') {
        problems.push(`line ${line.blockId}: block ${line.block} is not a paragraph`);
        continue;
      }
      const upper = line.role === 'crosshead' && upperCrosshead;
      line.fragments.forEach((fragment, index) => {
        const source = block.runs[fragment.run]?.text ?? '';
        if (!(0 <= fragment.start && fragment.start < fragment.end && fragment.end <= source.length)) {
          problems.push(`${line.blockId}: range ${fragment.start}..${fragment.end} of ${source.length}`);
          return;
        }
        const t = tOf(source.slice(fragment.start, fragment.end), upper);
        const painted = pOf(fragment.text, line.hyphenated && index === line.fragments.length - 1);
        if (t !== painted) problems.push(`${line.blockId}: T(slice) "${t}" vs P(text) "${painted}"`);
      });
    }
  }
  // Fragments of one paragraph are in source order and never overlap.
  for (const page of layout.pages) {
    const byBlock = new Map<number, Array<{ run: number; start: number; end: number }>>();
    for (const line of page.lines) {
      const list = byBlock.get(line.block) ?? [];
      for (const fragment of line.fragments) list.push({ run: fragment.run, start: fragment.start, end: fragment.end });
      byBlock.set(line.block, list);
    }
    for (const [block, list] of byBlock) {
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1];
        const cur = list[i];
        if (cur.run < prev.run || (cur.run === prev.run && cur.start < prev.end)) {
          problems.push(`block ${block}: fragment ${cur.run}/${cur.start} out of order after ${prev.run}/${prev.end}`);
        }
      }
    }
  }
  return problems;
}

describe('B13 / C3 fragments: T(source slice) equals P(painted text), in range and in source order', () => {
  const specialDoc = (): FlowDocument => ({
    blocks: [
      { kind: 'paragraph', id: 's1', role: 'body', runs: [{ text: 'alpha  beta\tgamma\nomega ' + words(30, 'delta') }] },
      {
        kind: 'paragraph',
        id: 's2',
        role: 'body',
        runs: [
          { text: '11 men and AARDVARKS ' },
          { text: 'ßtraße and 😀 emoji 👍🏽 family 👨‍👩‍👧 café é ' + words(40, 'extra') },
        ],
      },
      { kind: 'paragraph', id: 'sh', role: 'crosshead', runs: [{ text: 'Crossheads with ß and 😀 and café é' }] },
      { kind: 'paragraph', id: 's3', role: 'body', runs: [{ text: 'x\n\ny  z ' + words(20, 'more') }] },
    ],
  });
  const variants: Array<{ name: string; doc: () => FlowDocument; vw: number; vh: number; mode: 'paged-x' | 'paged-y'; hyph: boolean; cap: boolean; upper: boolean }> = [];
  for (const [vw, vh, mode] of [[1440, 900, 'paged-x'], [390, 844, 'paged-x'], [820, 1180, 'paged-y']] as const) {
    for (const hyph of [false, true]) {
      for (const cap of [false, true]) {
        variants.push({ name: 'sample', doc: sampleDocument, vw, vh, mode, hyph, cap, upper: false });
        variants.push({ name: 'special', doc: specialDoc, vw, vh, mode, hyph, cap, upper: true });
      }
    }
  }
  for (const v of variants) {
    it(`${v.name} at ${v.vw}x${v.vh} ${v.mode} hyphenate=${v.hyph} dropCap=${v.cap} upper=${v.upper}`, () => {
      const doc = v.doc();
      const spec = baseSpec({
        body: {
          hyphenate: v.hyph,
          dropCap: v.cap ? { lines: 3 } : null,
          crosshead: { ...baseSpec().body.crosshead, uppercase: v.upper, tracking: 0.05 },
        },
      });
      const layout = layoutFlow(doc, spec, env(v.vw, v.vh, v.mode, { hyphenator: v.hyph ? syllableHyphenator() : null }));
      expect(sourceProblems(doc, layout, spec).slice(0, 5)).toEqual([]);
      for (const page of layout.pages) {
        for (const object of page.objects) {
          if (object.role !== 'dropcap') continue;
          const capLine = object.lines![0];
          expect(capLine.start).toBeGreaterThanOrEqual(0);
          expect(capLine.end).toBeGreaterThan(capLine.start);
        }
      }
    });
  }
});

// ─── B14: opening objects stack in openingOrder ──────────────────────────────────────────────────

describe('B14 opening order: opening objects stack in openingOrder, then document order', () => {
  it('stacks the default order kicker, headline, deck, byline, hero whatever the document order', () => {
    const doc = {
      blocks: [
        { kind: 'text-object' as const, id: 'byline', role: 'byline' as const, runs: [{ text: 'By' }] },
        { kind: 'text-object' as const, id: 'deck', role: 'deck' as const, runs: [{ text: 'Deck text' }] },
        { kind: 'text-object' as const, id: 'headline', role: 'headline' as const, runs: [{ text: 'Head' }] },
        { kind: 'text-object' as const, id: 'kicker', role: 'kicker' as const, runs: [{ text: 'Kick' }] },
        { kind: 'media-object' as const, id: 'hero', role: 'hero' as const, aspect: 1.5 },
        paragraphOf('p1', words(20, 'body')),
      ],
    };
    const layout = layoutFlow(doc, baseSpec({ roles: defaultRoles() }), env(1440, 900, 'paged-x'));
    // Stacking order is reading order across pages: compare (page, y).
    const order = ['kicker', 'headline', 'deck', 'byline', 'hero'].map((id) => {
      const object = objectOn(layout, id)!;
      return object.page * 100000 + object.rect.y;
    });
    for (let i = 1; i < order.length; i += 1) expect(order[i], `${i} after ${i - 1}`).toBeGreaterThan(order[i - 1]);
  });

  it('honours a spec openingOrder that lists byline first', () => {
    const doc = {
      blocks: [
        { kind: 'text-object' as const, id: 'kicker', role: 'kicker' as const, runs: [{ text: 'Kick' }] },
        { kind: 'text-object' as const, id: 'byline', role: 'byline' as const, runs: [{ text: 'By' }] },
        paragraphOf('p1', words(20, 'body')),
      ],
    };
    const spec = { ...baseSpec({ roles: defaultRoles() }), openingOrder: ['byline', 'kicker'] as never };
    const layout = layoutFlow(doc, spec, env(1440, 900, 'paged-x'));
    expect(objectOn(layout, 'byline')!.rect.y).toBeLessThan(objectOn(layout, 'kicker')!.rect.y);
  });
});

// ─── B15: page lines are in reading order, column by column ──────────────────────────────────────

describe('B15 reading order: page.lines is column by column, top to bottom, in array order', () => {
  for (const [vw, vh, mode] of [[1440, 900, 'paged-x'], [820, 1180, 'paged-y'], [390, 844, 'paged-x']] as const) {
    it(`keeps the array order of every page at ${vw}x${vh} ${mode}`, () => {
      const layout = layoutFlow(sampleDocument(), baseSpec(), env(vw, vh, mode));
      const problems: string[] = [];
      for (const page of layout.pages) {
        page.lines.forEach((line, i) => {
          if (i === 0) return;
          const prev = page.lines[i - 1];
          if (prev.column > line.column || (prev.column === line.column && prev.y > line.y)) {
            problems.push(`page ${page.index}: line ${i} (col ${line.column}, y ${line.y}) after (col ${prev.column}, y ${prev.y})`);
          }
        });
      }
      expect(problems.slice(0, 5)).toEqual([]);
    });
  }
});

// ─── B1 / stats: a healthy layout never falls back ───────────────────────────────────────────────

describe('B1 fallback: a healthy layout reports no fallback pages and whole-pixel pages', () => {
  it('reports zero fallback pages and integer page origins for the sample document', () => {
    const layout = layoutFlow(sampleDocument(), baseSpec(), env(1180.5, 820.5, 'paged-x'));
    expect(layout.stats.fallbackPages).toBe(0);
    for (const page of layout.pages) expect(Number.isInteger(page.rect.x)).toBe(true);
  });
});

// ─── B8: atEnd and invalidate on the real measurer ───────────────────────────────────────────────

describe('B8 measurer: atEnd is true only at the end of a paragraph; invalidate keeps working', () => {
  it('reports the end of a paragraph after its last line and not before', () => {
    const m = createPretextMeasurer();
    const font = { family: '"Stub Serif", serif', weight: 400, style: 'normal' as const, size: 16 };
    const prepared = m.prepare([{ text: words(12, 'end'), font }]);
    const first = m.nextLine(prepared, 60)!;
    expect(m.atEnd(prepared, first.end)).toBe(false);
    let cursor = first.end;
    for (let guard = 0; guard < 100; guard += 1) {
      const line = m.nextLine(prepared, 60, cursor);
      if (line === null) break;
      cursor = line.end;
    }
    expect(m.atEnd(prepared, cursor)).toBe(true);
    m.invalidate();
    expect(createPretextMeasurer({ locale: 'en' }).naturalWidth('abc', font)).toBeGreaterThan(0);
  });
});

// ─── B1 (amended): blocked rows are skipped however many; text never sets over an object ─────────

describe('B1 amended: text never sets over an object, however many rows the objects block', () => {
  it('keeps every line clear of three stacked opening objects totalling 60 rows on an unbounded page', () => {
    const doc: FlowDocument = {
      blocks: [
        { kind: 'media-object', id: 'h1', role: 'hero', aspect: 1 },
        { kind: 'media-object', id: 'h2', role: 'hero', aspect: 1 },
        { kind: 'media-object', id: 'h3', role: 'hero', aspect: 1 },
        para('p1', words(160, 'beneath')),
        para('p2', words(60, 'after')),
      ],
    };
    const spec = baseSpec({
      grid: { maxColumns: 1 },
      roles: {
        hero: {
          fit: { kind: 'none' },
          place: { column: 0, span: 1, vertical: 'top', clearance: 0 },
          height: { kind: 'lines', lines: 20 },
        },
      },
    });
    const layout = layoutFlow(doc, spec, env(390, 844, 'paged-y'));
    const objects = allObjects(layout);
    expect(objects.filter((o) => o.role === 'hero')).toHaveLength(3);
    const lines = allLines(layout);
    const hit: string[] = [];
    for (const line of lines) {
      for (const object of objects) {
        const r = object.rect;
        if (line.x < r.x + r.width && r.x < line.x + line.slotWidth && line.y < r.y + r.height && r.y < line.y + line.height) {
          hit.push(`${line.blockId}@${line.y} over ${object.id}`);
        }
      }
    }
    expect(hit.slice(0, 5)).toEqual([]);
    expect(allText(layout)).toContain('beneath');
    expect(allText(layout)).toContain('after');
    expect(layout.stats.fallbackPages).toBe(0);
  });
});
