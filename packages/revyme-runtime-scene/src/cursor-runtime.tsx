'use client';

import { useEffect, useRef, useSyncExternalStore, type ComponentType } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';

export type CursorMode = 'follow' | 'replace';
export type CursorSide = 'top' | 'bottom' | 'left' | 'right';
export type CursorAlign = 'start' | 'center' | 'end';

export interface CursorTransition {
  type?: 'spring' | 'tween' | 'instant';
  stiffness?: number;
  damping?: number;
  mass?: number;
  duration?: number;
  ease?: string;
}

export interface CursorOpts<P = any> {
  variant?: string;
  mode?: CursorMode;
  /**
   * Which side of the mouse the cursor wrapper anchors to (Follow mode).
   * Replace mode ignores side / align / offset — it auto-centers on the mouse.
   */
  side?: CursorSide;
  /**
   * Alignment along the perpendicular axis to `side`.
   * top/bottom: start = left, center = horizontal center, end = right.
   * left/right: start = top,  center = vertical center,   end = bottom.
   */
  align?: CursorAlign;
  offsetX?: number;
  offsetY?: number;
  transition?: CursorTransition;
  props?: Partial<P>;
  /**
   * Wrapper width / height applied to the cursor's outer motion.div. Useful
   * for code components (canvases, sparks) that fill their parent — without
   * this they'd render at their intrinsic size, which is often the whole
   * viewport. Plain numbers are interpreted as px; pass a string ('100%',
   * '4rem') to use other CSS units.
   */
  width?: number | string;
  height?: number | string;
  /**
   * When true, fade/scale on enter and exit via AnimatePresence. Default
   * false: appear and disappear instantly. The follow movement is always
   * smoothed by the spring config above — `enterExit` only controls the
   * mount/unmount transition.
   */
  enterExit?: boolean;
}

interface ActiveCursor {
  key: number;
  Component: ComponentType<any>;
  opts: CursorOpts;
}

// ─── Global store (vanilla, no React) ───────────────────────────────────────
let _active: ActiveCursor | null = null;
const _listeners = new Set<() => void>();

// STABLE key per cursor COMPONENT (not per enter event). The old
// `key: ++_nextKey` per mouseenter forced React to fully REMOUNT the cursor
// component on every hover transition. Cursor components are typically design
// components (LayoutGroup + layout motion nodes + variant background images),
// so scrolling with the pointer over a stack of cursor-hosting elements fired
// an enter/leave storm → remount storm → framer-motion projection re-registers
// + image repaints + forced reflows piled onto the main thread — the page
// froze for seconds (live find 2026-07-07). With a per-Component key, moving
// between hosts that share a cursor UPDATES the mounted component in place —
// the per-instance `variant` lands through `initialVariant`, which the design
// component's internal sync effect animates. A DIFFERENT component still
// remounts (key changes).
const _componentKeys = new WeakMap<ComponentType<any>, number>();
let _nextComponentKey = 0;
function _keyFor(c: ComponentType<any>): number {
  let k = _componentKeys.get(c);
  if (k === undefined) {
    k = ++_nextComponentKey;
    _componentKeys.set(c, k);
  }
  return k;
}

// Pending deactivate from a mouseleave. Scrolling re-hit-tests the pointer, so
// leave/enter alternate rapidly while the page moves under the mouse; clearing
// the cursor synchronously on every leave caused an unmount per row boundary.
// A short grace window absorbs the churn: a follow-up enter cancels the clear
// (and, same component, is a pure prop update). A REAL exit clears once, ~90ms
// later — imperceptible.
let _pendingClear: ReturnType<typeof setTimeout> | null = null;

function _setActive(next: ActiveCursor | null) {
  _active = next;
  _listeners.forEach((l) => l());
}

function _subscribe(l: () => void) {
  _listeners.add(l);
  return () => { _listeners.delete(l); };
}

function _getActive() {
  return _active;
}

/**
 * Spread the return value into an element to give it a component cursor.
 * Returns onMouseEnter/onMouseLeave handlers that push/pop the global store.
 *
 * <button {...withCursor(Pointer, { mode: 'follow', transition: { type: 'spring', stiffness: 300 } })}>
 */
export function withCursor<P>(Component: ComponentType<P>, opts: CursorOpts<P> = {}) {
  return {
    onMouseEnter: () => {
      if (_pendingClear !== null) {
        clearTimeout(_pendingClear);
        _pendingClear = null;
      }
      _setActive({ key: _keyFor(Component as ComponentType<any>), Component: Component as ComponentType<any>, opts });
    },
    onMouseLeave: () => {
      if (_pendingClear !== null) clearTimeout(_pendingClear);
      _pendingClear = setTimeout(() => {
        _pendingClear = null;
        _setActive(null);
      }, 90);
    },
  };
}

// ─── Portal (mount once in LayoutClient) ────────────────────────────────────

function _springConfig(t?: CursorTransition) {
  if (!t || t.type === 'instant') return { stiffness: 1000, damping: 50, mass: 0.1 };
  if (t.type === 'tween' && t.duration) {
    // Map a tween duration to roughly-equivalent spring values.
    const stiffness = Math.max(50, 400 / Math.max(0.1, t.duration));
    return { stiffness, damping: 30, mass: 1 };
  }
  return {
    stiffness: t.stiffness ?? 300,
    damping: t.damping ?? 30,
    mass: t.mass ?? 1,
  };
}

export function CursorPortal() {
  const cursor = useSyncExternalStore(_subscribe, _getActive, _getActive);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, _springConfig(cursor?.opts.transition));
  const sy = useSpring(y, _springConfig(cursor?.opts.transition));

  // One persistent listener; offsets read through a ref so an active-cursor
  // change never re-registers it (the old `[cursor]` dep re-added the listener
  // on every hover transition).
  const offsetRef = useRef({ x: 0, y: 0 });
  offsetRef.current = { x: cursor?.opts.offsetX ?? 0, y: cursor?.opts.offsetY ?? 0 };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      x.set(e.clientX + offsetRef.current.x);
      y.set(e.clientY + offsetRef.current.y);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [x, y]);

  // Keyed on the MODE, not the whole active object: writing
  // `document.body.style.cursor` invalidates style for the entire document,
  // and the old `[cursor]` dep re-ran the write on every hover transition —
  // one full-page style recalc per row boundary while scrolling.
  const mode = cursor?.opts.mode;
  useEffect(() => {
    if (mode === 'replace') {
      const prev = document.body.style.cursor;
      document.body.style.cursor = 'none';
      return () => { document.body.style.cursor = prev; };
    }
  }, [mode]);

  // Wrapper width/height — numbers become px, strings pass through. Falls
  // back to undefined so intrinsic sizing kicks in if the user hasn't set it.
  const wrapW = typeof cursor?.opts.width === 'number' ? cursor.opts.width + 'px' : cursor?.opts.width;
  const wrapH = typeof cursor?.opts.height === 'number' ? cursor.opts.height + 'px' : cursor?.opts.height;

  // The OUTER motion.div carries the spring x/y (mouse position). The INNER
  // div applies a percentage transform for side+align (or auto-center in
  // Replace mode). Splitting them avoids fighting with framer-motion's own
  // transform handling on the x/y motion values.
  const outerStyle = {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    x: sx,
    y: sy,
    pointerEvents: 'none' as const,
    zIndex: 9999,
  };
  const innerTransform = _innerTransform(cursor?.opts);
  const innerStyle = {
    width: wrapW,
    height: wrapH,
    transform: innerTransform,
  };

  // Default: instant in/out (no AnimatePresence wrapping). Wrap only when
  // the active cursor opts in via `enterExit: true` — keeps mount/unmount
  // snappy by default and avoids the brief fade-out from the previous cursor
  // when hovering between adjacent elements.
  // `opts.variant` → the design component's `initialVariant` prop. Without
  // this the variant picked in the editor (master call or per-instance
  // `<prop>Opts` override) was stored but NEVER applied — every hover showed
  // the cursor component's default variant (live find 2026-07-06). A fresh
  // `key` per hover means the component mounts with the right variant; its
  // internal `useEffect(() => setVariant(initialVariant), [initialVariant])`
  // covers any same-mount opts change.
  const variantProps = cursor?.opts.variant ? { initialVariant: cursor.opts.variant } : {};

  if (!cursor?.opts.enterExit) {
    return cursor ? (
      <motion.div key={cursor.key} style={outerStyle}>
        <div style={innerStyle}>
          <cursor.Component {...(cursor.opts.props ?? {})} {...variantProps} />
        </div>
      </motion.div>
    ) : null;
  }

  return (
    <AnimatePresence>
      {cursor && (
        <motion.div
          key={cursor.key}
          style={outerStyle}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
        >
          <div style={innerStyle}>
            <cursor.Component {...(cursor.opts.props ?? {})} {...variantProps} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Build the inner-wrapper transform from side + align + mode. Pure CSS
 * percentage translates so it works regardless of whether width/height are
 * set explicitly. Replace mode auto-centers; Follow mode anchors a corner /
 * edge / center based on the chosen side and alignment.
 */
function _innerTransform(opts?: CursorOpts) {
  if (!opts || opts.mode === 'replace') return 'translate(-50%, -50%)';
  const side = opts.side ?? 'bottom';
  const align = opts.align ?? 'center';
  let tx = 0;
  let ty = 0;
  if (side === 'top') ty = -100;
  else if (side === 'left') tx = -100;
  // 'bottom' and 'right' default to 0 on the main axis.
  // Align controls the perpendicular axis.
  if (side === 'top' || side === 'bottom') {
    if (align === 'center') tx = -50;
    else if (align === 'end') tx = -100;
  } else {
    if (align === 'center') ty = -50;
    else if (align === 'end') ty = -100;
  }
  return 'translate(' + tx + '%, ' + ty + '%)';
}
