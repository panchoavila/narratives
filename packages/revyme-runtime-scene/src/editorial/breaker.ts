// editorial/breaker.ts — what one paragraph's lines are. Owns the paragraph's preparation (whitespace
// collapse, upper-casing, the drop cap split, hyphenation, fonts), the choice between a natural and a
// squeezed line, the justification of a placed line and its fragments. Every text the engine measures
// is a `Piece` that keeps its source offsets (`source.ts`). Pure over the Measurer: it decides what a
// line is, never where it goes.

import { hyphenateRuns } from './hyphenate';
import { boldWeight, makeFont } from './font';
import {
  collapseOrdinary,
  concatOf,
  pieceOf,
  sliceOf,
  spanOf,
  upperCase,
  withInsertedShy,
  type Piece,
} from './source';
import type {
  BodyGrid,
  BodySpec,
  FontSpec,
  Hyphenator,
  InlineRun,
  LineCursor,
  MeasureItem,
  Measurer,
  MeasuredLine,
  ParagraphBlock,
  PlacedFragment,
  PreparedParagraph,
} from './types';

/** Opening punctuation a drop cap takes in front of its first letter. */
const OPENING = '“‘«¿¡("\'';

export interface DropCapPlan {
  /** The painted letters. */
  text: string;
  font: FontSpec;
  /** Columns of reserved width, whole px. */
  reserved: number;
  /** Rows the cap spans, at most. */
  rows: number;
  /** Natural width of the cap text. */
  natural: number;
  /** The run the letters come from, and their source span in it. */
  run: number;
  span: { start: number; end: number };
  /** The link the run belongs to, when it has one (B11). */
  href?: string;
}

/** What a drop cap is made of, before its size is chosen: its letters, their run and span, the link
 *  they belong to, and the face the cap is set in. */
export interface CapSource {
  text: string;
  run: number;
  span: { start: number; end: number };
  href?: string;
  family: string;
  weight: number;
}

export interface ParagraphVariant {
  /** The runs as measured: their marks, with `text` the transformed text. */
  runs: InlineRun[];
  /** Per run, the transformed text with its source map. */
  pieces: Piece[];
  prepared: PreparedParagraph;
}

export interface ParagraphPlan {
  id: string;
  role: 'body' | 'crosshead';
  /** The roman font of the paragraph's lines. */
  font: FontSpec;
  /** Whole rows one line occupies: 1 for body lines, the crosshead's rows otherwise. */
  rows: number;
  /** Lines of the paragraph at the frame width, for keep-with-next. */
  plain: ParagraphVariant;
  /** The variant with the drop cap's letters removed, when a cap applies. */
  capped: ParagraphVariant | null;
  dropCap: DropCapPlan | null;
  /** The letters and face a cap of any height is made from (E3). */
  capSource: CapSource | null;
  /** The variant the paragraph's lines are currently laid with. */
  variant: 'plain' | 'capped';
}

export interface PlanInput {
  block: ParagraphBlock;
  body: BodySpec;
  grid: BodyGrid;
  measurer: Measurer;
  hyphenator: Hyphenator | null;
  /** The drop cap applies only to the first body paragraph of the piece. */
  dropCapAllowed: boolean;
}

/** Font of one run: the paragraph's base font with the run's em and strong marks applied. */
export function variantFont(base: FontSpec, run: InlineRun): FontSpec {
  const style = run.em === true ? 'italic' : base.style;
  const weight = run.strong === true ? boldWeight(base.weight) : base.weight;
  const font = makeFont(base.family, weight, style, base.size, base.letterSpacing);
  return font;
}

function itemsOf(runs: InlineRun[], base: FontSpec): MeasureItem[] {
  return runs.map((run) => ({ text: run.text, font: variantFont(base, run) }));
}

function firstGrapheme(text: string): string {
  if (text === '') return '';
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
        segment(input: string): Iterable<{ segment: string }>;
      };
    }
  ).Segmenter;
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return part.segment;
    return '';
  }
  return Array.from(text)[0] ?? '';
}

/** Splits the drop cap off the first non-empty piece: the leading opening punctuation and the first
 *  grapheme. The text after it loses its leading spaces. Null when there is no letter or digit to cap
 *  (E3: a space or punctuation after the opening marks is not a letter). */
function takeDropCap(pieces: Piece[]): { cap: Piece; run: number; rest: Piece[] } | null {
  const k = pieces.findIndex((piece) => piece.text !== '');
  if (k < 0) return null;
  const text = pieces[k].text;
  let p = 0;
  while (p < text.length && OPENING.includes(text.charAt(p))) p += 1;
  const letter = firstGrapheme(text.slice(p));
  if (letter === '' || !/[\p{L}\p{N}]/u.test(letter)) return null;
  const capLength = p + letter.length;

  const cap = sliceOf(pieces[k], 0, capLength);
  const rest = pieces.map((piece) => ({ ...piece }));
  rest[k] = sliceOf(pieces[k], capLength, text.length);
  for (let j = k; j < rest.length; j += 1) {
    let skip = 0;
    while (skip < rest[j].text.length && rest[j].text.charAt(skip) === ' ') skip += 1;
    rest[j] = sliceOf(rest[j], skip, rest[j].text.length);
    if (rest[j].text !== '') break;
  }
  return { cap, run: k, rest };
}

function variantOf(
  block: ParagraphBlock,
  pieces: Piece[],
  base: FontSpec,
  measurer: Measurer,
  hyphenator: Hyphenator | null,
): ParagraphVariant {
  const runs: InlineRun[] = block.runs.map((run, index) => ({ ...run, text: pieces[index].text }));
  if (hyphenator !== null) {
    const hyphenated = hyphenateRuns(runs, hyphenator);
    const shy = pieces.map((piece, index) => withInsertedShy(piece, hyphenated[index].text));
    shy.forEach((piece, index) => {
      pieces[index] = piece;
      runs[index] = { ...runs[index], text: piece.text };
    });
  }
  return { runs, pieces, prepared: measurer.prepare(itemsOf(runs, base)) };
}

/** Lays out the preparation of one paragraph: runs (whitespace collapsed, upper-cased for an
 *  upper-case crosshead, hyphenated for body text), fonts, the prepared variants and the drop cap. */
/** The drop cap of `src` set over `rows` lines (E3): its font size, reserved width and natural width
 *  are all worked out for those rows. The glyph's cap height spans from the top row's cap line to the
 *  baseline of the last row. */
export function dropCapAt(src: CapSource, rows: number, grid: BodyGrid, measurer: Measurer): DropCapPlan {
  const lh = grid.lineHeight;
  const roman = makeFont(grid.font.family, grid.font.weight, 'normal', grid.font.size);
  const capFontBase = makeFont(src.family, src.weight, 'normal', 100);
  const probe = measurer.metrics(capFontBase).capHeight / 100;
  const capRatio = Number.isFinite(probe) && probe > 0 ? probe : 0.7;
  const target = (rows - 1) * lh + measurer.metrics(roman).capHeight;
  const size = Math.max(1, Math.round((target / capRatio) * 100) / 100);
  const font = makeFont(src.family, src.weight, 'normal', size);
  const natural = measurer.naturalWidth(src.text, font);
  const plan: DropCapPlan = {
    text: src.text,
    font,
    reserved: Math.ceil(natural + 0.5 * grid.font.size),
    rows,
    natural,
    run: src.run,
    span: src.span,
  };
  if (src.href !== undefined) plan.href = src.href;
  return plan;
}

export function planParagraph(input: PlanInput): ParagraphPlan {
  const { block, body, grid, measurer } = input;
  const lh = grid.lineHeight;

  if (block.role === 'crosshead') {
    const style = body.crosshead;
    // E8(c): a crosshead is never set wider than a column, so its size is capped at the column width.
    const size = Math.min(Math.max(1, Math.round(style.scale * grid.font.size)), Math.max(1, grid.columnWidth));
    const letterSpacing = style.tracking !== undefined ? style.tracking * size : undefined;
    const font = makeFont(style.family, style.weight, style.style, size, letterSpacing);
    const upper = style.uppercase === true;
    const pieces = block.runs.map((run) => {
      const collapsed = collapseOrdinary(pieceOf(run.text));
      return upper ? upperCase(collapsed) : collapsed;
    });
    const crossLh = Math.max(1, Math.round(size * style.leading));
    const rows = Math.max(1, Math.ceil(crossLh / lh));
    return {
      id: block.id,
      role: 'crosshead',
      font,
      rows,
      plain: variantOf(block, pieces, font, measurer, null),
      capped: null,
      dropCap: null,
      capSource: null,
      variant: 'plain',
    };
  }

  const roman = makeFont(grid.font.family, grid.font.weight, 'normal', grid.font.size);
  const collapsed = block.runs.map((run) => collapseOrdinary(pieceOf(run.text)));
  const hyphenator = body.hyphenate ? input.hyphenator : null;
  const plain = variantOf(block, collapsed.map((piece) => ({ ...piece })), roman, measurer, hyphenator);

  let capped: ParagraphVariant | null = null;
  let dropCap: DropCapPlan | null = null;
  let capSource: CapSource | null = null;
  const spec = body.dropCap;
  if (input.dropCapAllowed && spec !== null) {
    const split = takeDropCap(collapsed);
    if (split !== null) {
      const first = block.runs[split.run];
      capSource = {
        text: split.cap.text,
        run: split.run,
        span: spanOf(split.cap, 0, split.cap.text.length) ?? { start: 0, end: 0 },
        family: spec.family ?? body.family,
        weight: spec.weight ?? body.weight,
      };
      if (first?.href !== undefined) capSource.href = first.href;
      dropCap = dropCapAt(capSource, Math.max(1, Math.round(spec.lines)), grid, measurer);
      capped = variantOf(block, split.rest, roman, measurer, hyphenator);
    }
  }

  return { id: block.id, role: 'body', font: roman, rows: 1, plain, capped, dropCap, capSource, variant: 'plain' };
}

/** Word gaps of a line: U+0020 and U+00A0 inside its fragments (the characters CSS `word-spacing`
 *  stretches), plus fragments that start after a gap (C11). */
export function gapCount(line: MeasuredLine): number {
  let count = 0;
  for (const fragment of line.fragments) {
    count += (fragment.text.match(/[ \u00A0]/g) ?? []).length;
    if (fragment.gapBefore > 0) count += 1;
  }
  return count;
}

/** True when nothing follows the line in its paragraph (B8: asked of the measurer, never by laying
 *  the remainder out). */
export function isLastLine(measurer: Measurer, prepared: PreparedParagraph, line: MeasuredLine): boolean {
  return measurer.atEnd(prepared, line.end);
}

const LAST_PROBE_WIDTH = 1e7;

/**
 * The line that starts at `cursor` in a slot of `slot` px. With `squeeze` (justified body text) a
 * squeezed candidate is also tried; it wins when it is admissible, is not the paragraph's last line,
 * and costs less per gap than stretching the natural line.
 */
export function chooseLine(
  measurer: Measurer,
  prepared: PreparedParagraph,
  slot: number,
  cursor: LineCursor | undefined,
  body: BodySpec,
  size: number,
  squeeze: boolean,
): MeasuredLine | null {
  const natural = measurer.nextLine(prepared, slot, cursor);
  if (natural === null || !squeeze || !body.justify || body.maxShrink <= 0) return natural;

  const gapsA = gapCount(natural);
  const shrinkRoom = body.maxShrink * size;
  const squeezed = measurer.nextLine(prepared, slot + shrinkRoom * (gapsA + 1), cursor);
  if (squeezed === null) return natural;
  const gapsB = gapCount(squeezed);
  const admissible =
    squeezed.width > slot && squeezed.width - slot <= shrinkRoom * gapsB && !isLastLine(measurer, prepared, squeezed);
  if (!admissible) return natural;

  const squeezeCost = (squeezed.width - slot) / (gapsB * shrinkRoom);
  const stretchRoom = body.maxStretch * size * Math.max(gapsA, 1);
  const stretchCost = stretchRoom > 0 ? (slot - natural.width) / stretchRoom : Infinity;
  return squeezeCost < stretchCost ? squeezed : natural;
}

/** Word spacing that makes a line fill its slot, and whether it is within the stretch or shrink
 *  limits. A last line, a line without gaps, or a spec without justification is never justified. */
export function justify(
  line: MeasuredLine,
  slot: number,
  body: BodySpec,
  size: number,
  gaps: number,
  last: boolean,
  enabled: boolean,
): { wordSpacing: number; justified: boolean } {
  if (!enabled || last || gaps <= 0) return { wordSpacing: 0, justified: false };
  const extra = slot - line.width;
  const perGap = extra / gaps;
  const within = extra >= 0 ? perGap <= body.maxStretch * size : -perGap <= body.maxShrink * size;
  return within ? { wordSpacing: perGap, justified: true } : { wordSpacing: 0, justified: false };
}

/** Fragments of a measured line: positions before word spacing, the font each is painted in, its
 *  run, and its source span (C3). */
export function placedFragments(line: MeasuredLine, variant: ParagraphVariant, base: FontSpec): PlacedFragment[] {
  let x = 0;
  return line.fragments.map((fragment) => {
    x += fragment.gapBefore;
    const run = variant.runs[fragment.itemIndex];
    const piece = variant.pieces[fragment.itemIndex];
    const span = piece !== undefined ? spanOf(piece, fragment.sourceStart, fragment.sourceEnd) : null;
    const font = run !== undefined ? variantFont(base, run) : base;
    const placed: PlacedFragment = {
      text: fragment.text,
      x,
      width: fragment.width,
      gapBefore: fragment.gapBefore,
      font,
      em: run?.em === true,
      strong: run?.strong === true,
      run: fragment.itemIndex,
      start: span?.start ?? 0,
      end: span?.end ?? 0,
    };
    if (run?.href !== undefined) placed.href = run.href;
    x += fragment.width;
    return placed;
  });
}

/** Keeps the concatenation helper in use for object text (fit): the pieces of several runs. */
export function joinPieces(pieces: Piece[]): Piece {
  return concatOf(pieces);
}
