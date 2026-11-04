'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, forwardRef, type ComponentType } from 'react';
import { motion, isMotionValue, MotionConfig } from 'framer-motion';
import { planVariantCopies, copiesCss } from './variant-ssr-copies';

/**
 * HOC that reads a `data-responsive` JSON prop and merges per-viewport overrides.
 * Usage: `export default withResponsiveProps(MyComponent)`
 *
 * On the canvas, CodeComponentHost injects `__canvasViewportWidth` to simulate viewport size.
 * In production, uses `window.innerWidth`.
 *
 * data-responsive='{"768":{"fontSize":32},"375":{"fontSize":24}}'
 * Breakpoints are max-width: if viewport <= 768, the 768 overrides apply.
 *
 * ANIMATED-STYLE SOCKET (Framer parity): the editor expresses instance
 * animation effects (Appear, scroll scrubs, …) as framer MotionValues bound
 * into the instance's `style` prop — `style={{ opacity: <mv>, y: <mv> }}`.
 * Design components consume them natively (their roots are motion.* and
 * spread `...style`), but a CODE component's root is a plain element: a
 * MotionValue arrives as an un-serialisable object (the style is dropped)
 * and motion-only keys like `y` aren't CSS at all — the effect silently
 * dies at the component boundary (live find 2026-07-14: Appear on a
 * Marquee). When animated values or motion-only keys are present, the HOC
 * renders a motion.div WRAPPER that carries them (plus the placement props
 * that describe the instance's slot in its parent), and hands the wrapped
 * component a clean static style. Framer does exactly this — the platform
 * owns an animatable container around every code component, so component
 * authors never deal with animation plumbing. No animated values → no
 * wrapper → byte-identical behaviour to before.
 */

/** Style keys only a motion.* element understands (translated into
 *  `transform`) — a plain DOM element ignores them entirely. */
const MOTION_ONLY_KEYS = new Set([
  'x', 'y', 'z',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'scale', 'scaleX', 'scaleY',
  'skew', 'skewX', 'skewY',
  'originX', 'originY', 'originZ',
  'transformPerspective',
]);

/** Placement props describing the instance's slot in ITS PARENT's layout —
 *  these must ride on whichever element is outermost (the wrapper, when one
 *  exists), mirroring the design-instance wrapper/root split. */
const PLACEMENT_KEYS = new Set([
  'position', 'left', 'top', 'right', 'bottom', 'inset',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'order', 'alignSelf', 'justifySelf', 'zIndex',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gridColumn', 'gridRow', 'gridArea',
]);
/** Ascending breakpoint widths out of a `data-responsive` payload. `_bp` carries
 *  the full viewport list; without it, fall back to the override keys (an older
 *  payload, or one written before every viewport had an override). */
function parseBreakpoints(responsiveStr: unknown): number[] {
  if (!responsiveStr) return [];
  try {
    const overrides = typeof responsiveStr === 'string'
      ? JSON.parse(responsiveStr) : responsiveStr;
    const all = Array.isArray(overrides._bp)
      ? overrides._bp
      : Object.keys(overrides).filter((k) => k !== '_bp').map(Number);
    return [...all].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Which breakpoint owns `width`. Each breakpoint's range is `(prev, bp]`, so
 *  the buckets don't cascade. `null` = wider than every breakpoint, i.e. the
 *  primary/base design with no override. */
function resolveBucket(width: number, sortedBp: number[]): number | null {
  for (let i = 0; i < sortedBp.length; i++) {
    const lower = i > 0 ? sortedBp[i - 1] : 0;
    if (width > lower && width <= sortedBp[i]) return sortedBp[i];
  }
  return null;
}

export default function withResponsiveProps<P extends Record<string, any>>(
  Component: ComponentType<P>,
): ComponentType<P & { 'data-responsive'?: string; __canvasViewportWidth?: number }> {
  // forwardRef: scroll effects target the instance with `ref={…}` for
  // `useScroll({ target })` — a plain function component would silently drop
  // it (framer then throws "Target ref is defined but not hydrated"). The ref
  // pins to the animated wrapper (a real DOM box = the component's exact
  // footprint), so scroll measurement works with the component untouched.
  return forwardRef(function ResponsiveSpark(props: any, fwdRef: any) {
    const canvasVpWidth = props.__canvasViewportWidth as number | undefined;
    const responsiveStr = props['data-responsive'];

    // Breakpoint list, parsed once per distinct `data-responsive` string. The
    // resize listener needs it to bucket a width, and re-parsing JSON on every
    // resize event would be its own waste.
    const sortedBp = useMemo(() => parseBreakpoints(responsiveStr), [responsiveStr]);
    // Read by the resize listener, which is registered once and must not go
    // stale if the breakpoint list changes underneath it.
    const bpRef = useRef(sortedBp);
    bpRef.current = sortedBp;

    // STATE IS THE MATCHED BREAKPOINT, NOT THE RAW WIDTH.
    //
    // This used to hold `window.innerWidth` and set it on every resize event,
    // so dragging a window edge re-rendered the whole design component
    // hundreds of times — each commit re-measuring a projection tree that can
    // be 30+ `layout` nodes deep, while the variant's non-tweenable props
    // (position/display) were mid-flight on motion's own loop. Footers came out
    // of a resize with their contents stranded and invisible (user report
    // 2026-08-09). Only the BUCKET can change what renders, so only the bucket
    // belongs in state: one commit per crossing instead of one per mouse move.
    //
    // `hold` is the number of REMAINING instant-crossing commits — see
    // `crossing` below. 0 = settled.
    // ── Per-instance root style re-key ──────────────────────────────────
    // A master's own `<style>` rules target its root by the ROOT id
    // (`[data-id="<rootId>"]::after`, `:lang()` overrides, bands), but on the
    // page the root's `data-id` is the INSTANCE id (`{...rest}` overrides it).
    // Only the original instance — whose id equals the root id — still
    // matched; every duplicate silently lost those rules. The generator now
    // stamps `data-mroot="<rootId>"` after the spread; here, for an instance
    // whose id differs, clone each direct-child <style> with the root id
    // rewritten to the instance id. Rules for CHILD ids are untouched (child
    // ids are not overridden). Client-only, cleaned up on unmount.
    const instanceId = props['data-id'] as string | undefined;
    useLayoutEffect(() => {
      if (!instanceId || typeof document === 'undefined') return;
      const clones: HTMLStyleElement[] = [];
      const esc = (v: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"'));
      const roots = document.querySelectorAll<HTMLElement>(`[data-mroot][data-id="${esc(instanceId)}"]`);
      roots.forEach((root) => {
        const mroot = root.getAttribute('data-mroot');
        if (!mroot || mroot === instanceId) return;
        const needle = `[data-id="${mroot}"]`;
        const replacement = `[data-id="${instanceId}"]`;
        root.querySelectorAll<HTMLStyleElement>(':scope > style').forEach((st) => {
          if (st.hasAttribute('data-mroot-clone')) return;
          const txt = st.textContent || '';
          if (!txt.includes(needle)) return;
          const c = document.createElement('style');
          c.setAttribute('data-mroot-clone', instanceId);
          c.textContent = txt.split(needle).join(replacement);
          st.after(c);
          clones.push(c);
        });
      });
      return () => { for (const c of clones) c.remove(); };
    }, [instanceId]);

    // ── Pre-hydration variant paint ────────────────────────────────────
    // The server cannot know the viewport, so the markup it sends carries the
    // DEFAULT variant's inline styles and a phone paints the desktop design
    // until React hydrates. These rules state each breakpoint's own variant in
    // CSS, so the browser resolves it during its first style pass. The gate
    // attribute below switches them off the moment motion takes over.
    useLayoutEffect(() => {
      const id = props['data-id'];
      if (!id || typeof document === 'undefined') return;
      // A FRAME later, not immediately. framer-motion writes a mounting
      // element's variant styles from its own layout effects (children first,
      // so ahead of this one) but finishes some channels on its animation
      // loop; releasing the gate in the same commit could hand one frame back
      // to the server's desktop values. One rAF costs nothing — no user can
      // interact before the first frame — and removes the ordering question.
      const esc2 = (v: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"'));
      const raf = requestAnimationFrame(() => {
        document.querySelectorAll(`[data-id="${esc2(String(id))}"]`).forEach((el) => {
          el.setAttribute('data-rv-hydrated', '');
        });
      });
      return () => cancelAnimationFrame(raf);
    }, [props['data-id']]);

    const [bp, setBp] = useState(() => {
      const initial = resolveBucket(
        typeof window !== 'undefined' ? window.innerWidth : 1440,
        sortedBp,
      );
      return { cur: initial, hold: 0 };
    });

    useEffect(() => {
      if (canvasVpWidth !== undefined) return;
      const read = () => {
        const next = resolveBucket(window.innerWidth, bpRef.current);
        // Same bucket → same object → React bails out without re-rendering.
        // A crossing opens a TWO-commit instant window (see `crossing`).
        setBp((s) => (s.cur === next ? s : { cur: next, hold: 2 }));
      };
      read(); // width may have moved between first render and this effect
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }, [canvasVpWidth]);

    // Release the crossing window one commit at a time. TWO commits, not one:
    // a design component WITH CONNECTIONS holds its variant in state and syncs
    // it from the `initialVariant` prop in an effect
    // (`useEffect(() => setVariant(initialVariant), [initialVariant])`), so
    // its visible switch lands one commit AFTER the prop-change commit. With a
    // one-commit window, that sync commit rendered in the same batch as the
    // release (both effects flush together) — the actual desktop→mobile morph
    // animated at full duration (user report 2026-08-27: header slides on
    // window resize; stateless components switched inside the window and were
    // fine, which is why only connection-bearing components showed it).
    useEffect(() => {
      if (bp.hold > 0) setBp((s) => (s.hold > 0 ? { cur: s.cur, hold: s.hold - 1 } : s));
    }, [bp]);

    // A CROSSING must not animate. Everything the variant switch touches —
    // width, gap, flex-direction, position — changes at once, and `layout`
    // FLIP-animates all of it by default: the component visibly morphs from
    // the desktop arrangement to the mobile one instead of just being mobile.
    // A viewport is a state of the world, not a transition between states.
    //
    // MotionConfig sets the DEFAULT transition for every descendant, layout
    // projections included, so this covers a whole design component without
    // codegen touching a single element. Caveat worth knowing: an element with
    // its own `transition` prop overrides the default, so an appear effect's
    // `transition={{duration: 0.6}}` still governs that element's layout
    // animation. Fixing those needs the per-element route (position/display
    // out of the variants object), not this.
    const crossing = bp.hold > 0;

    const vpWidth = canvasVpWidth ?? bp.cur ?? Infinity;
    let mergedProps = { ...props };

    if (responsiveStr) {
      try {
        const overrides = typeof responsiveStr === 'string'
          ? JSON.parse(responsiveStr) : responsiveStr;
        // On the canvas the tile width is authoritative and arrives per render;
        // off-canvas `vpWidth` IS the resolved bucket already.
        const matchedBp = canvasVpWidth !== undefined
          ? resolveBucket(canvasVpWidth, sortedBp)
          : bp.cur;
        if (matchedBp !== null && overrides[matchedBp]) {
          const ov = overrides[matchedBp];
          // A Scroll Variant binds `initialVariant={…Sv}` and OWNS it at runtime (it morphs the
          // variant on scroll). The per-viewport `data-responsive` entry must NOT override that
          // here — otherwise it freezes the variant on replicas and the morph never plays. The
          // per-viewport variant CHOICE still drives the canvas + seeds the Sv's resting; only
          // the runtime merge skips `initialVariant`. (No scroll variant → unchanged behaviour.)
          if (props['data-scroll-variant'] && ov && typeof ov === 'object' && 'initialVariant' in ov) {
            const { initialVariant: _skip, ...rest } = ov;
            mergedProps = { ...mergedProps, ...rest };
          } else {
            mergedProps = { ...mergedProps, ...ov };
          }
        }
      } catch {}
    }

    delete mergedProps['data-responsive'];
    delete mergedProps['__canvasViewportWidth'];

    // ── Empty style value = "no override" ──
    // The editor writes a per-variant instance size as a style ternary whose
    // OTHER branches are '' (`height: variant === 'hover' ? '35px' : ''`), and
    // the canvas Renderer treats '' as "delete the key" so the master's own
    // value shows through. On the live site the instance style is spread LAST
    // onto the master root (`width: '37px', height: '35px', ...style`), where a
    // '' (or undefined) key still OVERRIDES the master's value and React unsets
    // it — the primary-variant icon collapsed to nothing and only appeared on
    // hover (live find 2026-09-07). Drop those keys here so publish matches
    // the canvas: an empty instance value never reaches the master.
    if (mergedProps.style != null && typeof mergedProps.style === 'object') {
      const src = mergedProps.style as Record<string, any>;
      let dirty = false;
      for (const k in src) { if (src[k] === '' || src[k] === undefined) { dirty = true; break; } }
      if (dirty) {
        const clean: Record<string, any> = {};
        for (const k in src) { if (src[k] !== '' && src[k] !== undefined) clean[k] = src[k]; }
        mergedProps = { ...mergedProps, style: clean };
      }
    }

    // ── Flow-position safety net ──
    // Design-component masters bake `position: 'absolute'` on their root
    // (canvas master tiling; no left/top — variant x/y live in variantConfig)
    // and rely on the INSTANCE style overriding it via the trailing
    // `...style` spread. An instance authored WITHOUT a `position` key
    // (Make Component's transfer gap, pre-oracle AI writes, hand-written
    // code) lets the master's absolute leak on the live site: absolute with
    // no offsets takes its static position, and since every such sibling is
    // out of flow they all compute the SAME static position — repeated
    // instances stack on one spot (the collapsed-footer bug, 2026-08-12).
    // The editor canvas neutralizes master absolutes during instance
    // expansion, so the violation is invisible there; this net restores
    // canvas/live parity. Intentional out-of-flow instances always carry
    // their own `position` (+ offsets) and are untouched.
    if (mergedProps.style == null || (mergedProps.style as Record<string, any>).position == null) {
      mergedProps = {
        ...mergedProps,
        style: { position: 'relative', ...((mergedProps.style as Record<string, any>) ?? {}) },
      };
    }

    // ── Every breakpoint's variant, in the server's HTML ───────────────
    // The server has no viewport, so it renders whatever `initialVariant` it
    // was given and a phone paints the DESKTOP design until React hydrates —
    // styles and structure both (a burger gated by `initialVariant ===
    // 'variant-2'` is false on the server, so it isn't in the markup at all).
    // Rendering one copy per distinct variant and letting CSS pick fixes both.
    //
    // `settled` is false on the server AND on the client's FIRST render, so
    // hydration compares identical trees: no structural mismatch, no recovery
    // re-render. The effect then drops the copies that lost.
    const [settled, setSettled] = useState(false);
    useEffect(() => { setSettled(true); }, []);

    const copies = useMemo(() => {
      if (canvasVpWidth !== undefined) return [];     // the canvas draws its own tiles
      const id = props['data-id'];
      if (!id || !responsiveStr) return [];
      try {
        const overrides = typeof responsiveStr === 'string' ? JSON.parse(responsiveStr) : responsiveStr;
        const byBp: Record<number, string> = {};
        for (const key of Object.keys(overrides)) {
          if (key === '_bp') continue;
          const v = overrides[key]?.initialVariant;
          if (typeof v === 'string') byBp[Number(key)] = v;
        }
        return planVariantCopies(byBp, props.initialVariant ?? 'default', String(id));
      } catch { return []; }
    }, [responsiveStr, props['data-id'], props.initialVariant, canvasVpWidth]);

    /**
     * The component once per LIVE variant: every copy before hydration (so the
     * client's first render matches the server's tree exactly), the matched one
     * after. Each sits in a `display: contents` wrapper the picker stylesheet
     * hides, so nothing is added to layout.
     */
    const renderCopies = (childProps: Record<string, any>) => {
      const live = settled ? [matchedCopy(copies, bp.cur)] : copies;
      return (
        <>
          {!settled && <style data-rv-copies={props['data-id']} dangerouslySetInnerHTML={{ __html: copiesCss(copies) }} />}
          {live.map((c) => (
            <span key={c.variant} className={settled ? undefined : c.className} style={{ display: 'contents' }}>
              <Component {...(childProps as any)} initialVariant={c.variant} />
            </span>
          ))}
        </>
      );
    };

    // ── Animated-style socket (see header comment) ──
    // A forwarded ref ALSO forces the wrapper: it's the scroll-effect target,
    // which must resolve to a real DOM box even when the style carries no
    // animated values yet.
    //
    // `data-size-hug` (instance-auto-size, 2026-08-15) forces it too: the
    // editor writes a per-variant hug as `height: 'auto'` in the instance's
    // dim ternary, and on a NON-animated design instance the style would
    // spread straight into the root — `auto` on a leaf div collapses it to
    // its (empty) content. The wrapper restores the design-instance split:
    // placement (incl. the auto dim) rides the wrapper, the root keeps its
    // own baked master dim, and CSS auto wraps it at exactly the master's
    // size — tracking master edits with zero codegen at publish time.
    const style = mergedProps.style as Record<string, any> | undefined;
    let needsWrapper = fwdRef != null || mergedProps['data-size-hug'] != null;
    if (!needsWrapper && style) {
      for (const k of Object.keys(style)) {
        if (MOTION_ONLY_KEYS.has(k) || isMotionValue(style[k])) { needsWrapper = true; break; }
      }
    }
    if (needsWrapper) {
      const wrapperStyle: Record<string, any> = {};
      const innerStyle: Record<string, any> = {};
      for (const [k, v] of Object.entries(style ?? {})) {
        // `display` rides BOTH: an instance dragged into a replica carries an
        // inline `display: 'none'` (its primary-range hide — no @media band
        // can reach the primary) and the entered band's `[data-id] { display:
        // <root display> !important }` re-shows it. Both wrapper and inner
        // carry the data-id, so the band rule hits both; an inner-only `none`
        // would leave this wrapper's definite box standing on the desktop.
        if (k === 'display') { wrapperStyle[k] = v; innerStyle[k] = v; continue; }
        if (MOTION_ONLY_KEYS.has(k) || PLACEMENT_KEYS.has(k) || isMotionValue(v)) wrapperStyle[k] = v;
        else innerStyle[k] = v;
      }
      // The inner component fills the wrapper — but only along axes the
      // wrapper sized to a DEFINITE value (code-component instances always
      // carry definite dims; the guard keeps an unsized axis hugging
      // content). A hug axis (`'auto'`) must NOT fill: 100% of an auto box
      // resolves to nothing — the root's own baked dim is the size the
      // wrapper hugs.
      const definite = (v: unknown) => v != null && v !== 'auto';
      if (definite(wrapperStyle.width)) innerStyle.width = '100%';
      if (definite(wrapperStyle.height)) innerStyle.height = '100%';
      // The wrapper OWNS the instance's slot (all placement keys moved onto
      // it) — the inner root must re-base INTO the wrapper. Design-component
      // masters bake `position: 'absolute'` on their root (canvas master
      // tiling) and rely on the instance style overriding it via the trailing
      // `...style` spread; with the split the position key never reaches them,
      // so the root absolute-positioned inside a zero-size wrapper and
      // vanished (live find 2026-07-28: Sign Up button instance inside an
      // AnimatePresence popLayout header — popLayout's ref forces the
      // wrapper). Position is a PLACEMENT key, so innerStyle can never carry
      // its own — always re-base.
      innerStyle.position = 'relative';
      const { style: _split, ...rest } = mergedProps;
      delete rest.ref; // React 19 passes `ref` as a prop — never forward it inward
      // The wrapper owns the instance's BOX, so it must also own the instance's
      // IDENTITY. Every per-viewport override the editor writes is a
      // `[data-id="…"] { … !important }` rule in the page's <style> block, and
      // the only styles an instance tag may carry are placement ones
      // (the editor's WRAPPER_ONLY_STYLE_PROPS + width/height) — exactly the
      // keys that just moved onto the wrapper. With the id only on the inner,
      // those rules land on an element this split has already pinned to
      // `width/height: 100%; position: relative`, so they do nothing: the
      // canvas (whose own instance wrapper carries the data-id) painted the
      // override and the published page ignored it. Live find 2026-08-08 —
      // a mobile `width: 100%` on a button instance that had an Appear effect,
      // which is what forces the wrapper in the first place.
      //
      // COPIED, not moved: the inner keeps `rest`'s attributes so nothing that
      // already matches them stops matching. The duplicate is safe precisely
      // because an instance rule can only carry placement, and placement is
      // inert on a lone block child that already fills its parent.
      // The copies go INSIDE the wrapper, never around it: the wrapper is what
      // a scroll effect measures and what carries the MotionValues, so it must
      // stay ONE element however many variants render beneath it. Only the
      // matching copy takes up layout (the rest are display:none), so the
      // wrapper measures exactly what it would with a single child.
      return withInstantCrossing(crossing,
        <motion.div
          ref={fwdRef}
          data-id={rest['data-id']}
          data-name={rest['data-name']}
          style={wrapperStyle}
        >
          {copies.length > 1
            ? renderCopies({ ...rest, style: innerStyle })
            : <Component {...rest} style={innerStyle} />}
        </motion.div>,
      );
    }

    if (copies.length > 1) return withInstantCrossing(crossing, renderCopies(mergedProps));

    return withInstantCrossing(crossing, <Component {...mergedProps} />);
  }) as any;
}

/** The copy whose band owns the matched breakpoint (`null` = the base design). */
function matchedCopy<T extends { variant: string; maxWidth: number | null }>(copies: T[], bucket: number | null): T {
  if (bucket === null) return copies[0];
  // Copies are widest-first and each spans (minWidth, maxWidth]; the first one
  // whose upper bound covers the bucket owns it.
  for (let i = copies.length - 1; i >= 0; i--) {
    const c = copies[i];
    if (c.maxWidth !== null && bucket <= c.maxWidth) return c;
  }
  return copies[0];
}

/** Wrap the subtree so a breakpoint crossing lands with no animation.
 *
 *  The MotionConfig is ALWAYS mounted; only its `transition` prop toggles.
 *  The previous form (`crossing ? <MotionConfig>{tree}</MotionConfig> : tree`)
 *  changed the element TYPE at this slot, and React remounts on a type change
 *  — every crossing tore the whole component down TWICE (wrap + unwrap):
 *  internal state reset, mount effects/loops restarted, and the unwrap-commit
 *  remount re-played every initial→animate entrance at FULL duration (the
 *  config was already gone) — the post-crossing slide users saw. A constant
 *  wrapper reconciles in place; the crossing is then genuinely just a default-
 *  transition override for two commits.
 *
 *  When not crossing the prop is OMITTED (not `undefined`): MotionConfig
 *  merges `{...parentConfig, ...props}`, so an absent key inherits an
 *  ancestor MotionConfig's transition while a present-but-undefined key would
 *  clobber it. */
function withInstantCrossing(crossing: boolean, tree: React.ReactElement): React.ReactElement {
  return (
    <MotionConfig {...(crossing ? { transition: { duration: 0 } } : {})}>
      {tree}
    </MotionConfig>
  );
}
