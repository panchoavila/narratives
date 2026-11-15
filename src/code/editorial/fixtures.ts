// fixtures.ts — shared builders and invariant checks for the editorial flow engine's tests.
//
// Tests import the engine only through the package barrel. The checks below are the properties the
// spec states for every layout, so `layout.test.ts` can run them over a matrix of viewports, modes
// and specs. One deliberate allowance: a word wider than the slot is cut between graphemes with no
// hyphen (spec §3, `nextLine`), so a line may end inside a word with no source space at the break.
// `expectTextPreserved` accepts that boundary and still requires every other character to match in
// order, with the source space present wherever the source has one.

import { expect } from 'vitest';
import {
  createHyphenator,
  createPretextMeasurer,
  type BodySpec,
  type FlowDocument,
  type FlowEnvironment,
  type FlowLayout,
  type FlowMode,
  type FlowSpec,
  type GridSpec,
  type Hyphenator,
  type InlineRun,
  type ParagraphBlock,
  type PageLayout,
  type PlacedLine,
  type PlacedObject,
  type Rect,
} from '../../../packages/revyme-runtime-scene/src/editorial';

export const SHY = '­';
export const EPS = 0.01;

// ─── Specs ───────────────────────────────────────────────────────────────────────────────────────

export function defaultRoles(): FlowSpec['roles'] {
  return {
    kicker: {
      style: { family: '"Stub Sans", sans-serif', weight: 700, style: 'normal', scale: 0.7, leading: 1.2, tracking: 0.1, uppercase: true, align: 'start' },
      fit: { kind: 'tracking' },
      place: { column: 0, span: 'all', vertical: 'top', clearance: 0 },
      height: { kind: 'text' },
    },
    headline: {
      style: { family: '"Stub Serif", serif', weight: 700, style: 'normal', scale: 2.2, leading: 1.05, align: 'start' },
      fit: { kind: 'width', lines: 'auto', maxLines: 3, maxScale: 3 },
      place: { column: 0, span: 'all', vertical: 'top', clearance: 0 },
      height: { kind: 'text' },
    },
    deck: {
      style: { family: '"Stub Serif", serif', weight: 400, style: 'italic', scale: 1.3, leading: 1.3, align: 'start' },
      fit: { kind: 'none' },
      place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
      height: { kind: 'text' },
    },
    hero: {
      fit: { kind: 'none' },
      place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
      height: { kind: 'aspect', ratio: 2.2 },
    },
    byline: {
      style: { family: '"Stub Sans", sans-serif', weight: 400, style: 'normal', scale: 0.85, leading: 1.3, align: 'start' },
      fit: { kind: 'none' },
      place: { column: 0, span: 1, vertical: 'top', clearance: 0 },
      height: { kind: 'text' },
    },
    quote: {
      style: { family: '"Stub Serif", serif', weight: 400, style: 'italic', scale: 1.4, leading: 1.3, align: 'center' },
      fit: { kind: 'none' },
      place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
      height: { kind: 'text' },
    },
    media: {
      fit: { kind: 'none' },
      place: { column: 'anchor', span: 2, vertical: 'anchor', clearance: 1 },
      height: { kind: 'aspect', ratio: 1.5 },
    },
  };
}

export interface SpecOverrides {
  id?: string;
  grid?: Partial<GridSpec>;
  body?: Partial<BodySpec>;
  /** Replaces the default role rules when given (pass `{}` for none). */
  roles?: FlowSpec['roles'];
}

/** A complete, valid spec. `grid` and `body` are merged field by field; `roles` replaces. */
export function baseSpec(overrides: SpecOverrides = {}): FlowSpec {
  return {
    id: overrides.id ?? 'test-spec',
    grid: {
      measure: [28, 38, 52],
      maxColumns: 4,
      gap: 1,
      margin: [2, 2, 2, 2],
      bodySize: [14, 18],
      ...overrides.grid,
    },
    body: {
      family: '"Stub Serif", serif',
      weight: 400,
      leading: 1.4,
      justify: true,
      maxStretch: 0.35,
      maxShrink: 0.06,
      hyphenate: false,
      indent: 1,
      paragraphGap: 0,
      dropCap: null,
      widows: 2,
      orphans: 2,
      crosshead: {
        family: '"Stub Sans", sans-serif',
        weight: 700,
        style: 'normal',
        scale: 0.9,
        leading: 1.2,
        spaceBefore: 1,
      },
      ...overrides.body,
    },
    roles: overrides.roles ?? defaultRoles(),
  };
}

// ─── Environments and content ────────────────────────────────────────────────────────────────────

export function env(
  width: number,
  height: number,
  mode: FlowMode,
  extra: { hyphenator?: Hyphenator | null } = {},
): FlowEnvironment {
  return {
    viewport: { width, height },
    mode,
    measurer: createPretextMeasurer(),
    hyphenator: extra.hyphenator ?? null,
  };
}

/** A deterministic hyphenator: a soft hyphen after every third letter, then `createHyphenator`'s
 *  own minimum-letter rules apply. Real dictionaries are not needed to exercise the engine. */
export function syllableHyphenator(): Hyphenator {
  return createHyphenator((word, options) => {
    const sep = options?.hyphenChar ?? '-';
    const chars = [...word];
    let out = '';
    chars.forEach((ch, i) => {
      out += ch;
      if ((i + 1) % 3 === 0 && i + 1 < chars.length) out += sep;
    });
    return out;
  });
}

/** Twenty-four words of ordinary length, the reference paragraph used in exact-line tests. */
export function words(count: number, word = 'aaaa'): string {
  return Array.from({ length: count }, () => word).join(' ');
}

/** The reference article: opening objects, 13 body paragraphs in 4 groups, 2 crossheads, one
 *  quote text object and one media object between paragraphs. */
export function sampleDocument(): FlowDocument {
  return {
    blocks: [
      { kind: 'text-object', id: 'kicker', role: 'kicker', runs: [{ text: 'Field notes on long text' }] },
      { kind: 'text-object', id: 'headline', role: 'headline', runs: [{ text: 'The Patient Column' }] },
      {
        kind: 'text-object',
        id: 'deck',
        role: 'deck',
        runs: [{ text: 'An argument about measure, leading, and the reader who keeps going' }],
      },
      { kind: 'media-object', id: 'hero', role: 'hero', src: 'hero.jpg', alt: 'A tall grey column of text' },
      { kind: 'text-object', id: 'byline', role: 'byline', runs: [{ text: 'By a reader of columns' }] },
      {
        kind: 'paragraph',
        id: 'p1',
        role: 'body',
        runs: [
          {
            text: 'A long text is a machine for making a reader patient. Every column asks the eye to travel back to its beginning, and every line break is a small decision about rhythm, sound and breath. ',
          },
          { text: 'The engine below', em: true },
          {
            text: ' has no opinion about prose, but it does have strong opinions about space. It will place a line only where a line fits, and it will leave a gap only where the page truly needs one. Nothing is painted until the arithmetic has finished, so the same text always lands in the same place.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p2',
        role: 'body',
        runs: [
          {
            text: 'Measure is the quiet variable. A line of roughly forty characters is easy to scan, while a line of ninety forces the eye to hunt for the next start. The engine reads the measure from the grid rather than from a fixed width, so a phone and a wide desk receive the same ratio of letters to space. When the viewport shrinks, the column count falls first and the body size follows, and the leading is recomputed from the new size so that every baseline still lands on the grid of whole pixels.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p3',
        role: 'body',
        runs: [
          {
            text: 'Reading on a screen is not the same as reading on paper, yet the two share a need for stable edges. A reader who finds the start of each line without effort can spend attention on the sentence itself. Compare the old printed handbooks with the careful layouts described in ',
          },
          { text: 'a reference on typographic practice', href: 'https://example.test/typography' },
          { text: '. Both succeed for the same reason: the text is allowed to be ordinary while the spacing is not.' },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p4',
        role: 'body',
        runs: [
          {
            text: 'Justification is the most debated feature of any column. Stretch the spaces and a short line looks tidy but reveals rivers of white between words. Squeeze them and the words crowd together until the sentence loses its breath. The compromise used here is deliberately narrow. A line may be stretched only a little, or squeezed only a little, and the engine chooses whichever candidate costs less to achieve the measure. Lines that cannot be justified within those limits stay ragged, which is honest and easy to read.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'h1',
        role: 'crosshead',
        runs: [{ text: 'Measure and leading' }],
      },
      {
        kind: 'paragraph',
        id: 'p5',
        role: 'body',
        runs: [
          {
            text: 'Crossheads mark the turns of an argument without interrupting its flow. They are set in a smaller sans face, above a space that keeps them from clinging to the text they introduce. A crosshead must never be stranded at the foot of a column, so the engine asks whether a column has room for the heading and at least two lines of the paragraph that follows. If it does not, the heading moves to the top of the next column, where it can speak for the text beneath it.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p6',
        role: 'body',
        runs: [
          {
            text: 'Hyphenation is a concession to the measure rather than a virtue in itself. Without it, a long word can open a gap wide enough to spoil a whole line. With it, the engine may break a word at a syllable boundary and paint a small hyphen at the end of the line. The breaks are optional and drawn from a dictionary, and the engine refuses any break that leaves too few letters on either side. Short words and names stay whole, and so do links, which the reader may need to recognise at a glance.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p7',
        role: 'body',
        runs: [
          { text: 'The second rule concerns the last line of every paragraph. ' },
          { text: 'That line is never stretched', strong: true },
          {
            text: ' to fill the measure, because a full stop followed by empty space is a signal the reader relies on. It is set flush left and left alone, however short it turns out to be. A paragraph that ends with a single word is allowed, but the engine will prefer to move a word down so that the final line carries a little more weight.',
          },
        ],
      },
      {
        kind: 'text-object',
        id: 'q1',
        role: 'quote',
        runs: [{ text: 'Every line break is a small decision about rhythm, sound and breath.' }],
      },
      {
        kind: 'paragraph',
        id: 'p8',
        role: 'body',
        runs: [
          {
            text: 'Widows and orphans are the stubborn cases. An orphan is the first line of a paragraph stranded alone at the foot of a column, and a widow is the last line that climbs alone to the top of the next one. The engine treats both as faults of the same size. It counts the lines on each side of a break, and when a paragraph starts too late in a column it moves the paragraph instead of leaving a fragment behind. Those counts are read from the spec, so a designer can make the rule stricter or looser without touching the code.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p9',
        role: 'body',
        runs: [
          { text: 'Opening objects come first in the reading order. ' },
          { text: 'A headline, a deck and a hero image', em: true },
          {
            text: ' are placed before any text is set, and they claim their place on the first page. Anchored objects behave differently. They wait for the text to reach them, then take the next free row in the column they belong to, and the words after them resume below a clear margin. A picture placed in the middle of an argument should never sit on top of the sentence that refers to it.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p10',
        role: 'body',
        runs: [
          {
            text: 'Carried objects are the last resort. When an object does not fit the rows left in a column, it moves to the top of the next column, and when no column on the page can hold it, the object travels to the following page with the first place reserved for it. Nothing is dropped. If a block of text cannot be placed exactly as its rule asks, the engine falls back to the simplest arrangement that still keeps every word in its order, and it records the deviation so that a review can find it later.',
          },
        ],
      },
      {
        kind: 'media-object',
        id: 'm1',
        role: 'media',
        src: 'figure-grid.svg',
        alt: 'A diagram of four columns',
      },
      { kind: 'text-object', id: 'c1', role: 'caption', runs: [{ text: 'Four columns at a wide viewport.' }] },
      {
        kind: 'paragraph',
        id: 'h2',
        role: 'crosshead',
        runs: [{ text: 'Objects and carried text' }],
      },
      {
        kind: 'paragraph',
        id: 'p11',
        role: 'body',
        runs: [
          {
            text: 'Drop caps are decorative, and decoration has a cost. The initial letter here occupies a fixed block of rows, so the first paragraph must find those rows free before it can begin. The cap is sized by its cap height rather than its full em box, which keeps its top aligned with the first line and its foot aligned with the baseline of the last row it covers. The text beside it then wraps around a small reserved rectangle, and the reader never has to step over a letter to find the next word.',
          },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p12',
        role: 'body',
        runs: [
          { text: 'Pages are the unit of attention. ' },
          { text: 'Each page is laid out again', strong: true },
          {
            text: ' whenever an object asks to be placed first, and the text keeps its order through every restart. A page may be a window that scrolls sideways or a column that grows downward, and the same rules govern both. For a deeper look at the mechanics, see ',
          },
          { text: 'the engine notes', href: 'https://example.test/engine' },
          { text: ' kept beside the code, which describe each step in the order the engine takes it.' },
        ],
      },
      {
        kind: 'paragraph',
        id: 'p13',
        role: 'body',
        runs: [
          {
            text: 'Long pieces end where they began, with the reader still in the middle of a thought. The last page should therefore stop at its content and nowhere else. In a horizontal flow every page keeps its full width, because the reader pages sideways through them. In a vertical flow the final page shrinks to the lines it holds plus the margin beneath them, so that the document does not end in a field of empty canvas. Both choices serve the same purpose, which is to keep attention on the words and off the edges around them.',
          },
        ],
      },
    ],
  };
}

/** Plain text of runs as written, soft hyphens removed, whitespace collapsed. */
export function sourceText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join('').split(SHY).join('').replace(/\s+/g, ' ').trim();
}

// ─── Line and page helpers ───────────────────────────────────────────────────────────────────────

export function paragraphBlocks(doc: FlowDocument): ParagraphBlock[] {
  return doc.blocks.filter((b): b is ParagraphBlock => b.kind === 'paragraph');
}

export function allLines(layout: FlowLayout): PlacedLine[] {
  return layout.pages.flatMap((p) => p.lines);
}

export function allObjects(layout: FlowLayout): PlacedObject[] {
  return layout.pages.flatMap((p) => p.objects);
}

/** The lines of one paragraph, in reading order (page, column, then top to bottom). */
/** The lines of one block, in the order the layout returns them (reading order, B15). Not sorted:
 *  a test that depends on sorting would hide an ordering bug. */
export function linesOf(layout: FlowLayout, blockId: string): PlacedLine[] {
  return allLines(layout).filter((l) => l.blockId === blockId);
}

/** Word gaps of a placed line: spaces inside fragment texts plus gaps between fragments. */
export function wordGaps(line: PlacedLine): number {
  let gaps = 0;
  line.fragments.forEach((f, i) => {
    gaps += (f.text.match(/ /g) ?? []).length;
    if (i > 0) {
      const prev = line.fragments[i - 1];
      if (f.x > prev.x + prev.width + EPS) gaps += 1;
    }
  });
  return gaps;
}

/** Painted right edge of a line: its width plus the word-spacing adjustment. */
export function paintedRight(line: PlacedLine): number {
  return line.x + line.width + line.wordSpacing * wordGaps(line);
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPS &&
    b.x < a.x + a.width - EPS &&
    a.y < b.y + b.height - EPS &&
    b.y < a.y + a.height - EPS
  );
}

// ─── Invariants ──────────────────────────────────────────────────────────────────────────────────

/** Rebuilds each paragraph from its placed lines and compares it with the source. Lines are
 *  joined with a space unless the line is hyphenated (then the painted hyphen is dropped and
 *  nothing is added). A line boundary with no source space is accepted only where a word was cut. */
export function expectTextPreserved(doc: FlowDocument, layout: FlowLayout, spec?: FlowSpec): void {
  for (const block of paragraphBlocks(doc)) {
    const lines = linesOf(layout, block.id);
    expect(lines.length, `paragraph ${block.id} has no placed lines`).toBeGreaterThan(0);

    let source = sourceText(block.runs);
    if (spec?.body.crosshead.uppercase && block.role === 'crosshead') source = source.toUpperCase();

    const segments = lines.map((line) => {
      let text = '';
      line.fragments.forEach((f, j) => {
        if (j > 0) {
          const prev = line.fragments[j - 1];
          if (f.x > prev.x + prev.width + EPS) text += ' ';
        }
        text += f.text;
      });
      if (line.hyphenated) {
        expect(text.endsWith('-'), `hyphenated line in ${block.id} does not paint a hyphen`).toBe(true);
        text = text.slice(0, -1);
      }
      return text;
    });

    // A drop cap is the first grapheme(s) of the paragraph, removed from the text. The spec trims the
    // spaces that follow it, so one source space after the cap is allowed.
    let pos = 0;
    const cap = findObject(layout, `${block.id}-cap`);
    if (cap) {
      const capText = cap.lines?.[0]?.text ?? '';
      expect(source.startsWith(capText), `drop cap of ${block.id} is not the start of its paragraph`).toBe(true);
      pos = capText.length;
      if (source[pos] === ' ') pos += 1;
    }

    segments.forEach((seg, i) => {
      expect(source.startsWith(seg, pos), `paragraph ${block.id}: line ${i} "${seg}" does not continue the source at ${pos}`).toBe(true);
      pos += seg.length;
      if (i < segments.length - 1 && !lines[i].hyphenated && source[pos] === ' ') pos += 1;
    });
    expect(pos, `paragraph ${block.id}: text left over or missing at the end`).toBe(source.length);
  }
}

export function findObject(layout: FlowLayout, id: string): PlacedObject | undefined {
  return allObjects(layout).find((o) => o.id === id);
}

/** No two line boxes or objects on a page intersect; no painted line extent meets an object; every
 *  painted extent stays inside its slot; every line lies inside its column frame. */
export function expectNoOverlap(layout: FlowLayout): void {
  for (const page of layout.pages) {
    const lineBoxes = page.lines.map((l) => ({
      x: l.x,
      y: l.y,
      width: l.slotWidth,
      height: l.height,
    }));
    for (let i = 0; i < lineBoxes.length; i++) {
      for (let j = i + 1; j < lineBoxes.length; j++) {
        expect(intersects(lineBoxes[i], lineBoxes[j]), `page ${page.index}: lines ${i} and ${j} overlap`).toBe(false);
      }
    }

    for (const line of page.lines) {
      const right = paintedRight(line);
      expect(right, `page ${page.index}: line "${line.fragments[0]?.text}" paints past its slot`).toBeLessThanOrEqual(line.x + line.slotWidth + EPS);
      const extent = { x: line.x, y: line.y, width: Math.max(0, right - line.x), height: line.height };
      for (const obj of page.objects) {
        expect(intersects(extent, obj.rect), `page ${page.index}: line at y ${line.y} overlaps object ${obj.id}`).toBe(false);
      }
      const frame = page.frames[line.column];
      expect(frame, `page ${page.index}: line in missing column ${line.column}`).toBeDefined();
      expect(line.x, 'line starts left of its frame').toBeGreaterThanOrEqual(frame.x - EPS);
      expect(line.x + line.slotWidth, 'line slot ends right of its frame').toBeLessThanOrEqual(frame.x + frame.width + EPS);
      expect(line.y, 'line starts above its frame').toBeGreaterThanOrEqual(frame.y - EPS);
      expect(line.y + line.height, 'line ends below its frame').toBeLessThanOrEqual(frame.y + frame.height + EPS);
    }

    const objects = page.objects.map((o) => o.rect);
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        expect(intersects(objects[i], objects[j]), `page ${page.index}: objects ${i} and ${j} overlap`).toBe(false);
      }
    }
  }
}

/** Every number is finite; no width, height or slot is negative. */
export function expectFinite(layout: FlowLayout): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      expect(Number.isFinite(value), `${path} is not finite (${value})`).toBe(true);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) {
        if (['width', 'height', 'slotWidth'].includes(key) && typeof v === 'number') {
          expect(v, `${path}.${key} is negative`).toBeGreaterThanOrEqual(0);
        }
        walk(v, `${path}.${key}`);
      }
    }
  };
  walk(layout, 'layout');
}

/** Justified lines fill their slot exactly, use at most the stretch or shrink limit per gap, and
 *  no last line, crosshead line or line of an unjustified spec is justified. */
export function expectJustification(layout: FlowLayout, spec: FlowSpec): void {
  const size = layout.body.font.size;
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (!line.justified) {
        expect(line.wordSpacing, `unjustified line at y ${line.y} has word spacing`).toBe(0);
        continue;
      }
      expect(spec.body.justify, 'a line is justified in an unjustified spec').toBe(true);
      expect(line.last, `last line at y ${line.y} is justified`).toBe(false);
      expect(line.role, 'crosshead line is justified').toBe('body');
      const gaps = wordGaps(line);
      expect(gaps, `justified line at y ${line.y} has no gaps`).toBeGreaterThan(0);
      expect(Math.abs(line.width + line.wordSpacing * gaps - line.slotWidth), `justified line at y ${line.y} does not fill its slot`).toBeLessThan(0.01);
      if (line.wordSpacing > 0) {
        expect(line.wordSpacing, 'stretch exceeds maxStretch').toBeLessThanOrEqual(spec.body.maxStretch * size + EPS);
      } else {
        expect(-line.wordSpacing, 'shrink exceeds maxShrink').toBeLessThanOrEqual(spec.body.maxShrink * size + EPS);
      }
    }
  }
}

/** Line y values and object y values sit on the baseline grid of their frame; bounded object
 *  heights do too. */
export function expectOnGrid(layout: FlowLayout): void {
  const lh = layout.body.lineHeight;
  const whole = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-6;
  for (const page of layout.pages) {
    const top = page.frames[0].y;
    for (const line of page.lines) {
      const frame = page.frames[line.column];
      expect(whole((line.y - frame.y) / lh), `line y ${line.y} is off the grid`).toBe(true);
    }
    for (const obj of page.objects) {
      expect(whole((obj.rect.y - top) / lh), `object ${obj.id} y ${obj.rect.y} is off the grid`).toBe(true);
      if (Number.isFinite(page.frames[0].height)) {
        expect(whole(obj.rect.height / lh), `object ${obj.id} height ${obj.rect.height} is off the grid`).toBe(true);
      }
    }
  }
}

/** Every non-paragraph block of the document is placed exactly once, nothing is dropped. */
export function expectObjectsPlacedOnce(doc: FlowDocument, layout: FlowLayout): void {
  expect(layout.stats.droppedObjects, 'objects were dropped').toEqual([]);
  for (const block of doc.blocks) {
    if (block.kind === 'paragraph') continue;
    const count = allObjects(layout).filter((o) => o.id === block.id).length;
    expect(count, `object ${block.id} placed ${count} times`).toBe(1);
  }
}

/** Runs every invariant the spec states for a layout of `doc`. */
export function expectAllInvariants(doc: FlowDocument, layout: FlowLayout, spec: FlowSpec): void {
  expect(layout.pages.length, 'layout produced no pages').toBeGreaterThan(0);
  expectFinite(layout);
  expectTextPreserved(doc, layout, spec);
  expectNoOverlap(layout);
  expectJustification(layout, spec);
  expectOnGrid(layout);
  expectObjectsPlacedOnce(doc, layout);
}

export function pageAt(layout: FlowLayout, index: number): PageLayout {
  const page = layout.pages[index];
  expect(page, `no page ${index}`).toBeDefined();
  return page;
}

// ─── Round 5 invariants (C3, E4, E5 and the keep-with-next rule of E1) ─────────────────────────────

const ORDINARY_WS = /[ \t\n\r\f\v]+/g;
const SOFT_HYPHEN = /­/g;

/** Ordinary whitespace collapsed to one space, soft hyphens removed, ends trimmed: the form in which a
 *  source slice and a painted fragment are compared (C3, E5). */
export function normalText(text: string): string {
  return text.replace(ORDINARY_WS, ' ').replace(SOFT_HYPHEN, '').trim();
}

/** Every line of every block in reading order, with its index in the layout's flat list. */
function flatLines(layout: FlowLayout): PlacedLine[] {
  return allLines(layout);
}

/** C3: every fragment of every paragraph and crosshead points at its own source characters, in source
 *  order, and paints exactly what those characters say. The drop cap's letters are not repeated. */
export function expectFragmentSources(doc: FlowDocument, layout: FlowLayout): void {
  const lines = flatLines(layout);
  const cap = new Map<number, PlacedObject>();
  for (const object of allObjects(layout)) if (object.role === 'dropcap') cap.set(object.block, object);
  const previous = new Map<number, { run: number; start: number; end: number }>();
  for (const line of lines) {
    const block = doc.blocks[line.block];
    expect(block?.kind, `line of block ${line.block} is not a paragraph`).toBe('paragraph');
    const runs = (block as ParagraphBlock).runs;
    line.fragments.forEach((fragment, index) => {
      const run = runs[fragment.run];
      expect(run, `fragment run ${fragment.run} of ${line.blockId} does not exist`).toBeDefined();
      expect(fragment.start, `fragment start of ${line.blockId}`).toBeGreaterThanOrEqual(0);
      expect(fragment.end, `fragment end of ${line.blockId}`).toBeGreaterThan(fragment.start);
      expect(fragment.end, `fragment end of ${line.blockId} past its run`).toBeLessThanOrEqual(run.text.length);
      const before = previous.get(line.block);
      if (before !== undefined) {
        expect(fragment.run, `fragments of ${line.blockId} leave their run order`).toBeGreaterThanOrEqual(before.run);
        if (fragment.run === before.run) {
          expect(fragment.start, `fragments of ${line.blockId} overlap or reorder`).toBeGreaterThanOrEqual(before.end - 1);
        }
      }
      const object = cap.get(line.block);
      if (object !== undefined && object.lines?.[0] !== undefined && fragment.run === object.run) {
        expect(fragment.start, `fragment of ${line.blockId} repeats the drop cap`).toBeGreaterThanOrEqual(object.lines[0].end);
      }
      let painted = fragment.text;
      const isLast = index === line.fragments.length - 1;
      if (isLast && line.hyphenated) painted = painted.replace(/-$/, '');
      const source = normalText(run.text.slice(fragment.start, fragment.end));
      const expected = normalText(painted);
      const upper = line.role === 'crosshead' && source.toUpperCase() === expected;
      expect(source === expected || upper, `${line.blockId}: source "${run.text.slice(fragment.start, fragment.end)}" paints "${fragment.text}"`).toBe(true);
      previous.set(line.block, { run: fragment.run, start: fragment.start, end: fragment.end });
    });
  }
}

/** E5: each fitted line of a text object or drop cap names its own characters in the object's runs,
 *  concatenated as passed in, in source order. */
export function expectFittedSources(doc: FlowDocument, layout: FlowLayout): void {
  for (const page of layout.pages) {
    for (const object of page.objects) {
      if (object.lines === undefined) continue;
      const block = doc.blocks[object.block];
      const runs = (block as { runs: { text: string }[] }).runs;
      const total = runs.map((run) => run.text).join('');
      let last = -1;
      for (const line of object.lines) {
        if (line.text === '' && line.start === 0 && line.end === 0) continue;
        expect(line.start, `${object.id}: line start`).toBeGreaterThanOrEqual(0);
        expect(line.end, `${object.id}: line end`).toBeGreaterThan(line.start);
        expect(line.end, `${object.id}: line end past its text`).toBeLessThanOrEqual(total.length);
        expect(line.start, `${object.id}: lines out of source order`).toBeGreaterThanOrEqual(last);
        last = line.start;
        const source = normalText(total.slice(line.start, line.end));
        const painted = normalText(line.text);
        const ok = source === painted || source.toUpperCase() === painted;
        expect(ok, `${object.id}: source "${total.slice(line.start, line.end)}" paints "${line.text}"`).toBe(true);
      }
    }
  }
}

/** E4: a caption that directly follows a media block sits directly under that media's box, on the same
 *  page, at the same x and width. */
export function expectCaptionsUnderMedia(doc: FlowDocument, layout: FlowLayout): void {
  const objects = allObjects(layout);
  doc.blocks.forEach((block, b) => {
    if (block.kind !== 'text-object' || block.role !== 'caption' || b === 0) return;
    const media = doc.blocks[b - 1];
    if (media.kind !== 'media-object') return;
    const cap = objects.find((o) => o.block === b);
    const pic = objects.find((o) => o.block === b - 1);
    expect(pic, `media ${media.id} is not placed`).toBeDefined();
    expect(cap, `caption ${block.id} is not placed`).toBeDefined();
    if (pic === undefined || cap === undefined) return;
    expect(cap.page, `caption ${block.id} is on another page than its media`).toBe(pic.page);
    expect(cap.rect.x).toBeCloseTo(pic.rect.x, 6);
    expect(cap.rect.width).toBeCloseTo(pic.rect.width, 6);
    expect(Math.abs(cap.rect.y - (pic.rect.y + pic.rect.height)), `caption ${block.id} is not directly under ${media.id}`).toBeLessThan(1e-6);
  });
}

/** Pages never overlap one another. */
export function expectNoPageOverlap(layout: FlowLayout): void {
  for (let i = 0; i < layout.pages.length; i += 1) {
    for (let j = i + 1; j < layout.pages.length; j += 1) {
      expect(intersects(layout.pages[i].rect, layout.pages[j].rect), `pages ${i} and ${j} overlap`).toBe(false);
    }
  }
}

/** Lines are in reading order on each page: column by column, top to bottom (B15). */
export function expectReadingOrder(layout: FlowLayout): void {
  let lastPage = -1;
  for (const page of layout.pages) {
    expect(page.index, 'page index out of order').toBeGreaterThan(lastPage);
    lastPage = page.index;
    let lastKey = [-Infinity, -Infinity];
    for (const line of page.lines) {
      const key = [line.column, line.y];
      const ordered = key[0] > lastKey[0] || (key[0] === lastKey[0] && key[1] >= lastKey[1] - EPS);
      expect(ordered, `page ${page.index}: line "${line.fragments[0]?.text}" is out of reading order`).toBe(true);
      lastKey = key;
    }
  }
}

/** Every font is valid for a canvas: weight 1–1000, size at least 1. */
export function expectFonts(layout: FlowLayout): void {
  const check = (font: { weight: number; size: number }, where: string): void => {
    expect(font.weight, `${where} weight`).toBeGreaterThanOrEqual(1);
    expect(font.weight, `${where} weight`).toBeLessThanOrEqual(1000);
    expect(font.size, `${where} size`).toBeGreaterThanOrEqual(1);
  };
  for (const page of layout.pages) {
    for (const line of page.lines) {
      check(line.font, `line ${line.blockId}`);
      for (const fragment of line.fragments) check(fragment.font, `fragment of ${line.blockId}`);
    }
    for (const object of page.objects) {
      for (const line of object.lines ?? []) check(line.font, `object ${object.id}`);
    }
  }
}

/** A line paints no wider than its slot whenever its word spacing is not negative (E8). */
export function expectLinesFitSlots(layout: FlowLayout): void {
  for (const line of allLines(layout)) {
    if (line.wordSpacing < 0) continue;
    expect(line.width, `line "${line.fragments[0]?.text}" of ${line.blockId} is wider than its slot`).toBeLessThanOrEqual(line.slotWidth + EPS);
  }
}

/** A crosshead that is the last line of its column while the next block starts in another column,
 *  unless it is the document's last block or an object follows it (E1). Empty when none. */
export function strandedCrossheads(doc: FlowDocument, layout: FlowLayout): string[] {
  const lines = flatLines(layout);
  const problems: string[] = [];
  doc.blocks.forEach((block, b) => {
    if (block.kind !== 'paragraph' || block.role !== 'crosshead') return;
    let last = -1;
    lines.forEach((line, i) => {
      if (line.block === b) last = i;
    });
    if (last < 0) return;
    const here = lines[last];
    const next = lines[last + 1];
    if (next !== undefined && next.page === here.page && next.column === here.column) return;
    if (b + 1 >= doc.blocks.length || doc.blocks[b + 1].kind !== 'paragraph') return;
    const after = lines.find((line, i) => i > last && line.block === b + 1);
    if (after === undefined) return;
    if (after.page !== here.page || after.column !== here.column) {
      problems.push(`crosshead ${block.id} (block ${b}) ends page ${here.page} column ${here.column}; next block starts page ${after.page} column ${after.column}`);
    }
  });
  return problems;
}

/** Every round-5 property the spec states for a layout of `doc` (without the justification and grid
 *  rules, which need a valid spec: see `expectAllInvariants`). */
export function expectRound5Invariants(doc: FlowDocument, layout: FlowLayout, spec?: FlowSpec): void {
  expectFinite(layout);
  expectFonts(layout);
  expectTextPreserved(doc, layout, spec);
  expectFragmentSources(doc, layout);
  expectFittedSources(doc, layout);
  expectNoOverlap(layout);
  expectNoPageOverlap(layout);
  expectReadingOrder(layout);
  expectLinesFitSlots(layout);
  expectCaptionsUnderMedia(doc, layout);
  expect(strandedCrossheads(doc, layout), 'a crosshead is stranded').toEqual([]);
}
