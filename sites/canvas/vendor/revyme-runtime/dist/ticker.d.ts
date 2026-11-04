/**
 * RevymeTicker — the Ticker effect on a layout frame (an infinite marquee).
 *
 * The editor applies it by wrapping ONE layout frame:
 *
 *   <RevymeTicker speed={80} hoverSpeed={0.5} direction="left" draggable fade={48}>
 *     <motion.div data-id="logos" style={{ display: 'flex', gap: '24px', … }}>
 *       <img data-id="logo-1" … />
 *       <img data-id="logo-2" … />
 *     </motion.div>
 *   </RevymeTicker>
 *
 * The frame keeps its own JSX and its own layout: its children are the items,
 * laid out by the frame's flex direction / gap / padding / alignment exactly
 * as on the canvas (including its `@media` rules). Nothing is connected and
 * nothing is duplicated in the source. At runtime the ticker:
 *
 *  - renders a `<style>` marker as the frame's first child. Its rules keep
 *    every item at full size (`flex-shrink: 0`), keep the row on one line from
 *    the start, clip at the frame edge, fade the edges, and move every item by
 *    one shared offset (`translate`, which composes with an item's own
 *    `transform`). A `<style>` element has no box, so the flex layout and gap
 *    are untouched.
 *  - appends the MINIMUM number of copies of the items needed for a seamless
 *    loop (the frame size over one set, plus two), after mount only, so the
 *    server HTML and the first client render match. Copies are real React
 *    mounts (links, buttons and component state work in them), hidden from
 *    screen readers and taken out of the Tab order.
 *  - moves along the frame's own main axis (row → horizontal, column →
 *    vertical): `direction` picks the sign, so `left` on a column frame scrolls
 *    up. Right-to-left rows reverse the loop space automatically.
 *  - `speed` is px/s; `hoverSpeed` multiplies it while the pointer is over the
 *    frame (0 pauses, eased in and out); keyboard focus inside pauses it;
 *    `draggable` lets visitors grab and fling it; it stops when off-screen and
 *    honours `prefers-reduced-motion` (no automatic motion; drag still works).
 *  - per breakpoint / per variant: `responsive` overrides speed, hoverSpeed,
 *    draggable and fade (and `disabled`, which turns the ticker off) for one
 *    `{ query }` media band or `{ variant }` — first match wins, like
 *    RevymeSplitText. Media-scoped fade, cursor and on/off are written as
 *    `@media` rules in the marker, so the server HTML is right at every width
 *    and hydration matches; speed and dragging follow `matchMedia` live.
 *
 * The editor canvas never runs it (the parser looks through the wrapper and
 * the canvas draws the frame still); preview and the live site do.
 */
import { type ReactNode } from 'react';
export type TickerDirection = 'left' | 'right' | 'up' | 'down';
export interface RevymeTickerProps {
    /** Pixels per second. 0 = no automatic motion. Default 80. */
    speed?: number;
    /** Speed multiplier while hovered: 1 = unchanged, 0.5 = half, 0 = pause. Default 1. */
    hoverSpeed?: number;
    /** Which way the items travel. Left/up and right/down are the same sign on
     *  a row / column frame. Default `left`. */
    direction?: TickerDirection;
    /** Visitors can drag (and fling) the ticker. Default false. */
    draggable?: boolean;
    /** Width in px of the fade at both edges. 0 = no fade. Default 0. */
    fade?: number;
    /** Off: the frame renders as a plain layout, nothing moves. A `responsive`
     *  entry can turn it on (or off) for one breakpoint / variant. Default false. */
    disabled?: boolean;
    /** Per-breakpoint / per-variant overrides. First match wins. */
    responsive?: TickerOverride[];
    /** The component's active variant — only needed for `{ variant }` scopes. */
    variant?: string;
    /** The ONE layout frame whose children scroll. */
    children?: ReactNode;
}
export type TickerScope = {
    query: string;
} | {
    variant: string;
};
export interface TickerOverride {
    scope: TickerScope;
    speed?: number;
    hoverSpeed?: number;
    draggable?: boolean;
    fade?: number;
    disabled?: boolean;
}
export declare function RevymeTicker({ speed, hoverSpeed, direction, draggable, fade, disabled, responsive, variant, children, }: RevymeTickerProps): import("react/jsx-runtime").JSX.Element;
