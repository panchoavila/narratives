// editorial/fit.ts — sets one text object (headline, deck, quote, caption and the like) inside a box.
// Owns the five fit modes: `none` wraps at one size; `width` and `lines` choose sizes so the text
// fills the box width, the first with one shared size and the second with one size per line;
// `tracking` stretches each forced line with letter spacing; `box` searches the largest size whose
// wrapped text fits the box height. Pure: every width is asked of the Measurer, so the sizes returned
// here are the sizes that get painted.

import { makeFont } from './font';
import { collapseOrdinary, concatOf, pieceOf, spanOf, upperCase, type Piece } from './source';
import type {
  FittedLine,
  FittedText,
  FitMode,
  FontSpec,
  InlineRun,
  LineCursor,
  MeasuredLine,
  Measurer,
  TypeStyle,
} from './types';

/** Size at which candidate line widths are compared. Every width is linear in size, so one
 *  measurement per line serves every size. */
const REFERENCE_SIZE = 100;
/** Largest box width honoured; a wider box is treated as this, so every result stays finite. */
const MAX_BOX_WIDTH = 1e7;
/** Font size used when a scale is not finite, so that no search is unbounded. */
const MAX_FONT_SIZE = 1024;

interface Context {
  style: TypeStyle;
  bodySize: number;
  measurer: Measurer;
  width: number;
  maxHeight: number;
  text: string;
  /** The built text with its source map (E5): every line's offsets come from here. */
  piece: Piece;
}

/** A span of the built text, in its code units. */
interface Range {
  from: number;
  to: number;
}

/** One way of breaking the text: its lines, each line's natural width at REFERENCE_SIZE and its span. */
interface Candidate {
  lines: string[];
  widths: number[];
  spans: Range[];
}

interface Row extends Range {
  text: string;
  width: number;
  size: number;
  letterSpacing?: number;
}

interface Wrapped extends Range {
  text: string;
  width: number;
}

export function fitText(
  runs: InlineRun[],
  rawStyle: TypeStyle,
  rawFit: FitMode,
  box: { width: number; maxHeight: number },
  bodySize: number,
  measurer: Measurer,
): FittedText {
  const style = sanitizeStyle(rawStyle);
  const fit = sanitizeFit(rawFit);
  const width = sanitizeWidth(box.width);
  const maxHeight = sanitizeHeight(box.maxHeight);
  const built = buildPiece(runs, style.uppercase === true);
  const text = built.text;
  if (text === '') return { lines: [], width, height: 0, clipped: false };

  const ctx: Context = { style, bodySize: finiteOr(bodySize, 1), measurer, width, maxHeight, text, piece: built };
  let result: FittedText;
  switch (fit.kind) {
    case 'none':
      result = fitNone(ctx);
      break;
    case 'width':
      result = fitWidth(ctx, fit.lines, fit.maxLines, fit.maxScale);
      break;
    case 'lines':
      result = fitLines(ctx, fit.lines, fit.maxLines, fit.maxScale);
      break;
    case 'tracking':
      result = fitTracking(ctx);
      break;
    case 'box':
      result = fitBox(ctx, fit.minScale, fit.maxScale);
      break;
  }
  return withBaselines(result, measurer);
}

// ─── Sanitising and baselines (B7, B12) ──────────────────────────────────────────────────────────

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function within(value: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

/** Every number of a style, clamped to its range (C2). */
function sanitizeStyle(style: TypeStyle): TypeStyle {
  const out: TypeStyle = {
    ...style,
    scale: within(style.scale, 0.1, 100, 1),
    leading: within(style.leading, 0.5, 4, 1),
  };
  if (style.tracking !== undefined) out.tracking = within(style.tracking, -0.2, 2, 0);
  return out;
}

/** Every number of a fit mode, clamped to its range (C2). `maxLines` is at most 8 (C8). */
function sanitizeFit(fit: FitMode): FitMode {
  switch (fit.kind) {
    case 'width':
    case 'lines': {
      const lines = typeof fit.lines === 'number' ? Math.round(within(fit.lines, 1, 200, 1)) : fit.lines;
      return {
        ...fit,
        lines,
        maxLines: Math.round(within(fit.maxLines, 1, 8, 1)),
        maxScale: within(fit.maxScale, 0.1, 100, 1),
      };
    }
    case 'box': {
      const maxScale = within(fit.maxScale, 0.1, 100, 1);
      const minScale = Math.min(maxScale, within(fit.minScale, 0.1, 100, 1));
      return { ...fit, minScale, maxScale };
    }
    default:
      return fit;
  }
}

/** The baseline of a line of height `h` in a font: centred on the font's ascent and descent. */
export function baselineIn(measurer: Measurer, font: FontSpec, height: number): number {
  const m = measurer.metrics(font);
  return (height - (m.ascent + m.descent)) / 2 + m.ascent;
}

/** Source offsets of a line that paints the built text from `from` to `to` (E5): read through the
 *  piece's map, never searched for. */
function sourceOf(piece: Piece, range: Range): { start: number; end: number } {
  return spanOf(piece, range.from, range.to) ?? { start: 0, end: 0 };
}

function withBaselines(result: FittedText, measurer: Measurer): FittedText {
  return {
    ...result,
    lines: result.lines.map((line) => ({ ...line, baseline: baselineIn(measurer, line.font, line.height) })),
  };
}

// ─── Text ────────────────────────────────────────────────────────────────────────────────────────

/** A font size no larger than the box it is set in (E8c), and at least one pixel. */
function sizeWithin(size: number, width: number): number {
  return Math.max(1, Math.min(size, Math.floor(Math.max(1, width))));
}

function sanitizeWidth(value: number): number {
  return Number.isNaN(value) ? 0 : Math.min(Math.max(0, value), MAX_BOX_WIDTH);
}

function sanitizeHeight(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, value);
}

/** Runs joined as written; whitespace collapsed to one space (non-breaking spaces kept); spaces next
 *  to a newline dropped; a newline kept as a forced break; the ends trimmed. */
/** The object's text as painted, with its source map: the runs concatenated as passed in, ordinary
 *  whitespace collapsed, upper-cased when asked, spaces beside a forced break and at the ends
 *  dropped. */
function buildPiece(runs: InlineRun[], uppercase: boolean): Piece {
  // E5: each run's source map is shifted by the length of the runs before it, so offsets are into the
  // runs' texts concatenated as passed in.
  let before = 0;
  const parts = runs.map((run) => {
    const own = pieceOf(run.text);
    const shifted: Piece = { text: own.text, src: own.src.map((s) => s + before) };
    before += run.text.length;
    return shifted;
  });
  let piece = collapseOrdinary(concatOf(parts), true);
  if (uppercase) piece = upperCase(piece);
  const keep: number[] = [];
  for (let i = 0; i < piece.text.length; i += 1) {
    const ch = piece.text.charAt(i);
    if (ch === ' ') {
      const prev = i === 0 ? '\n' : piece.text.charAt(i - 1);
      const next = i + 1 >= piece.text.length ? '\n' : piece.text.charAt(i + 1);
      if (prev === '\n' || next === '\n') continue;
    }
    keep.push(i);
  }
  let text = '';
  const src: number[] = [];
  for (const i of keep) {
    text += piece.text.charAt(i);
    src.push(piece.src[i]);
  }
  while (text.startsWith('\n')) {
    text = text.slice(1);
    src.shift();
  }
  while (text.endsWith('\n')) {
    text = text.slice(0, -1);
    src.pop();
  }
  return { text, src };
}

function forcedLines(text: string): string[] {
  return text.split('\n');
}

function graphemeCount(text: string): number {
  const SegmenterCtor = (
    Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
        segment(input: string): Iterable<unknown>;
      };
    }
  ).Segmenter;
  if (SegmenterCtor) {
    return Array.from(new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(text)).length;
  }
  return Array.from(text).length;
}

// ─── Fonts and measurement ───────────────────────────────────────────────────────────────────────

function fontFor(style: TypeStyle, size: number, letterSpacing?: number): FontSpec {
  return makeFont(style.family, style.weight, style.style, size, letterSpacing);
}

/** Tracking is em of the style's size, so in px it scales with the size. */
function trackingFor(style: TypeStyle, size: number): number | undefined {
  return style.tracking === undefined ? undefined : style.tracking * size;
}

function naturalAt(ctx: Context, text: string, size: number): number {
  return ctx.measurer.naturalWidth(text, fontFor(ctx.style, size, trackingFor(ctx.style, size)));
}

function fragmentsText(line: MeasuredLine): string {
  let text = '';
  line.fragments.forEach((fragment, index) => {
    if (index > 0 && fragment.gapBefore > 0) text += ' ';
    text += fragment.text;
  });
  return text;
}

/** Greedy wrap of one forced line at `maxWidth`. Each line consumes at least one character, so the
 *  loop is bounded by the text length. Each row's range is relative to `text`, from the fragments the
 *  measurer reports. */
function wrap(measurer: Measurer, text: string, font: FontSpec, maxWidth: number): Wrapped[] {
  if (text === '') return [{ text: '', width: 0, from: 0, to: 0 }];
  const prepared = measurer.prepare([{ text, font }]);
  const rows: Wrapped[] = [];
  let cursor: LineCursor | undefined;
  for (let guard = 0; guard <= text.length; guard++) {
    const line = measurer.nextLine(prepared, maxWidth, cursor);
    if (line === null) break;
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    for (const fragment of line.fragments) {
      from = Math.min(from, fragment.sourceStart);
      to = Math.max(to, fragment.sourceEnd);
    }
    if (!Number.isFinite(from)) from = to;
    rows.push({ text: fragmentsText(line), width: line.width, from, to });
    cursor = line.end;
  }
  if (rows.length === 0) rows.push({ text, width: measurer.naturalWidth(text, font), from: 0, to: text.length });
  return rows;
}

/** The offset of each forced line of the built text: lines are separated by one newline. */
function forcedRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let from = 0;
  for (const line of forcedLines(text)) {
    ranges.push({ from, to: from + line.length });
    from += line.length + 1;
  }
  return ranges;
}

// ─── Alignment and assembly ──────────────────────────────────────────────────────────────────────

function alignX(align: TypeStyle['align'], boxWidth: number, lineWidth: number): number {
  if (align === 'center') return (boxWidth - lineWidth) / 2;
  if (align === 'end') return boxWidth - lineWidth;
  return 0;
}

/** Stacks rows with their own sizes; each line's height is its size times the style's leading. */
function layoutRows(ctx: Context, rows: Row[]): FittedText {
  const { style, width, maxHeight, piece } = ctx;
  const lines: FittedLine[] = [];
  let y = 0;
  for (const row of rows) {
    const height = row.size * style.leading;
    lines.push({
      text: row.text,
      x: alignX(style.align, width, row.width),
      y,
      width: row.width,
      height,
      baseline: 0,
      ...sourceOf(piece, row),
      font: fontFor(style, row.size, row.letterSpacing ?? trackingFor(style, row.size)),
    });
    y += height;
  }
  return { lines, width, height: y, clipped: y > maxHeight };
}

// ─── Candidate breaks for `width` and `lines` ────────────────────────────────────────────────────

function clampInt(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(value)));
}

function lineCounts(lines: number | 'auto', maxLines: number, words: number): number[] {
  if (lines === 'auto') {
    const top = clampInt(maxLines, 1, words);
    return Array.from({ length: top }, (_, index) => index + 1);
  }
  return [clampInt(lines, 1, words)];
}

/** Splits `n` words into `k` consecutive lines so that the widest line, by `cost`, is as narrow as
 *  possible. `cost(i, j)` is the width of words i..j. Returns inclusive word ranges. */
function partitionWords(n: number, k: number, cost: (i: number, j: number) => number): Array<[number, number]> {
  // dp[t * n + j]: the least possible widest line when words 0..j form t lines.
  const dp = new Float64Array((k + 1) * n).fill(Infinity);
  const from = new Int32Array((k + 1) * n);
  for (let j = 0; j < n; j++) dp[n + j] = cost(0, j);
  for (let t = 2; t <= k; t++) {
    for (let j = t - 1; j < n; j++) {
      let best = Infinity;
      let start = t - 1;
      for (let i = t - 1; i <= j; i++) {
        const widest = Math.max(dp[(t - 1) * n + (i - 1)], cost(i, j));
        if (widest < best) {
          best = widest;
          start = i;
        }
      }
      dp[t * n + j] = best;
      from[t * n + j] = start;
    }
  }
  const ranges: Array<[number, number]> = [];
  let end = n - 1;
  for (let t = k; t >= 1; t--) {
    const start = t === 1 ? 0 : from[t * n + end];
    ranges.push([start, end]);
    end = start - 1;
  }
  return ranges.reverse();
}

/** Candidate breaks. The partition runs on prefix-sum widths, one measurement per word and one for
 *  the space (B9); each chosen line is then measured once for real, so the sizes are exact. */
function candidates(ctx: Context, lines: number | 'auto', maxLines: number): Candidate[] {
  if (ctx.text.includes('\n')) {
    const forced = forcedLines(ctx.text);
    return [
      {
        lines: forced,
        widths: forced.map((line) => (line === '' ? 0 : naturalAt(ctx, line, REFERENCE_SIZE))),
        spans: forcedRanges(ctx.text),
      },
    ];
  }

  const words = ctx.text.split(' ');
  const starts: number[] = [];
  let at = 0;
  for (const word of words) {
    starts.push(at);
    at += word.length + 1;
  }
  const n = words.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + naturalAt(ctx, words[i], REFERENCE_SIZE);
  const spaceWidth = n > 1 ? naturalAt(ctx, ' ', REFERENCE_SIZE) : 0;
  const cost = (i: number, j: number): number => prefix[j + 1] - prefix[i] + (j - i) * spaceWidth;

  return lineCounts(lines, maxLines, n).map((k) => {
    const ranges = partitionWords(n, k, cost);
    const texts = ranges.map(([i, j]) => words.slice(i, j + 1).join(' '));
    const spans = ranges.map(([i, j]) => ({ from: starts[i], to: starts[j] + words[j].length }));
    return { lines: texts, widths: texts.map((text) => naturalAt(ctx, text, REFERENCE_SIZE)), spans };
  });
}

// ─── Sizes ───────────────────────────────────────────────────────────────────────────────────────

function capFor(ctx: Context, maxScale: number): number {
  const raw = maxScale * ctx.bodySize;
  return Number.isFinite(raw) ? Math.max(0, raw) : MAX_FONT_SIZE;
}

/** The size at which a line of natural width `widest` (at REFERENCE_SIZE) fills `width`, capped. */
function sizeFor(width: number, widest: number, cap: number): number {
  return widest > 0 ? Math.min((REFERENCE_SIZE * width) / widest, cap) : cap;
}

/** The size a line of natural width `widest` (at REFERENCE_SIZE) gets to fill `width`, rounded down
 *  to two decimals and then, where rounding still left it over the box, one step lower (F16). */
function fitSize(width: number, widest: number, cap: number): number {
  let size = floor2(sizeFor(width, widest, cap));
  while (size > 0 && (widest * size) / REFERENCE_SIZE > width) size = Math.round((size - 0.01) * 100) / 100;
  return size;
}

/** Rounds down to two decimals. Rounding up could push the widest line past the box or the height
 *  past the box height; rounding down keeps both within bounds. */
function floor2(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

function maxOf(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, value), 0);
}

// ─── Modes ───────────────────────────────────────────────────────────────────────────────────────

function fitNone(ctx: Context): FittedText {
  const { style, bodySize, measurer, width, maxHeight, piece } = ctx;
  const size = sizeWithin(Math.round(style.scale * bodySize), width);
  const lineHeight = Math.round(size * style.leading);
  const font = fontFor(style, size, trackingFor(style, size));
  const lines: FittedLine[] = [];
  let y = 0;
  const ranges = forcedRanges(ctx.text);
  forcedLines(ctx.text).forEach((paragraph, index) => {
    const base = ranges[index].from;
    for (const row of wrap(measurer, paragraph, font, width)) {
      lines.push({
        text: row.text,
        x: alignX(style.align, width, row.width),
        y,
        width: row.width,
        height: lineHeight,
        baseline: 0,
        ...sourceOf(piece, { from: base + row.from, to: base + row.to }),
        font,
      });
      y += lineHeight;
    }
  });
  return { lines, width, height: y, clipped: y > maxHeight };
}

function fitWidth(ctx: Context, lines: number | 'auto', maxLines: number, maxScale: number): FittedText {
  const { style, width, maxHeight } = ctx;
  const cap = Math.min(capFor(ctx, maxScale), Math.max(1, width));
  const sized = candidates(ctx, lines, maxLines).map((candidate) => {
    const size = fitSize(width, maxOf(candidate.widths), cap);
    return { candidate, size, height: candidate.lines.length * size * style.leading };
  });

  const fitting = sized.filter((entry) => entry.height <= maxHeight);
  let pick: { candidate: Candidate; size: number };
  if (fitting.length > 0) {
    pick = fitting.reduce((best, entry) => (entry.size > best.size ? entry : best));
  } else {
    const smallest = sized.reduce((best, entry) => (entry.height < best.height ? entry : best));
    const denominator = smallest.candidate.lines.length * style.leading;
    pick = {
      candidate: smallest.candidate,
      size: floor2(denominator > 0 ? maxHeight / denominator : 0),
    };
  }

  return layoutRows(
    ctx,
    pick.candidate.lines.map((text, index) => ({
      text,
      size: pick.size,
      width: (pick.candidate.widths[index] * pick.size) / REFERENCE_SIZE,
      ...pick.candidate.spans[index],
    })),
  );
}

function fitLines(ctx: Context, lines: number | 'auto', maxLines: number, maxScale: number): FittedText {
  const { style, width, maxHeight } = ctx;
  const cap = Math.min(capFor(ctx, maxScale), Math.max(1, width));
  const sized = candidates(ctx, lines, maxLines).map((candidate) => {
    const sizes = candidate.widths.map((widest) => fitSize(width, widest, cap));
    const total = sizes.reduce((sum, size) => sum + size * style.leading, 0);
    return { candidate, sizes, total };
  });

  const fitting = sized.filter((entry) => entry.total <= maxHeight);
  let pick: { candidate: Candidate; sizes: number[] };
  if (fitting.length > 0) {
    pick = fitting.reduce((best, entry) => (entry.total > best.total ? entry : best));
  } else {
    const smallest = sized.reduce((best, entry) => (entry.total < best.total ? entry : best));
    const factor = smallest.total > 0 ? maxHeight / smallest.total : 0;
    pick = { candidate: smallest.candidate, sizes: smallest.sizes.map((size) => size * factor) };
  }

  return layoutRows(
    ctx,
    pick.candidate.lines.map((text, index) => {
      const size = pick.sizes[index];
      return { text, size, width: (pick.candidate.widths[index] * size) / REFERENCE_SIZE, ...pick.candidate.spans[index] };
    }),
  );
}

function fitTracking(ctx: Context): FittedText {
  const { style, bodySize, measurer, width } = ctx;
  const size = sizeWithin(Math.round(style.scale * bodySize), width);
  const ranges = forcedRanges(ctx.text);
  const rows: Row[] = forcedLines(ctx.text).map((paragraph, index) => {
    const range = ranges[index];
    if (paragraph === '') return { text: paragraph, width: 0, size, letterSpacing: 0, ...range };
    const natural = measurer.naturalWidth(paragraph, fontFor(style, size, 0));
    const graphemes = graphemeCount(paragraph);
    if (natural <= 0) return { text: paragraph, width: 0, size, letterSpacing: 0, ...range };
    if (graphemes > 1 && natural < width) {
      return { text: paragraph, width, size, letterSpacing: (width - natural) / (graphemes - 1), ...range };
    }
    // Too wide, or a single grapheme: the size is scaled so the line fills the box. E8(c): a size is
    // never past the box width, so a single grapheme that cannot fill the box at such a size is set at
    // that size and reports its own, narrower, width.
    const scaled = floor2((size * width) / natural);
    if (scaled <= Math.max(1, width)) return { text: paragraph, width, size: scaled, letterSpacing: 0, ...range };
    const capped = Math.max(1, Math.floor(Math.max(1, width)));
    const cappedWidth = measurer.naturalWidth(paragraph, fontFor(style, capped, 0));
    return { text: paragraph, width: cappedWidth, size: capped, letterSpacing: 0, ...range };
  });
  return layoutRows(ctx, rows);
}

function fitBox(ctx: Context, minScale: number, maxScale: number): FittedText {
  const { style, bodySize, measurer, width, maxHeight, piece } = ctx;
  const paragraphs = forcedLines(ctx.text);
  const boxCap = Math.max(1, Math.floor(Math.max(1, width)));

  const lowRaw = minScale * bodySize;
  const low = Math.min(boxCap, Number.isFinite(lowRaw) ? Math.max(1, Math.round(lowRaw)) : 1);
  const highRaw = maxScale * bodySize;
  const high = Math.max(low, Math.min(boxCap, Math.round(Number.isFinite(highRaw) ? highRaw : MAX_FONT_SIZE)));

  const measureAt = (size: number) => {
    const lineHeight = Math.round(size * style.leading);
    const font = fontFor(style, size, trackingFor(style, size));
    let count = 0;
    let widest = 0;
    for (const paragraph of paragraphs) {
      if (paragraph === '') {
        count += 1;
        continue;
      }
      const stats = measurer.lineStats(measurer.prepare([{ text: paragraph, font }]), width);
      count += stats.lineCount;
      widest = Math.max(widest, stats.maxLineWidth);
    }
    const height = count * lineHeight;
    return { lineHeight, ok: (count === 0 || height <= maxHeight) && widest <= width };
  };

  let size = low;
  let clipped = false;
  if (!measureAt(low).ok) {
    clipped = true;
  } else {
    // Largest fitting size in [low, high]; each step halves the interval.
    let a = low;
    let b = high;
    while (a < b) {
      const mid = Math.ceil((a + b) / 2);
      if (measureAt(mid).ok) a = mid;
      else b = mid - 1;
    }
    size = a;
  }

  const lineHeight = Math.round(size * style.leading);
  const font = fontFor(style, size, trackingFor(style, size));
  const lines: FittedLine[] = [];
  let y = 0;
  const ranges = forcedRanges(ctx.text);
  paragraphs.forEach((paragraph, index) => {
    for (const row of wrap(measurer, paragraph, font, width)) {
      lines.push({
        text: row.text,
        x: alignX(style.align, width, row.width),
        y,
        width: row.width,
        height: lineHeight,
        baseline: 0,
        ...sourceOf(piece, { from: ranges[index].from + row.from, to: ranges[index].from + row.to }),
        font,
      });
      y += lineHeight;
    }
  });
  return { lines, width, height: y, clipped };
}
