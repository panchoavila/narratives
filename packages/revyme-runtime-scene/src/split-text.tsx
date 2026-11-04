'use client';

// split-text.tsx — `<RevymeSplitText>`: the runtime half of Revyme's Text effect.
//
// WHY THIS EXISTS (2026-07-31). Text effects used to be split at CODEGEN time: the
// generator wrote N `<motion.span>` elements — one per character — straight into the
// user's page source. That cannot work for text that isn't known until render:
// `{item.title}` from a CMS row, `{t('key')}` from i18n, `{propName}` from a component
// variable. The generator saw an expression, not a string, and escaped it per character
// into `&#123;item.title&#125;`, so every CMS row rendered the literal text `{item.title}`.
//
// Splitting at RENDER time removes the whole class of problem: by the time this component
// runs, `children` is already the resolved string. It also collapses ~600 lines of
// generator (four span builders, scroll-hook injection, canvas dormancy) into one prop.
//
// HARD CONSTRAINT — the split must be a PURE function of props, computed DURING RENDER.
// Published sites are SSR'd; a split deferred to an effect would emit a bare string on the
// server and spans on the client, i.e. a hydration mismatch. Nothing here measures the DOM
// or reads `window` outside an effect/lazy-initialiser.

import * as React from 'react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';

// ─── Spec ────────────────────────────────────────────────────────────────────

export type SplitTextScope = { query: string } | { variant: string };

/** Structurally `TextAnimConfig` from the builder (canvas-poc/src/editor/tools/
 *  AnimationTool/motion/text-anim-presets.ts). Kept in sync by a type-assignability
 *  test in canvas-poc — a field added there without a counterpart here fails the build. */
export interface SplitTextSpec {
  /** STRUCTURAL — resolved from the BASE spec only, never from a scope override, so the
   *  emitted tree is identical on server and client. */
  animationType?: 'character' | 'word' | 'line' | 'full';
  /** STRUCTURAL — wraps each unit in an overflow-hidden clip ("cut-off" reveal). */
  mask?: boolean;
  /** STRUCTURAL — when the reveal plays (Framer's Trigger):
   *  'appear'  = On Appear: as soon as it mounts, wherever it is on the page.
   *  'view'    = Layer in View (default): when the text's top reaches `viewport`.
   *  'section' = Section in View: when `sectionId`'s top reaches `viewport`.
   *  'scroll'  = scrubbed to scroll progress (scrollStart / scrollEnd). */
  trigger?: 'appear' | 'view' | 'section' | 'scroll';
  /** Layer / Section in View — the viewport line the top edge must cross:
   *  top of the viewport, its middle, or its bottom (default: as soon as it enters). */
  viewport?: 'top' | 'middle' | 'bottom';
  /** Layer / Section in View — play again every time it re-enters (hide when it leaves). */
  replay?: boolean;
  /** Section in View — the id of the section that triggers the reveal. */
  sectionId?: string;
  /** Per-scope existence switch — a VALUE field, so a `responsive` scope can
   *  turn the effect off (or back on) for one breakpoint/variant. Disabled
   *  renders the SAME split DOM with no motion: structure stays identical
   *  across scopes, which is what keeps server and client trees agreeing. */
  disabled?: boolean;
  /** Scroll mode only — viewport position (% from top) where the reveal starts / completes. */
  scrollStart?: number;
  scrollEnd?: number;
  /** Scroll mode only — the share of the scrub each unit spans, as a fraction of the whole
   *  range. Default 0.4: units overlap and the reveal reads as a soft gradient across the
   *  text. 0 = one unit at a time (1/count each, no overlap): a sharp per-word step, which is
   *  how Framer's Text Scroll Reveal reads. Pair with a spring `transition` and the step lands
   *  with the spring's own snap. */
  scrollWindow?: number;
  opacity?: number;
  scale?: number;
  blur?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  skewX?: number;
  skewY?: number;
  /** Strings keep their unit. '100%' resolves against the unit's OWN box, which is what
   *  makes a masked reveal correct at every type size — a px offset masks correctly at
   *  one breakpoint only. */
  x?: number | string;
  y?: number | string;
  /** Stagger between units, seconds. */
  delay?: number;
  transition?: {
    type?: 'spring' | 'tween';
    stiffness?: number;
    damping?: number;
    mass?: number;
    duration?: number;
    bounce?: number;
    ease?: string | number[];
    /** Initial delay before the first unit, seconds. */
    delay?: number;
  };
  /** Per-viewport / per-variant value overrides. First match wins (matches the builder's
   *  `resolveTextAnimForScope`). Structural fields in an override are ignored. */
  responsive?: Array<{ scope: SplitTextScope; config: Partial<SplitTextSpec> }>;
}

export interface RevymeSplitTextProps {
  spec?: SplitTextSpec;
  /** Active component variant — only needed when `spec.responsive` has `{variant}` scopes. */
  variant?: string;
  children?: React.ReactNode;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WRAP_PLAIN: React.CSSProperties = { whiteSpace: 'nowrap' };
/** paddingBottom/marginBottom cancel out — zero layout cost. The padding keeps descenders
 *  (g, y, p) from being shaved by the clip AND leaves the sliver IntersectionObserver needs
 *  when a unit is offset a full 100% (otherwise it sits entirely outside the clip). */
const WRAP_MASK: React.CSSProperties = {
  whiteSpace: 'nowrap', display: 'inline-block', overflow: 'hidden',
  paddingBottom: '0.14em', marginBottom: '-0.14em',
};

/** The editor persists a custom cubic-bezier as the STRING "[0.22, 1, 0.36, 1]" (that's what
 *  the TransitionPanel curve editor writes). framer accepts a named easing or a real array —
 *  handed the string it throws `Invalid easing type` and unmounts the tree. Codegen normalises
 *  this too; the runtime keeps it so hand-written source still works. */
function normalizeEase(e: string | number[] | undefined): string | number[] | undefined {
  if (e === undefined || Array.isArray(e)) return e;
  const s = String(e).trim();
  if (!s.startsWith('[')) return s;
  const n = s.replace(/[[\]]/g, '').split(',').map((v) => parseFloat(v.trim()));
  return n.length === 4 && n.every(Number.isFinite) ? n : undefined;
}

/** Collapse React children to a plain string, or null when they can't be split.
 *
 *  `null` (a real element child — a styled `<span>` mark, an icon) means "render verbatim,
 *  unsplit" rather than mangling rich content. Everything the generator used to normalise at
 *  build time — `{item.title}`, `{t('key')}`, `{"a\nb"}`, `a<br/>b` — arrives here already
 *  resolved to a string or a `<br />`, so one function covers all of it. */
function flattenToText(node: React.ReactNode): string | null {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    let out = '';
    for (const child of node) {
      const part = flattenToText(child);
      if (part === null) return null;
      out += part;
    }
    return out;
  }
  if (React.isValidElement(node)) {
    const type = (node as React.ReactElement).type;
    if (type === 'br') return '\n';
    if (type === React.Fragment) return flattenToText((node.props as any)?.children);
    return null;                                  // a real element → not splittable
  }
  return null;
}

/** Active `responsive` entry index, or -1 for the base spec.
 *
 *  The `matchMedia` read is a LAZY useState initialiser, not a post-mount effect: framer
 *  captures `initial` once at mount, so starting at `false` and correcting later makes the
 *  responsive branch permanently lose to the base. Same shape as the builder's generated
 *  `useMediaQuery` (canvas-poc/src/code/generation/scoped-expr.ts). */
function useActiveScopeIndex(spec: SplitTextSpec, variant?: string): number {
  const entries = spec.responsive;
  const compute = React.useCallback((): number => {
    if (!entries || entries.length === 0) return -1;
    for (let i = 0; i < entries.length; i++) {
      const scope = entries[i].scope;
      if ('variant' in scope) {
        if (variant !== undefined && scope.variant === variant) return i;
      } else if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        if (window.matchMedia(scope.query).matches) return i;
      }
    }
    return -1;
  }, [entries, variant]);

  const [idx, setIdx] = React.useState(compute);

  React.useEffect(() => {
    setIdx(compute());
    if (!entries || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const lists = entries
      .map((e) => ('query' in e.scope ? window.matchMedia(e.scope.query) : null))
      .filter(Boolean) as MediaQueryList[];
    if (lists.length === 0) return;
    const onChange = () => setIdx(compute());
    for (const l of lists) l.addEventListener('change', onChange);
    return () => { for (const l of lists) l.removeEventListener('change', onChange); };
  }, [entries, compute]);

  return idx;
}

const RESTING: Record<string, number> = { opacity: 1, scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0, skewX: 0, skewY: 0, x: 0, y: 0 };
const CHANNELS = ['opacity', 'scale', 'rotateX', 'rotateY', 'rotateZ', 'skewX', 'skewY', 'x', 'y'] as const;

/** The animated-from state. Mirrors the builder's `buildHiddenState`: a channel is animated
 *  only when the spec sets it to something other than its resting value. */
function hiddenState(s: SplitTextSpec): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of CHANNELS) {
    const v = s[k];
    if (v !== undefined && v !== RESTING[k]) out[k] = v;
  }
  if (s.blur !== undefined && s.blur !== 0) out.filter = `blur(${s.blur}px)`;
  return out;
}

function visibleState(s: SplitTextSpec): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of CHANNELS) {
    const v = s[k];
    if (v !== undefined && v !== RESTING[k]) out[k] = RESTING[k];
  }
  if (s.blur !== undefined && s.blur !== 0) out.filter = 'blur(0px)';
  return out;
}

/** `'100%'` → `'0%'`, `24` → `0`. Keeps the unit so a percentage offset scrubs correctly. */
function restingOf(from: number | string, key: string): number | string {
  if (typeof from === 'number') return RESTING[key] ?? 0;
  const m = String(from).match(/^(-?[\d.]+)(.*)$/);
  return m ? `${RESTING[key] ?? 0}${m[2]}` : (RESTING[key] ?? 0);
}

interface Unit { key: string; inner: React.ReactNode; display: 'inline-block' | 'block'; index: number }

type Node = { t: 'unit'; u: Unit } | { t: 'br'; k: string } | { t: 'text'; k: string; v: string }
  | { t: 'wrap'; k: string; kids: Node[] }
  // A PRESERVED inline mark (`<strong>`, `<span style={{…}}>`): the wrapper
  // element survives in the stream and its text recurses into animated units
  // INSIDE it, so bold/color style the moving glyphs by plain CSS inheritance.
  | { t: 'el'; k: string; tag: string; props: Record<string, unknown>; kids: Node[] };

/** Inline tags a rich run may carry — anything else (an icon, a nested
 *  component) makes the content unsplittable and the whole child tree renders
 *  verbatim, exactly as before. */
const INLINE_MARK_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark', 'code', 'a']);

/**
 * Split RICH children into render nodes — the marks-preserving twin of
 * `buildNodes` (formatting used to be silently dropped: the generator fed the
 * splitter plain text, and any element child made the runtime bail to an
 * unanimated verbatim render; live find 2026-09-05, bold+color vanished the
 * moment a Text effect was applied).
 *
 * Walk: strings split into units by the normal char/word rules; a `<br />`
 * breaks a line; an inline mark element becomes an `el` node whose CHILDREN
 * recurse — the mark wrapper stays in the DOM and its glyph units animate
 * inside it, styled by inheritance. The unit index is GLOBAL across the walk
 * so stagger and scroll ranges flow through mark boundaries as if the text
 * were plain. Returns null when any child is not splittable (non-inline tag,
 * component instance) → caller falls back to today's verbatim render.
 *
 * 'line' and 'full' modes group WHOLE segments (rich content rides inside the
 * unit as ReactNode children); only top-level `<br />` separates lines.
 */
function buildRichNodes(
  children: React.ReactNode,
  animationType: SplitTextSpec['animationType'],
  mask: boolean,
): { nodes: Node[]; count: number; sig: string } | null {
  let i = 0;
  let sig = '';
  let key = 0;
  let bailed = false;

  type Seg = { kind: 'text'; v: string } | { kind: 'el'; tag: string; props: Record<string, unknown>; segs: Seg[] } | { kind: 'br' };

  // Pass 1 — normalize the React tree into segments (and the memo signature).
  const toSegs = (node: React.ReactNode, out: Seg[]): void => {
    if (bailed || node === null || node === undefined || node === false || node === true) return;
    if (typeof node === 'string' || typeof node === 'number') {
      const v = String(node);
      out.push({ kind: 'text', v });
      sig += v;
      return;
    }
    if (Array.isArray(node)) { for (const c of node) toSegs(c, out); return; }
    if (React.isValidElement(node)) {
      const type = (node as React.ReactElement).type;
      if (type === React.Fragment) { toSegs((node.props as { children?: React.ReactNode })?.children, out); return; }
      if (type === 'br') { out.push({ kind: 'br' }); sig += '\n'; return; }
      if (typeof type === 'string' && INLINE_MARK_TAGS.has(type)) {
        const { children: kids, ...props } = (node.props ?? {}) as { children?: React.ReactNode } & Record<string, unknown>;
        const segs: Seg[] = [];
        sig += `<${type} ${JSON.stringify(props.style ?? null)}>`;
        toSegs(kids, segs);
        sig += `</${type}>`;
        out.push({ kind: 'el', tag: type, props, segs });
        return;
      }
      bailed = true;
      return;
    }
    bailed = true;
  };

  const roots: Seg[] = [];
  toSegs(children, roots);
  if (bailed) return null;

  // Pass 2 — segments → nodes, per animation mode.
  const unit = (inner: React.ReactNode, display: Unit['display']): Node =>
    ({ t: 'unit', u: { key: `u${i}`, inner, display, index: i++ } });

  const segsToReact = (segs: Seg[]): React.ReactNode[] => segs.map((s2, idx) => {
    if (s2.kind === 'text') return s2.v;
    if (s2.kind === 'br') return React.createElement('br', { key: `b${idx}` });
    return React.createElement(s2.tag, { ...s2.props, key: `e${idx}` }, ...segsToReact(s2.segs));
  });

  if (animationType === 'full') {
    return { nodes: [unit(segsToReact(roots), 'inline-block')], count: i, sig };
  }

  if (animationType === 'line') {
    // Top-level <br> splits lines; each line unit carries its rich segment.
    const nodes: Node[] = [];
    let line: Seg[] = [];
    const flush = (li: number) => {
      if (li > 0) nodes.push({ t: 'br', k: `br${li}` });
      nodes.push(unit(segsToReact(line), 'block'));
      line = [];
    };
    let li = 0;
    for (const s2 of roots) {
      if (s2.kind === 'br') { flush(li); li++; }
      else line.push(s2);
    }
    flush(li);
    return { nodes, count: i, sig };
  }

  // char / word — recurse, preserving mark wrappers as `el` nodes.
  const emit = (segs: Seg[], out: Node[]): void => {
    for (const s2 of segs) {
      if (s2.kind === 'br') { out.push({ t: 'br', k: `br${key++}` }); continue; }
      if (s2.kind === 'el') {
        const kids: Node[] = [];
        emit(s2.segs, kids);
        out.push({ t: 'el', k: `el${key++}`, tag: s2.tag, props: s2.props, kids });
        continue;
      }
      // A text run: same word/space walk as the plain splitter, scoped to
      // this run — a mark starting mid-word simply continues the unit flow.
      const words = s2.v.split(' ');
      for (let wi = 0; wi < words.length; wi++) {
        if (wi > 0) out.push({ t: 'text', k: `sp${key++}`, v: ' ' });
        const word = words[wi];
        if (!word) continue;
        if (animationType === 'word') {
          const u = unit(word, 'inline-block');
          out.push(mask ? { t: 'wrap', k: `w${key++}`, kids: [u] } : u);
        } else {
          const kids: Node[] = [];
          for (const ch of word) kids.push(unit(ch, 'inline-block'));
          out.push({ t: 'wrap', k: `w${key++}`, kids });
        }
      }
    }
  };
  const nodes: Node[] = [];
  emit(roots, nodes);
  return { nodes, count: i, sig };
}

/** Split `text` into render nodes. Structure mirrors the old codegen splitter exactly, so the
 *  emitted DOM is unchanged from the build-time era. Keys are pure functions of index → SSR
 *  and CSR agree. */
function buildNodes(text: string, animationType: SplitTextSpec['animationType'], mask: boolean): { nodes: Node[]; count: number } {
  const nodes: Node[] = [];
  let i = 0;
  const lines = text.split('\n');

  if (animationType === 'line') {
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) nodes.push({ t: 'br', k: `br${li}` });
      nodes.push({ t: 'unit', u: { key: `u${i}`, inner: lines[li], display: 'block', index: i } });
      i++;
    }
    return { nodes, count: i };
  }
  if (animationType === 'full') {
    nodes.push({ t: 'unit', u: { key: 'u0', inner: text, display: 'inline-block', index: 0 } });
    return { nodes, count: 1 };
  }

  for (let li = 0; li < lines.length; li++) {
    if (li > 0) nodes.push({ t: 'br', k: `br${li}` });
    const words = lines[li].split(' ');
    for (let wi = 0; wi < words.length; wi++) {
      if (wi > 0) nodes.push({ t: 'text', k: `sp${li}-${wi}`, v: ' ' });
      const word = words[wi];
      if (!word) continue;
      if (animationType === 'word') {
        const u: Node = { t: 'unit', u: { key: `u${i}`, inner: word, display: 'inline-block', index: i } };
        i++;
        nodes.push(mask ? { t: 'wrap', k: `w${li}-${wi}`, kids: [u] } : u);
      } else {
        const kids: Node[] = [];
        for (const ch of word) {
          kids.push({ t: 'unit', u: { key: `u${i}`, inner: ch, display: 'inline-block', index: i } });
          i++;
        }
        nodes.push({ t: 'wrap', k: `w${li}-${wi}`, kids });
      }
    }
  }
  return { nodes, count: i };
}

// ─── Scroll unit ─────────────────────────────────────────────────────────────

/** One scroll-scrubbed unit. Split into its own component because `useTransform` must be
 *  called once per animated channel and that count is data-driven — calling them in a loop
 *  inside the parent would violate the rules of hooks. The parent keys each instance by a
 *  channel fingerprint, so a spec change REMOUNTS rather than reordering hooks. */
function ScrollUnit({ progress, range, channels, display, children }: {
  progress: MotionValue<number>;
  range: [number, number];
  channels: Array<{ key: string; from: number | string; to: number | string }>;
  display: string;
  children: React.ReactNode;
}) {
  const style: Record<string, any> = { display };
  for (const c of channels) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- count is fixed per mount; see above
    style[c.key] = useTransform(progress, range, [c.from as never, c.to as never]);
  }
  return <motion.span style={style as React.CSSProperties}>{children}</motion.span>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RevymeSplitText({ spec, variant, children }: RevymeSplitTextProps): React.ReactElement {
  const base: SplitTextSpec = spec ?? {};
  const hostRef = React.useRef<HTMLSpanElement>(null);

  const scopeIdx = useActiveScopeIndex(base, variant);
  const resolved: SplitTextSpec = React.useMemo(() => {
    const r = scopeIdx >= 0 && base.responsive
      ? { ...base, ...base.responsive[scopeIdx].config }
      : base;
    // Structural fields come from the BASE, always — the tree must not depend on a scope,
    // or server and client can disagree about the DOM (not just about style values).
    return { ...r, animationType: base.animationType, mask: base.mask, responsive: base.responsive };
  }, [base, scopeIdx]);

  const animationType = base.animationType ?? 'character';
  const mask = !!base.mask;
  // Marks-preserving walk. Plain strings produce EXACTLY the old structure
  // (buildRichNodes degrades to the same units); rich runs keep their mark
  // wrappers with the glyph units animating inside. `null` = unsplittable
  // (icon, component child) → the verbatim fallback below, unchanged.
  const text = flattenToText(children);

  // ONE observer for the whole run, not one per character. Besides being N× cheaper, this
  // structurally avoids the deadlock the per-character form had: a masked unit offset out of
  // its own overflow-hidden clip has intersection ratio 0 and never fires.
  const inView = usePlayed(hostRef, resolved);

  // Called unconditionally so the hook count never changes when a scope flips view↔scroll.
  const startFrac = Math.min(1, Math.max(0, (resolved.scrollStart ?? 90) / 100));
  const endFrac = Math.min(1, Math.max(0, (resolved.scrollEnd ?? 35) / 100));
  const { scrollYProgress } = useScroll({
    target: hostRef,
    offset: [`start ${startFrac}`, `start ${endFrac}`] as never,
  });
  // A spring transition in scroll mode smooths the scrub through the spring, so a sharp
  // window (scrollWindow 0) steps with the spring's snap rather than a hard cut. Called
  // unconditionally (hook count); a non-spring spec keeps the raw progress.
  const springScroll = resolved.trigger === 'scroll' && resolved.transition?.type === 'spring';
  const sprung = useSpring(scrollYProgress, springScroll
    ? { stiffness: resolved.transition?.stiffness ?? 300, damping: resolved.transition?.damping ?? 30, mass: resolved.transition?.mass ?? 1 }
    : { stiffness: 1e6, damping: 1e6, mass: 1 });
  const scrubProgress = springScroll ? sprung : scrollYProgress;

  const rich = React.useMemo(
    () => (text !== null ? null : buildRichNodes(children, animationType, mask)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- children identity churns every
    // render; the walk is cheap and its output is keyed deterministically, so recomputing is
    // correct. The plain-text path below keeps its string-keyed memo.
    [text === null ? 1 : 0, animationType, mask, children],
  );
  const plain = React.useMemo(
    () => buildNodes(text ?? '', animationType, mask),
    [text, animationType, mask],
  );
  const { nodes, count } = rich ?? plain;

  // Not splittable (a component child, an icon) → render verbatim rather than mangling it.
  if (text === null && rich === null) return <span ref={hostRef}>{children}</span>;

  const isScroll = resolved.trigger === 'scroll';
  // Disabled for the ACTIVE scope → both endpoints empty: units mount at
  // rest and never move. The split DOM is unchanged, so toggling existence
  // per breakpoint can't desync SSR/CSR trees.
  const off = !!resolved.disabled;
  const hidden = off ? {} : hiddenState(resolved);
  const visible = off ? {} : visibleState(resolved);
  const stagger = resolved.delay ?? 0.05;
  const initialDelay = resolved.transition?.delay ?? 0;
  const tr = resolved.transition
    ? { ...resolved.transition, ease: normalizeEase(resolved.transition.ease), delay: undefined } as any
    : { type: 'spring' as const, stiffness: 300, damping: 30 } as any;

  const channels = isScroll && !off
    ? Object.entries(hidden).map(([key, from]) => ({
        key,
        from: from as number | string,
        to: key === 'filter' ? 'blur(0px)' : restingOf(from as number | string, key),
      }))
    : [];
  const fingerprint = channels.map((c) => c.key).join('|');

  const renderUnit = (u: Unit): React.ReactElement => {
    if (isScroll) {
      // Each unit scrubs over a window `w` of the range, spread so the first starts at 0 and
      // the last ends at 1. `scrollWindow: 0` is one unit at a time (w = 1/count), whose
      // windows tile the range exactly: word i runs from i/count to (i+1)/count.
      const w = resolved.scrollWindow === undefined ? 0.4
        : resolved.scrollWindow <= 0 ? 1 / Math.max(1, count) : Math.min(1, resolved.scrollWindow);
      const start = count > 1 ? Math.round((u.index / (count - 1)) * (1 - w) * 1000) / 1000 : 0;
      const end = Math.min(1, Math.round((start + w) * 1000) / 1000);
      return (
        <ScrollUnit
          key={`${fingerprint}#${u.key}`}
          progress={scrubProgress}
          range={[start, end]}
          channels={channels}
          display={u.display}
        >{u.inner}</ScrollUnit>
      );
    }
    return (
      <motion.span
        key={u.key}
        style={{ display: u.display }}
        initial={hidden}
        animate={inView ? visible : hidden}
        transition={{ ...tr, delay: Math.round((initialDelay + u.index * stagger) * 1000) / 1000 }}
      >{u.inner}</motion.span>
    );
  };

  const render = (n: Node): React.ReactNode => {
    if (n.t === 'br') return <br key={n.k} />;
    if (n.t === 'text') return n.v;
    if (n.t === 'wrap') return <span key={n.k} style={mask ? WRAP_MASK : WRAP_PLAIN}>{n.kids.map(render)}</span>;
    if (n.t === 'el') return React.createElement(n.tag, { ...n.props, key: n.k }, n.kids.map(render));
    return renderUnit(n.u);
  };

  return (
    <span ref={hostRef} style={{ display: animationType === 'line' ? 'block' : 'inline' }}>
      {nodes.map(render)}
    </span>
  );
}

/** Viewport line (fraction of the viewport height from the top) per `viewport`. */
const VIEWPORT_LINE: Record<string, number> = { top: 0, middle: 0.5, bottom: 1 };

/**
 * Whether the reveal has played for the spec's trigger. Reads the watched
 * element's real rect on scroll/resize (the same model the builder's Scroll
 * Variant uses), so it follows smooth-scroll libraries and any page scale.
 */
function usePlayed(hostRef: React.RefObject<HTMLElement | null>, spec: SplitTextSpec): boolean {
  const trigger = spec.trigger ?? 'view';
  const [played, setPlayed] = React.useState(false);
  React.useEffect(() => {
    if (trigger === 'scroll') return;
    if (trigger === 'appear') { setPlayed(true); return; }
    const line = VIEWPORT_LINE[spec.viewport ?? 'bottom'] ?? 1;
    const check = () => {
      const el = trigger === 'section'
        ? (spec.sectionId ? document.getElementById(spec.sectionId) : null)
        : hostRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const h = window.innerHeight;
      // Crossed the line: the top edge is above it. For the default bottom line a
      // box that has already scrolled past (bottom < 0) still counts as played.
      const crossed = r.top <= h * line && (line < 1 || r.top < h);
      if (crossed) setPlayed(true);
      else if (spec.replay) setPlayed(false);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [trigger, spec.viewport, spec.replay, spec.sectionId, hostRef]);
  return played;
}

export default RevymeSplitText;
