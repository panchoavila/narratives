// editorial/placement.ts — where things go on a page. Owns the free interval of a text row (the
// obstacles of its column removed), the rect a placed object takes from its placement rule, and the
// row-by-row slide that clears an object of the boxes already on the page. Pure: the only
// measurement is the fit of a text object, asked of the Measurer through the flow's memoised fit.

import type {
  BodyGrid,
  FittedLine,
  FittedText,
  FitMode,
  MediaObjectBlock,
  Measurer,
  Placement,
  Rect,
  RoleRule,
  Size,
  TextObjectBlock,
  TypeStyle,
} from './types';

/** A caption that follows a media block and is set with it (E4): its block, its index in the
 *  document, and the type and fit of the caption role. */
export interface CaptionSpec {
  block: TextObjectBlock;
  index: number;
  style: TypeStyle;
  fit: FitMode;
}

/** A caption fitted to its media's width: its lines and the height it takes, in whole lines. */
export interface CaptionUnit {
  lines: FittedLine[];
  height: number;
  clipped: boolean;
}

/** Fits a text object's runs into a box. The flow memoises it per object, width and height. */
export type FitFn = (block: TextObjectBlock, style: TypeStyle, fit: FitMode, width: number, maxHeight: number) => FittedText;

/** Horizontal extent of the columns an object spans, in flow px. */
export interface Span {
  left: number;
  right: number;
}

/** A box already on the page. `rect` is the box itself; the clearance inflates it vertically and
 *  `span` is the column span it claims. Objects collide when their spans share a column and their
 *  inflated vertical extents overlap, so a halo never reaches a column the object does not use. */
export interface Obstacle {
  rect: Rect;
  clearancePx: number;
  span: Span;
  /** The placed object this obstacle belongs to, so a rewind can take it back. */
  owner: unknown;
}

/** A horizontal run of a row that text may use. */
export interface Interval {
  x: number;
  width: number;
}

export interface FrameContext {
  grid: BodyGrid;
  viewport: Size;
  frames: Rect[];
  measurer: Measurer;
  style: TypeStyle;
  fit: FitFn;
}

export interface Anchor {
  /** Column an `anchor` column rule resolves to. */
  column: number;
  /** Vertical rule to use for this placement. */
  vertical: Placement['vertical'];
  /** Top of the anchor row, flow px. Used by the `anchor` vertical rule. */
  top: number;
}

export interface ResolvedObject {
  rect: Rect;
  clearancePx: number;
  span: Span;
  lines?: FittedLine[];
  clipped: boolean;
  /** A bounded `fill` object: its height is set once its final y is known (see `settleObject`). */
  fill?: { from: number; maxHeight: number };
  /** The caption set under this media, when it has one (E4). Its height is part of the unit. */
  caption?: { spec: CaptionSpec; unit: CaptionUnit };
}

export interface SettledObject {
  rect: Rect;
  lines?: FittedLine[];
  clipped: boolean;
  /** The caption directly under the media, at its width (E4). */
  caption?: { spec: CaptionSpec; rect: Rect; lines: FittedLine[]; clipped: boolean };
}

/** Aspect used when a media block is given a text height rule, which it cannot honour. */
const MEDIA_FALLBACK_RATIO = 1.5;
/** A fill object needs at least this many lines below its top. */
const FILL_MIN_LINES = 2;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Rounds a height up to whole lines, never below one line. */
function linesUp(px: number, lh: number): number {
  return Math.max(lh, Math.ceil(px / lh - 1e-9) * lh);
}

/**
 * The widest interval of a column that a text row may use. An obstacle takes part only when its
 * inflated vertical extent overlaps the row band and its box overlaps the column's x-range at all.
 * Returns null when the widest interval is narrower than `minSlot`.
 */
export function freeSlot(
  bandTop: number,
  bandHeight: number,
  column: Rect,
  obstacles: readonly Obstacle[],
  minSlot: number,
): Interval | null {
  const bandBottom = bandTop + bandHeight;
  const colLeft = column.x;
  const colRight = column.x + column.width;
  const blocked: Array<[number, number]> = [];
  for (const ob of obstacles) {
    const top = ob.rect.y - ob.clearancePx;
    const bottom = ob.rect.y + ob.rect.height + ob.clearancePx;
    if (!(top < bandBottom && bottom > bandTop)) continue;
    const left = ob.rect.x;
    const right = ob.rect.x + ob.rect.width;
    if (!(left < colRight && right > colLeft)) continue;
    blocked.push([left - ob.clearancePx, right + ob.clearancePx]);
  }
  blocked.sort((a, b) => a[0] - b[0]);

  const gaps: Array<[number, number]> = [];
  let cursor = colLeft;
  for (const [start, end] of blocked) {
    if (start > cursor) gaps.push([cursor, Math.min(start, colRight)]);
    cursor = Math.max(cursor, end);
    if (cursor >= colRight) break;
  }
  if (cursor < colRight) gaps.push([cursor, colRight]);

  let best: Interval | null = null;
  for (const [start, end] of gaps) {
    const x = Math.ceil(start);
    const width = Math.floor(end) - x;
    if (width > 0 && (best === null || width > best.width)) best = { x, width };
  }
  if (best === null || best.width < minSlot) return null;
  return best;
}

/** Rect, clearance, span and fitted lines of an object from its block and rule, before any slide.
 *  A bounded `fill` object is returned with `fill` set: its height follows its final y. */
export function resolveObject(
  block: TextObjectBlock | MediaObjectBlock,
  rule: RoleRule,
  ctx: FrameContext,
  anchor: Anchor,
  caption?: CaptionSpec,
): ResolvedObject {
  const { grid, frames, viewport, style } = ctx;
  const lh = grid.lineHeight;
  const cols = frames.length;
  const place = rule.place;

  let start = place.column === 'anchor' ? anchor.column : place.column;
  if (start < 0) start += cols;
  start = clamp(Math.trunc(start), 0, cols - 1);
  const span = place.span === 'all' ? cols - start : clamp(Math.trunc(place.span), 1, cols - start);

  const fullX = frames[start].x;
  const fullWidth = frames[start + span - 1].x + grid.columnWidth - fullX;
  let x = fullX;
  let width = fullWidth;
  if (place.inset) {
    width = Math.round(fullWidth * clamp(place.inset.fraction, 0.2, 1));
    x = place.inset.side === 'start' ? fullX : fullX + fullWidth - width;
  }
  const columnSpan: Span = { left: fullX, right: fullX + fullWidth };

  const frame = frames[start];
  const frameTop = frame.y;
  const bounded = Number.isFinite(frame.height);
  const frameHeight = bounded ? frame.height : viewport.height;
  const frameBottom = bounded ? frameTop + frame.height : Infinity;
  const vertical = anchor.vertical;
  const top = vertical === 'anchor' || !bounded ? anchor.top : frameTop;
  const clearancePx = Math.max(0, place.clearance) * lh;
  const maxFraction = clamp(rule.maxHeight ?? 1, 0.05, 1);
  const maxHeight = Math.max(lh, Math.floor((maxFraction * frameHeight) / lh + 1e-9) * lh);

  // E4: a media block's caption is fitted to the media's width first; its height is part of the unit,
  // so the media itself may take at most what is left of the unit's maximum.
  // The caption keeps at most the unit's budget less one line for the picture, and never less than a line,
  // so a unit always fits a frame of four lines and cannot be carried forever.
  let unit: CaptionUnit | undefined;
  if (caption !== undefined && block.kind === 'media-object') {
    const capMax = Math.max(lh, Math.floor((maxHeight - lh) / lh + 1e-9) * lh);
    const fitted = ctx.fit(caption.block, caption.style, caption.fit, width, capMax);
    const wanted = linesUp(fitted.height, lh);
    unit = { lines: fitted.lines, height: Math.min(wanted, capMax), clipped: fitted.clipped || wanted > capMax };
  }
  const mediaMax = unit !== undefined ? Math.max(lh, maxHeight - unit.height) : maxHeight;
  const withCaption = (out: ResolvedObject): ResolvedObject => {
    if (unit !== undefined && caption !== undefined) out.caption = { spec: caption, unit };
    return out;
  };

  // A2: a bounded fill keeps its top; its height is set after the slide. On an unbounded page it is
  // the aspect (media) or the text's own height.
  if (rule.height.kind === 'fill' && bounded) {
    const fillFrom = vertical === 'anchor' ? anchor.top : frameTop;
    return withCaption({
      rect: { x, y: fillFrom, width, height: 0 },
      clearancePx,
      span: columnSpan,
      clipped: false,
      fill: { from: fillFrom, maxHeight: mediaMax },
    });
  }
  let heightRule = rule.height;
  if (rule.height.kind === 'fill') {
    heightRule = block.kind === 'media-object' ? { kind: 'aspect', ratio: block.aspect ?? MEDIA_FALLBACK_RATIO } : { kind: 'text' };
  }

  let boxHeight: number | null = null;
  if (heightRule.kind === 'aspect') {
    const declared = block.kind === 'media-object' ? block.aspect : undefined;
    const ratio = declared !== undefined && declared > 0 ? declared : heightRule.ratio > 0 ? heightRule.ratio : MEDIA_FALLBACK_RATIO;
    boxHeight = width / ratio;
  } else if (heightRule.kind === 'lines') {
    boxHeight = heightRule.lines * lh;
  } else if (block.kind === 'media-object') {
    boxHeight = width / MEDIA_FALLBACK_RATIO;
  }

  let height: number;
  let lines: FittedLine[] | undefined;
  let clipped = false;
  if (block.kind === 'text-object') {
    if (boxHeight === null) {
      const fitted = ctx.fit(block, style, rule.fit, width, maxHeight);
      lines = fitted.lines;
      clipped = fitted.clipped;
      height = linesUp(fitted.height, lh);
    } else {
      const wanted = linesUp(boxHeight, lh);
      height = Math.min(wanted, maxHeight);
      const fitted = ctx.fit(block, style, rule.fit, width, height);
      lines = fitted.lines;
      clipped = fitted.clipped || wanted > maxHeight;
    }
  } else {
    height = linesUp(boxHeight ?? 0, lh);
  }
  if (height > mediaMax) {
    height = mediaMax;
    clipped = true;
  }

  let y: number;
  if (vertical === 'top') y = frameTop;
  else if (vertical === 'anchor' || !bounded) y = anchor.top;
  else if (vertical === 'bottom') y = frameBottom - height;
  else y = frameTop + Math.floor((frameHeight - height) / 2 / lh) * lh;

  const resolved: ResolvedObject = { rect: { x, y, width, height }, clearancePx, span: columnSpan, clipped };
  if (lines !== undefined) resolved.lines = lines;
  return withCaption(resolved);
}

/** The caption of a settled media, directly under the media's box at its width (E4). */
function captionBelow(caption: NonNullable<ResolvedObject['caption']>, rect: Rect): NonNullable<SettledObject['caption']> {
  return {
    spec: caption.spec,
    rect: { x: rect.x, y: rect.y + rect.height, width: rect.width, height: caption.unit.height },
    lines: caption.unit.lines,
    clipped: caption.unit.clipped,
  };
}

/** Two objects collide when they share a column and their inflated vertical extents overlap. */
function collides(rect: Rect, clearance: number, span: Span, obstacles: readonly Obstacle[]): boolean {
  const y0 = rect.y - clearance;
  const y1 = rect.y + rect.height + clearance;
  for (const ob of obstacles) {
    if (!(span.left < ob.span.right && ob.span.left < span.right)) continue;
    const oy0 = ob.rect.y - ob.clearancePx;
    const oy1 = ob.rect.y + ob.rect.height + ob.clearancePx;
    if (y0 < oy1 && oy0 < y1) return true;
  }
  return false;
}

/**
 * Slides a resolved object, one line at a time, until it clears the obstacles, then finishes it.
 * A fill object takes the height left from its final y to the frame bottom (capped by its maximum)
 * and is carried when fewer than two lines remain. Returns null when no place exists in the frame.
 */
export function settleObject(
  block: TextObjectBlock | MediaObjectBlock,
  rule: RoleRule,
  ctx: FrameContext,
  resolved: ResolvedObject,
  step: 'up' | 'down',
  obstacles: readonly Obstacle[],
  frameTop: number,
  frameBottom: number,
  lh: number,
): SettledObject | null {
  // A unit is a media box and the caption under it: its height is both must fit.
  const captionHeight = resolved.caption?.unit.height ?? 0;
  if (resolved.fill === undefined) {
    const unit: Rect = { ...resolved.rect, height: resolved.rect.height + captionHeight };
    const spot = clearSpot(unit, resolved.clearancePx, resolved.span, obstacles, frameTop, frameBottom, step, lh);
    if (spot === null) return null;
    const rect = { ...resolved.rect, y: spot };
    const settled: SettledObject = { rect, clipped: resolved.clipped };
    if (resolved.lines !== undefined) settled.lines = resolved.lines;
    if (resolved.caption !== undefined) settled.caption = captionBelow(resolved.caption, rect);
    return settled;
  }

  const minHeight = FILL_MIN_LINES * lh;
  for (let y = resolved.fill.from; y + minHeight + captionHeight <= frameBottom; y += lh) {
    const height = Math.min(frameBottom - y - captionHeight, resolved.fill.maxHeight);
    const rect: Rect = { x: resolved.rect.x, y, width: resolved.rect.width, height };
    if (collides({ ...rect, height: height + captionHeight }, resolved.clearancePx, resolved.span, obstacles)) continue;
    if (block.kind === 'media-object') {
      const settled: SettledObject = { rect, clipped: false };
      if (resolved.caption !== undefined) settled.caption = captionBelow(resolved.caption, rect);
      return settled;
    }
    const fitted = ctx.fit(block, ctx.style, rule.fit, rect.width, height);
    return { rect, lines: fitted.lines, clipped: fitted.clipped };
  }
  return null;
}

/**
 * The first top edge, stepping one line at a time from `rect.y` in `step` direction, at which the
 * object clears every obstacle and stays inside the frame. Null when no such edge exists inside the
 * frame, so the object must be carried to the next page.
 */
export function clearSpot(
  rect: Rect,
  clearancePx: number,
  span: Span,
  obstacles: readonly Obstacle[],
  frameTop: number,
  frameBottom: number,
  step: 'up' | 'down',
  lh: number,
): number | null {
  let y = rect.y;
  for (let guard = 0; guard < 100000; guard += 1) {
    if (y < frameTop || y + rect.height > frameBottom) return null;
    const probe: Rect = { x: rect.x, y, width: rect.width, height: rect.height };
    if (!collides(probe, clearancePx, span, obstacles)) return y;
    y += step === 'down' ? lh : -lh;
  }
  return null;
}
