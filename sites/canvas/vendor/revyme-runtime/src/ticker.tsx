'use client';

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

import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useStaticCanvas } from './useStaticCanvas';
import { Override } from './code-override';

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

export type TickerScope = { query: string } | { variant: string };

export interface TickerOverride {
  scope: TickerScope;
  speed?: number;
  hoverSpeed?: number;
  draggable?: boolean;
  fade?: number;
  disabled?: boolean;
}

interface TickerValues {
  speed: number;
  hoverSpeed: number;
  draggable: boolean;
  fade: number;
  disabled: boolean;
}

const MAX_COPIES = 50;
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface Measure {
  period: number;      // px from an item to its first copy (one set + one gap)
  dir: 1 | -1;         // +1 when copies follow to the right / below, -1 for RTL rows
  axisX: boolean;
}

/** The scrolling items: every element child of the frame except the marker. */
function itemElements(host: HTMLElement, marker: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of Array.from(host.children)) if (el !== marker) out.push(el as HTMLElement);
  return out;
}

/**
 * Keep every copy set in the originals' VISUAL order. The editor writes CSS
 * `order` when items are reordered (and per breakpoint), so source order is
 * not display order. Copies are siblings in the same flex container, and
 * `order` sorts across ALL of them: every copy of an item lined up together
 * (a customer's announcement bar, 2026-10-28: "Trusted ×N, dots ×N,
 * Worldwide ×N"). Each copy gets an `order` past every original, by set then
 * by its original's rank. Read from the computed style on every measure, so
 * an `@media` reorder is followed. Returns the originals in visual order.
 */
function orderCopies(els: HTMLElement[], perSet: number): HTMLElement[] {
  const originals = els.slice(0, perSet);
  const orders = originals.map((el) => parseInt(getComputedStyle(el).order, 10) || 0);
  const visual = originals.map((_, i) => i).sort((a, b) => orders[a] - orders[b] || a - b);
  const rank = new Array<number>(perSet);
  visual.forEach((i, r) => { rank[i] = r; });
  const after = Math.max(...orders) + 1;
  for (let k = perSet; k < els.length; k++) {
    const set = Math.floor(k / perSet);
    els[k].style.setProperty('order', String(after + (set - 1) * perSet + rank[k % perSet]), 'important');
  }
  return visual.map((i) => originals[i]);
}

/** Holds a frame that hugs its content at its own size: `x` / `y` = the axis,
 *  the size is `--revyme-ticker-fit` (see the marker rules). */
const FIT_ATTR = 'data-revyme-ticker-fit';

/** The frame's main size (its CSS `width` / `height`) with and without the
 *  copies. A frame whose size comes from its content (width auto on an
 *  absolute frame, a hug flex item, fit-content) grows with every copy, so
 *  the two differ; any other frame (fixed, fill, stretch) reads the same. */
function sizeWithoutCopies(host: HTMLElement, copyEls: HTMLElement[], axisX: boolean): { own: number; withCopies: number } {
  const read = () => parseFloat(axisX ? getComputedStyle(host).width : getComputedStyle(host).height);
  host.removeAttribute(FIT_ATTR);
  const withCopies = read();
  const saved = copyEls.map((el) => [el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')] as const);
  for (const el of copyEls) el.style.setProperty('display', 'none', 'important');
  const own = read();
  copyEls.forEach((el, i) => {
    const [v, p] = saved[i];
    if (v) el.style.setProperty('display', v, p);
    else el.style.removeProperty('display');
  });
  return { own, withCopies };
}

function fadeMask(fade: number, axisX: boolean): string {
  const f = `min(${fade}px, calc(50% - 1px))`;
  return `linear-gradient(${axisX ? 'to right' : 'to bottom'}, transparent, #000 ${f}, #000 calc(100% - ${f}), transparent)`;
}

/** Base ⊕ one override's set fields. */
function applyOverride(base: TickerValues, ov: TickerOverride | undefined): TickerValues {
  if (!ov) return base;
  return {
    speed: typeof ov.speed === 'number' ? ov.speed : base.speed,
    hoverSpeed: typeof ov.hoverSpeed === 'number' ? ov.hoverSpeed : base.hoverSpeed,
    draggable: typeof ov.draggable === 'boolean' ? ov.draggable : base.draggable,
    fade: typeof ov.fade === 'number' ? ov.fade : base.fade,
    disabled: typeof ov.disabled === 'boolean' ? ov.disabled : base.disabled,
  };
}

const isQuery = (s: TickerScope | undefined): s is { query: string } =>
  !!s && typeof (s as { query?: unknown }).query === 'string';
const isVariant = (s: TickerScope | undefined): s is { variant: string } =>
  !!s && typeof (s as { variant?: unknown }).variant === 'string';

/** Index of the first override that applies now: a `{ variant }` scope by the
 *  `variant` prop, a `{ query }` scope by matchMedia (client only). -1 = base.
 *  Lazy initial read + change listeners, the same shape as RevymeSplitText. */
function useActiveOverride(entries: TickerOverride[] | undefined, variant: string | undefined): number {
  const key = JSON.stringify(entries ?? null);
  const compute = (): number => {
    if (!entries) return -1;
    for (let i = 0; i < entries.length; i++) {
      const s = entries[i]?.scope;
      if (isVariant(s)) { if (variant !== undefined && s.variant === variant) return i; }
      else if (isQuery(s) && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        if (window.matchMedia(s.query).matches) return i;
      }
    }
    return -1;
  };
  const [idx, setIdx] = useState(compute);
  useEffect(() => {
    setIdx(compute());
    if (!entries || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const lists = entries.filter((e) => isQuery(e?.scope)).map((e) => window.matchMedia((e.scope as { query: string }).query));
    const onChange = () => setIdx(compute());
    for (const l of lists) l.addEventListener('change', onChange);
    return () => { for (const l of lists) l.removeEventListener('change', onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, variant]);
  return idx;
}

/** `@media not all and (a) { … }` for every band in `queries` (nested, so a
 *  comma list in one query still excludes each of its parts). */
function outsideBands(css: string, queries: string[]): string {
  let out = css;
  for (const q of queries) {
    for (const part of q.split(',')) {
      const p = part.trim();
      if (p) out = `@media not all and ${p.startsWith('(') ? p : `(${p})`}{${out}}`;
    }
  }
  return out;
}

export function RevymeTicker({
  speed = 80,
  hoverSpeed = 1,
  direction = 'left',
  draggable = false,
  fade = 0,
  disabled = false,
  responsive,
  variant,
  children,
}: RevymeTickerProps) {
  const isStatic = useStaticCanvas();
  const uid = useId();
  const markerRef = useRef<HTMLStyleElement | null>(null);
  const [copies, setCopies] = useState(0);
  const copiesRef = useRef(0);
  copiesRef.current = copies;
  const measureRef = useRef<Measure | null>(null);
  const entries = Array.isArray(responsive) ? responsive : undefined;
  const base: TickerValues = { speed, hoverSpeed, draggable, fade, disabled };
  // What renders on the server and the first client render: the base plus a
  // `{ variant }` override (the variant is known on both). Media overrides
  // only reach the HTML as `@media` rules (see `css` below).
  const staticValues = applyOverride(base, entries?.find((e) => isVariant(e?.scope) && variant !== undefined && e.scope.variant === variant));
  // What runs now: the first override that applies at this width / variant.
  const activeIdx = useActiveOverride(entries, variant);
  const live = applyOverride(base, activeIdx >= 0 ? entries![activeIdx] : undefined);
  const propsRef = useRef({ ...live, direction });
  propsRef.current = { ...live, direction };

  // The frame, or — when the frame also has a code override, which the editor
  // writes INSIDE the ticker (`<RevymeTicker><Override><div/></Override>`) —
  // the element the override wraps.
  const outer = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<{ children?: ReactNode }>) : null;
  const viaOverride = !!outer && outer.type === Override && isValidElement(outer.props.children);
  const frame = viaOverride ? (outer!.props.children as ReactElement<{ children?: ReactNode }>) : outer;
  const items = frame ? Children.toArray(frame.props.children) : [];

  /** Measure one set and settle the number of copies. */
  const measure = () => {
    const marker = markerRef.current;
    const host = marker?.parentElement;
    if (!marker || !host) return;
    if (propsRef.current.disabled) {
      // Off at this width / variant: a plain frame — no copies, no offset.
      measureRef.current = null;
      host.style.removeProperty('--revyme-ticker-mask');
      host.removeAttribute(FIT_ATTR);
      if (copiesRef.current !== 0) setCopies(0);
      return;
    }
    const els = itemElements(host, marker);
    const sets = copiesRef.current + 1;
    const perSet = Math.round(els.length / sets);
    if (perSet === 0 || els.length !== perSet * sets) return;
    // Before any position read: copies must sit in the originals' visual order.
    const visual = orderCopies(els, perSet);
    const cs = getComputedStyle(host);
    const axisX = !cs.flexDirection.startsWith('column');
    // A frame that hugs its items keeps the size it has with the originals
    // only (its canvas size): otherwise each copy widens it, which asks for
    // more copies, until it hits its container's edge or MAX_COPIES.
    if (sets > 1) {
      const { own, withCopies } = sizeWithoutCopies(host, els.slice(perSet), axisX);
      if (withCopies > own + 0.5) {
        host.style.setProperty('--revyme-ticker-fit', `${own}px`);
        host.setAttribute(FIT_ATTR, axisX ? 'x' : 'y');
      }
    } else {
      host.removeAttribute(FIT_ATTR);
    }
    const pos = (el: HTMLElement) => (axisX ? el.offsetLeft : el.offsetTop);
    const size = (el: HTMLElement) => (axisX ? el.offsetWidth : el.offsetHeight);
    let period: number;
    let dir: 1 | -1;
    if (sets > 1) {
      const d = pos(els[perSet]) - pos(els[0]);
      period = Math.abs(d);
      dir = d < 0 ? -1 : 1;
    } else {
      // No copies yet: one set's span plus the gap that will follow it. The
      // ends are the VISUAL first and last items (`order` may move any item).
      const first = visual[0];
      const last = visual[perSet - 1];
      const start = Math.min(pos(first), pos(last));
      const end = Math.max(pos(first) + size(first), pos(last) + size(last));
      const gap = parseFloat(axisX ? cs.columnGap : cs.rowGap) || 0;
      period = end - start + gap;
      dir = pos(last) < pos(first) ? -1 : 1;
    }
    if (!(period > 0)) return;
    measureRef.current = { period, dir, axisX };
    if (propsRef.current.fade > 0) host.style.setProperty('--revyme-ticker-mask', fadeMask(propsRef.current.fade, axisX));
    else host.style.removeProperty('--revyme-ticker-mask');
    // Copies are hidden from assistive tech and the Tab order (they repeat
    // what the originals already say), but stay clickable.
    els.forEach((el, i) => {
      const copy = i >= perSet;
      if (copy) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
      if (copy) el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').forEach((f) => f.setAttribute('tabindex', '-1'));
    });
    const viewport = axisX ? host.clientWidth : host.clientHeight;
    const needed = Math.min(MAX_COPIES, Math.ceil(viewport / period) + 2);
    if (needed !== copiesRef.current) setCopies(needed);
  };

  // Measure after every render (children may have changed), before paint.
  useIsoLayoutEffect(() => {
    if (isStatic || !frame) return;
    measure();
  });

  // Re-measure when the frame or an item changes size (images loading,
  // breakpoints switching the frame's direction or gap).
  useEffect(() => {
    if (isStatic || !frame || typeof ResizeObserver === 'undefined') return;
    const marker = markerRef.current;
    const host = marker?.parentElement;
    if (!marker || !host) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    for (const el of itemElements(host, marker)) ro.observe(el);
    // A held hug frame does not resize when a breakpoint gives it another
    // width, so viewport changes re-measure too.
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  });

  // The loop. Runs once per mount and reads the latest props / measure.
  useEffect(() => {
    if (isStatic || !frame) return;
    const marker = markerRef.current;
    const host = marker?.parentElement;
    if (!marker || !host) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let last = performance.now();
    let offset = Number.NaN;       // screen px along the axis
    let factor = 1;                // eased hover multiplier
    let hovered = false;
    let focused = false;
    let visible = true;
    let boost = 0;                 // fling velocity, decays to 0
    let dragging = false;
    let dragMoved = false;
    let dragLast = 0;
    let dragLastT = 0;
    let dragV = 0;

    const write = () => {
      const m = measureRef.current;
      if (!m) return;
      // Keep the offset one to two periods back (in the copies' direction),
      // so content always covers both edges, padding included.
      const p = m.period;
      const n = offset * m.dir;
      const r = ((n % p) + p) % p;
      offset = (r - 2 * p) * m.dir;
      host.style.setProperty('--revyme-ticker-x', m.axisX ? `${offset}px` : '0px');
      host.style.setProperty('--revyme-ticker-y', m.axisX ? '0px' : `${offset}px`);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = propsRef.current;
      if (p.disabled) {
        if (!Number.isNaN(offset)) {
          offset = Number.NaN;
          boost = 0;
          host.style.removeProperty('--revyme-ticker-x');
          host.style.removeProperty('--revyme-ticker-y');
        }
        return;
      }
      const m = measureRef.current;
      if (!m || !visible) return;
      if (Number.isNaN(offset)) offset = -m.period * m.dir;
      const target = hovered ? Math.max(0, p.hoverSpeed) : 1;
      factor += (target - factor) * Math.min(1, dt * 6);
      if (dragging) return;
      const sign = p.direction === 'right' || p.direction === 'down' ? 1 : -1;
      const auto = reduced || focused ? 0 : sign * Math.max(0, p.speed) * factor;
      offset += (auto + boost) * dt;
      boost *= Math.exp(-dt * 2.5);
      if (Math.abs(boost) < 1) boost = 0;
      write();
    };
    raf = requestAnimationFrame(tick);

    const onEnter = () => { hovered = true; };
    const onLeave = () => { hovered = false; };
    // Keyboard focus only: a mouse click on a button inside must not stop it.
    const onFocusIn = (e: FocusEvent) => {
      try { focused = (e.target as Element).matches(':focus-visible'); } catch { focused = true; }
    };
    const onFocusOut = (e: FocusEvent) => { if (!host.contains(e.relatedTarget as Node | null)) focused = false; };
    host.addEventListener('pointerenter', onEnter);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);

    const axisPos = (e: PointerEvent) => (measureRef.current?.axisX === false ? e.clientY : e.clientX);
    const onDown = (e: PointerEvent) => {
      if (!propsRef.current.draggable || propsRef.current.disabled || e.button !== 0 || !measureRef.current) return;
      dragging = true;
      dragMoved = false;
      boost = 0;
      dragLast = axisPos(e);
      dragLastT = performance.now();
      dragV = 0;
      if (Number.isNaN(offset)) offset = -measureRef.current.period * measureRef.current.dir;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const x = axisPos(e);
      const now = performance.now();
      const dx = x - dragLast;
      if (Math.abs(dx) > 0) {
        if (!dragMoved && Math.abs(dx) > 3) { dragMoved = true; host.style.cursor = 'grabbing'; }
        const dtMs = Math.max(1, now - dragLastT);
        dragV = dragV * 0.6 + (dx / dtMs) * 1000 * 0.4;
        offset += dx;
        dragLast = x;
        dragLastT = now;
        write();
      }
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      host.style.cursor = '';
      // Fling: the release velocity, minus the automatic part it rides on.
      const p = propsRef.current;
      const sign = p.direction === 'right' || p.direction === 'down' ? 1 : -1;
      boost = performance.now() - dragLastT < 80 ? dragV - (reduced ? 0 : sign * p.speed * factor) : 0;
    };
    // A drag must not also click the item it started on.
    const onClick = (e: MouseEvent) => {
      if (!dragMoved) return;
      dragMoved = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDragStart = (e: DragEvent) => { if (propsRef.current.draggable && !propsRef.current.disabled) e.preventDefault(); };
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    host.addEventListener('click', onClick, true);
    host.addEventListener('dragstart', onDragStart);

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        visible = entries.some((en) => en.isIntersecting);
        last = performance.now();
      });
      io.observe(host);
    }

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
      host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('dragstart', onDragStart);
      host.style.removeProperty('--revyme-ticker-x');
      host.style.removeProperty('--revyme-ticker-y');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic, !!frame]);

  if (isStatic || !frame) return <>{children}</>;

  const sel = `style[data-revyme-ticker="${uid}"]`;
  const guessX = direction === 'left' || direction === 'right';
  // The rules for one set of values. `undo` writes the "off" side of fade /
  // drag explicitly — a media band that turns off what the base turned on.
  const rules = (v: TickerValues, undo?: TickerValues) => {
    const mask = fadeMask(v.fade, guessX);
    return `:has(> ${sel}){flex-wrap:nowrap!important;justify-content:flex-start!important;overflow:hidden!important;` +
      (v.fade > 0 ? `-webkit-mask-image:var(--revyme-ticker-mask,${mask});mask-image:var(--revyme-ticker-mask,${mask});`
        : undo && undo.fade > 0 ? '-webkit-mask-image:none;mask-image:none;' : '') +
      (v.draggable ? `cursor:grab;touch-action:${guessX ? 'pan-y' : 'pan-x'};user-select:none;`
        : undo?.draggable ? 'cursor:auto;touch-action:auto;user-select:auto;' : '') +
      `}${sel}~*{flex-shrink:0!important;translate:var(--revyme-ticker-x,0px) var(--revyme-ticker-y,0px)}`;
  };
  // Base rules everywhere except the media bands that turn the ticker off;
  // each band that changes something gets its own rules. Bands are emitted in
  // reverse so the FIRST matching override wins, as in JS.
  const bands = (entries ?? []).filter((e) => isQuery(e?.scope));
  const offBands = bands.filter((e) => applyOverride(staticValues, e).disabled).map((e) => (e.scope as { query: string }).query);
  let css = `:has(> ${sel})[${FIT_ATTR}="x"]{width:var(--revyme-ticker-fit)!important}` +
    `:has(> ${sel})[${FIT_ATTR}="y"]{height:var(--revyme-ticker-fit)!important}`;
  if (!staticValues.disabled) css += outsideBands(rules(staticValues), offBands);
  for (const e of [...bands].reverse()) {
    const v = applyOverride(staticValues, e);
    if (v.disabled) continue;
    if (!staticValues.disabled && v.fade === staticValues.fade && v.draggable === staticValues.draggable) continue;
    css += `@media ${(e.scope as { query: string }).query}{${rules(v, staticValues.disabled ? undefined : staticValues)}}`;
  }

  const marker = createElement('style', { key: '__revyme-ticker', ref: markerRef, 'data-revyme-ticker': uid }, css);
  const clones: ReactNode[] = [];
  for (let c = 1; c <= copies; c++) {
    items.forEach((item, i) => {
      clones.push(isValidElement(item) ? cloneElement(item, { key: `__rt${c}:${item.key ?? i}` }) : item);
    });
  }
  const rendered = cloneElement(frame, undefined, [marker, ...items, ...clones]);
  return viaOverride ? cloneElement(outer!, undefined, rendered) : rendered;
}
