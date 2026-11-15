import type { BodyGrid, FittedLine, FittedText, FitMode, MediaObjectBlock, Measurer, Placement, Rect, RoleRule, Size, TextObjectBlock, TypeStyle } from './types';
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
    fill?: {
        from: number;
        maxHeight: number;
    };
    /** The caption set under this media, when it has one (E4). Its height is part of the unit. */
    caption?: {
        spec: CaptionSpec;
        unit: CaptionUnit;
    };
}
export interface SettledObject {
    rect: Rect;
    lines?: FittedLine[];
    clipped: boolean;
    /** The caption directly under the media, at its width (E4). */
    caption?: {
        spec: CaptionSpec;
        rect: Rect;
        lines: FittedLine[];
        clipped: boolean;
    };
}
/**
 * The widest interval of a column that a text row may use. An obstacle takes part only when its
 * inflated vertical extent overlaps the row band and its box overlaps the column's x-range at all.
 * Returns null when the widest interval is narrower than `minSlot`.
 */
export declare function freeSlot(bandTop: number, bandHeight: number, column: Rect, obstacles: readonly Obstacle[], minSlot: number): Interval | null;
/** Rect, clearance, span and fitted lines of an object from its block and rule, before any slide.
 *  A bounded `fill` object is returned with `fill` set: its height follows its final y. */
export declare function resolveObject(block: TextObjectBlock | MediaObjectBlock, rule: RoleRule, ctx: FrameContext, anchor: Anchor, caption?: CaptionSpec): ResolvedObject;
/**
 * Slides a resolved object, one line at a time, until it clears the obstacles, then finishes it.
 * A fill object takes the height left from its final y to the frame bottom (capped by its maximum)
 * and is carried when fewer than two lines remain. Returns null when no place exists in the frame.
 */
export declare function settleObject(block: TextObjectBlock | MediaObjectBlock, rule: RoleRule, ctx: FrameContext, resolved: ResolvedObject, step: 'up' | 'down', obstacles: readonly Obstacle[], frameTop: number, frameBottom: number, lh: number): SettledObject | null;
/**
 * The first top edge, stepping one line at a time from `rect.y` in `step` direction, at which the
 * object clears every obstacle and stays inside the frame. Null when no such edge exists inside the
 * frame, so the object must be carried to the next page.
 */
export declare function clearSpot(rect: Rect, clearancePx: number, span: Span, obstacles: readonly Obstacle[], frameTop: number, frameBottom: number, step: 'up' | 'down', lh: number): number | null;
