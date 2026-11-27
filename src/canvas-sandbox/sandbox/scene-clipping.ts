// scene-clipping.ts — keeps 2D cropping visible in the 3D inspection view.
//
// The 3D view forces `overflow: visible` on containers (scene-inspection.ts):
// `overflow` other than visible is a grouping property, so a cropping container
// would flatten its children and lose the per-layer depth. Chrome 148 and 158
// flatten for `overflow: clip` too, although the spec lists it as
// non-grouping (Websites research/2026-11-27-3d-clipping/experiment). Two kinds
// of cropping are kept another way:
//
//   A. Leaves crop their own content: an img with `object-fit: cover`, a text
//      with an ellipsis. A leaf (a replaced element, or a node with no node
//      below it) has no 3D children to flatten, so the inspection CSS forces
//      `visible` on containers only (FORCED_VISIBLE) and leaves keep theirs.
//   B. What a container cropped in 2D is cut again on the nodes it cropped:
//      `clip-path: inset(...)`, carried by a custom property (CLIP_VAR) under one
//      rule (sceneClipRule). A leaf gets its crop. A container lying wholly
//      outside its crop is hidden. A container only partly outside is left
//      whole, because a clip-path would flatten its subtree; its own leaves are
//      cut instead.
//
// Measured in 2D: the part of each node that 2D hides, as an inset in the node's
// own box. 3D then hides the same part of the node, wherever the 3D layout moves
// it. That layout differs: containers are visible (margins collapse through
// them), scroll offsets are gone, and every node is a containing block. A crop
// taken from the 3D layout would cut what 2D shows, such as a title pushed 11 px
// past its row by a collapsed margin on Thayér's archive.
// At entry the 3D stylesheet does not apply yet. After a render in 3D, it is
// switched off for one synchronous read, with the plane flat and transitions held
// (with2dCascade). That read is debounced, and waits until nothing animates.

import { trace } from '@/shared/debug-trace';

/** Replaced elements: they crop their own content and have no canvas children. */
export const REPLACED_NODES = 'img, video, canvas, iframe, embed, object, svg';
/** The nodes whose `overflow` 3D forces to `visible`: containers of other nodes. */
export const FORCED_VISIBLE = `[data-node-id]:not(${REPLACED_NODES}):has([data-node-id])`;

const CLIP_ATTR = 'data-scene-clip';
const CLIP_VAR = '--scene-clip';
const SPATIAL = '[data-revyme-spatial-surface]';
/** Stands in for "no edge" on an axis nothing crops: far past any canvas. */
const FAR = 1e5;

/** The one rule that applies every cut. */
export function sceneClipRule(scope: string): string {
  return `${scope} [${CLIP_ATTR}] { clip-path: var(${CLIP_VAR}) !important; }`;
}

interface Axes { x: boolean; y: boolean }
interface Box { left: number; top: number; right: number; bottom: number }
interface SceneClips {
  /** Nodes carrying a cut, and the cut. */
  marked: Map<HTMLElement, string>;
  /** Scroll offsets of cropping containers at entry, by `data-node-id`. 3D makes them
   *  `visible`, which drops the offset; a later 2D read puts it back first. */
  scroll: Map<string, [number, number]>;
  /** A measurement waiting for renders to stop and the scene to be still. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Structure changes in 3D that no render announces (collection items synced after one). */
  observer: MutationObserver | null;
}
/** Renders can arrive in a burst; one measurement after the last. */
const REMEASURE_DEBOUNCE_MS = 150;
const MEASURING_ATTR = 'data-scene-measuring';
const MEASURING_STYLE_ID = 'revyme-scene-measuring';
const states = new WeakMap<HTMLElement, SceneClips>();

const isReplaced = (el: Element) => el.matches(REPLACED_NODES);
/** A visual leaf of the node tree: no canvas node below it. An svg's inner shapes do not count. */
const isLeaf = (el: Element) => isReplaced(el) || !el.querySelector('[data-node-id]');
/** Shapes inside an inline svg belong to the svg leaf; they are never nodes of their own here. */
const insideSvg = (el: Element) => el.tagName.toLowerCase() !== 'svg' && !!el.parentElement?.closest('svg');
const none = (v: string | undefined) => !v || v === 'none';

/** The axes `overflow` crops on, or null. Overflow does not apply to inline boxes,
 *  and a `display: contents` node has no box. */
function cropAxes(cs: CSSStyleDeclaration): Axes | null {
  if (cs.display === 'inline' || cs.display === 'contents' || cs.display.startsWith('ruby')) return null;
  const x = !!cs.overflowX && cs.overflowX !== 'visible', y = !!cs.overflowY && cs.overflowY !== 'visible';
  return x || y ? { x, y } : null;
}

/** A transform that is not a translate or a positive scale turns or mirrors the box.
 *  Its client rect is then a bounding box, and an axis-aligned inset cannot describe the crop. */
function turned(cs: CSSStyleDeclaration): boolean {
  if (!none(cs.rotate)) return true;
  if (!none(cs.scale) && cs.scale.split(/\s+/).some(v => parseFloat(v) < 0)) return true;
  if (none(cs.transform)) return false;
  // The computed transform is matrix(a, b, c, d, e, f) or matrix3d(16 values, column-major).
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(cs.transform.trim());
  if (!m) return true; // unknown form: never guess an inset
  const v = m[2].split(',').map(Number);
  const flat = (x: number) => Math.abs(x) < 1e-6;
  if (!m[1]) return !flat(v[1]) || !flat(v[2]) || v[0] < 0 || v[3] < 0;
  // 3D: only translation (any axis) and a positive x/y scale keep the box axis-aligned.
  const [a, b, , p1, c, d, , p2, z1, z2, , p3] = v;
  return !flat(b) || !flat(c) || a < 0 || d < 0 || !flat(z1) || !flat(z2) || !flat(p1) || !flat(p2) || !flat(p3);
}

/** Border-box size in layout px. offset* exist on HTMLElement only: an inline
 *  `<svg>` node (createElementNS) reads its used width and height. */
function layoutSize(el: Element, cs: CSSStyleDeclaration): [number, number] {
  const h = el as HTMLElement;
  if (typeof h.offsetWidth === 'number') return [h.offsetWidth, h.offsetHeight];
  const px = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
  const w = parseFloat(cs.width) || 0, ht = parseFloat(cs.height) || 0;
  if (cs.boxSizing === 'border-box') return [w, ht];
  return [
    w + px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width'),
    ht + px('padding-top') + px('padding-bottom') + px('border-top-width') + px('border-bottom-width'),
  ];
}

/** Where `overflow` crops: the padding box, in client coordinates. Null for a node
 *  with no box. A zero-size box is a real box: it crops everything. */
function paddingBox(el: HTMLElement, cs: CSSStyleDeclaration): Box | null {
  if (!el.getClientRects().length) return null;
  const r = el.getBoundingClientRect();
  const [w, h] = layoutSize(el, cs);
  const sx = w ? r.width / w : 1, sy = h ? r.height / h : 1;
  const left = r.left + el.clientLeft * sx, top = r.top + el.clientTop * sy;
  return { left, top, right: left + el.clientWidth * sx, bottom: top + el.clientHeight * sy };
}

/** The axes a container crops on in 2D. A container holding (or inside) a spatial
 *  surface is left alone: the inspection CSS keeps its geometry. */
function clipperAxes(el: HTMLElement, cs: CSSStyleDeclaration): Axes | null {
  if (isLeaf(el) || insideSvg(el)) return null; // leaves keep their own overflow in 3D
  const axes = cropAxes(cs);
  if (!axes || el.querySelector(SPATIAL) || el.closest(SPATIAL)) return null;
  return axes;
}

type Escape = 'absolute' | 'fixed' | null;
const escapeOf = (cs: CSSStyleDeclaration): Escape => (cs.position === 'absolute' || cs.position === 'fixed' ? cs.position : null);
/** Whether `cs` is the containing block of an absolute (or fixed) descendant, as in 2D.
 *  The 3D view's own `translate` is ignored: it is not there in 2D. */
function containingBlock(cs: CSSStyleDeclaration, escape: Exclude<Escape, null>): boolean {
  const transformed = !none(cs.transform) || !none(cs.perspective) || !none(cs.filter);
  return escape === 'fixed' ? transformed : transformed || cs.position !== 'static';
}

/**
 * Measures every cut and writes it. Needs the 2D cascade and a flat plane: at
 * entry before the 3D stylesheet applies, or inside with2dCascade.
 */
export function measureSceneClips(root: HTMLElement): void {
  let state = states.get(root);
  const entry = !state;
  if (!state) { state = { marked: new Map(), scroll: new Map(), timer: null, observer: null }; states.set(root, state); }
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => { let cs = styles.get(el); if (!cs) { cs = getComputedStyle(el); styles.set(el, cs); } return cs; };
  const boxes = new Map<HTMLElement, Box | null>();
  const boxOf = (el: HTMLElement) => { if (!boxes.has(el)) boxes.set(el, paddingBox(el, style(el))); return boxes.get(el)!; };

  // Candidates: every node under a container that crops.
  const candidates = new Set<HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-node-id]')) {
    if (insideSvg(el) || isLeaf(el) || !clipperAxes(el, style(el))) continue;
    if (entry && (el.scrollLeft || el.scrollTop)) state.scroll.set(el.getAttribute('data-node-id') ?? '', [el.scrollLeft, el.scrollTop]);
    for (const d of el.querySelectorAll<HTMLElement>('[data-node-id]')) if (!insideSvg(d)) candidates.add(d);
  }

  const next = new Map<HTMLElement, string>();
  const skipped = { turned: 0, authored: 0, spatial: 0 };
  for (const node of candidates) {
    const leaf = isLeaf(node);
    const cs = style(node);
    if (node.closest(SPATIAL) || (!leaf && node.querySelector(SPATIAL))) { skipped.spatial++; continue; }
    if (!none(cs.clipPath)) { skipped.authored++; continue; }

    // The crop is the intersection of the ancestors that crop this node in 2D.
    // - An absolute or fixed box escapes every overflow between itself and its
    //   containing block, and so does a node inside such a box.
    // - A turned box below a cropping ancestor makes the client rect a bounding
    //   box, which an inset cannot describe.
    let visible: Box | null = null;
    let turnedBelow = turned(cs), unmeasurable = false;
    let escape = escapeOf(cs);
    for (let a = node.parentElement; a && a !== root.parentElement; a = a.parentElement) {
      const acs = style(a);
      if (escape && !containingBlock(acs, escape)) continue; // between the box and its containing block: no crop
      if (a.hasAttribute('data-node-id')) {
        const axes = clipperAxes(a, acs);
        if (axes) {
          if (turnedBelow) { unmeasurable = true; break; }
          const b = boxOf(a);
          if (b) {
            const clip: Box = { left: axes.x ? b.left : -FAR, right: axes.x ? b.right : FAR, top: axes.y ? b.top : -FAR, bottom: axes.y ? b.bottom : FAR };
            visible = visible
              ? { left: Math.max(visible.left, clip.left), top: Math.max(visible.top, clip.top), right: Math.min(visible.right, clip.right), bottom: Math.min(visible.bottom, clip.bottom) }
              : clip;
          }
        }
      }
      if (turned(acs)) turnedBelow = true;
      escape = escapeOf(acs); // an out-of-flow ancestor carries the node past the crops below its containing block
    }
    if (unmeasurable) { skipped.turned++; continue; }
    if (!visible) continue;

    const [w, h] = layoutSize(node, cs);
    if (!w || !h) continue;
    const r = node.getBoundingClientRect();
    const sx = r.width / w, sy = r.height / h;
    if (!sx || !sy) continue;
    const empty = visible.right <= r.left || visible.left >= r.right || visible.bottom <= r.top || visible.top >= r.bottom;
    if (empty) { next.set(node, 'inset(50%)'); continue; }
    if (!leaf) continue; // partly outside: a clip-path would flatten its subtree, so its leaves are cut instead
    // Signed: a side the crop does not reach extends to the crop's edge, so the
    // leaf's own outline, shadow and glyph overflow show as in 2D.
    const top = (visible.top - r.top) / sy, bottom = (r.bottom - visible.bottom) / sy;
    const left = (visible.left - r.left) / sx, right = (r.right - visible.right) / sx;
    if (top < 0.5 && right < 0.5 && bottom < 0.5 && left < 0.5) continue;
    const px = (v: number) => `${Math.round(Math.max(-FAR, Math.min(FAR, v)) * 100) / 100}px`;
    next.set(node, `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)})`);
  }
  for (const el of state.marked.keys()) if (!next.has(el)) unmark(el);
  state.marked = next;
  applySceneClips(root);
  trace.dom('scene-inspection:clips-measured', { candidates: candidates.size, cut: next.size, skipped });
}

function unmark(el: HTMLElement): void {
  el.removeAttribute(CLIP_ATTR);
  el.style.removeProperty(CLIP_VAR);
}

/** Writes the cuts back. Idempotent and cheap: run after every update, since a
 *  render may drop the attribute or the custom property. A node can also carry a
 *  cut that is not its own: collection items are cloned from their template,
 *  attributes and inline style included. Those are removed. */
export function applySceneClips(root: HTMLElement): void {
  const state = states.get(root);
  if (!state) return;
  for (const [el, inset] of state.marked) {
    if (!el.isConnected) { state.marked.delete(el); continue; }
    if (!el.hasAttribute(CLIP_ATTR)) el.setAttribute(CLIP_ATTR, '');
    if (el.style.getPropertyValue(CLIP_VAR) !== inset) el.style.setProperty(CLIP_VAR, inset);
  }
  for (const el of root.querySelectorAll<HTMLElement>(`[${CLIP_ATTR}]`)) if (!state.marked.has(el)) unmark(el);
  for (const el of root.querySelectorAll<HTMLElement>('[data-node-id][style*="--scene-clip"]')) if (!state.marked.has(el)) unmark(el);
}

/** In 3D, measures again whenever the canvas structure or text changes, not only
 *  after a render: collection items are synced after the render that announces it.
 *  The cuts' own writes are attributes and style, which this does not watch. */
export function watchSceneClips(root: HTMLElement, sheet: HTMLStyleElement): void {
  const state = states.get(root);
  if (!state || state.observer) return;
  state.observer = new MutationObserver(records => {
    if (records.some(r => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-scene-grid]'))) {
      applySceneClips(root);
      scheduleSceneClipRemeasure(root, sheet);
    }
  });
  state.observer.observe(root, { childList: true, subtree: true, characterData: true });
}

/** A render in 3D may have changed what 2D crops: measure again once renders stop
 *  and nothing animates. `sheet` is the 3D stylesheet, switched off for the read. */
export function scheduleSceneClipRemeasure(root: HTMLElement, sheet: HTMLStyleElement | null): void {
  const state = states.get(root);
  if (!state || !sheet) return;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (states.get(root) !== state || !root.isConnected) return;
    // A read now would cut a running turn or layer lift short: try again after it.
    const animating = typeof root.getAnimations === 'function' && root.getAnimations({ subtree: true }).some(a => a.playState === 'running');
    if (animating) { scheduleSceneClipRemeasure(root, sheet); return; }
    with2dCascade(root, sheet, () => measureSceneClips(root));
    trace.dom('scene-inspection:clips-remeasured', { cut: state.marked.size });
  }, REMEASURE_DEBOUNCE_MS);
}

/**
 * One synchronous read in 2D, in the middle of 3D: the plane is flat and the 3D
 * stylesheet off. No frame paints in between. Transitions are held while the
 * styles come back, so the turn and the layer lift return without animating.
 */
function with2dCascade(root: HTMLElement, sheet: HTMLStyleElement, read: () => void): void {
  const doc = root.ownerDocument;
  if (!doc.getElementById(MEASURING_STYLE_ID)) {
    const hold = doc.createElement('style');
    hold.id = MEASURING_STYLE_ID;
    // More specific than the 3D stylesheet's `transition` on nodes, so it wins while both apply.
    hold.textContent = `[${MEASURING_ATTR}], [${MEASURING_ATTR}][data-scene-inspection] [data-node-id][data-node-id][data-node-id][data-node-id] { transition: none !important; }`;
    doc.head.appendChild(hold);
  }
  const transform = [root.style.getPropertyValue('transform'), root.style.getPropertyPriority('transform')] as const;
  root.setAttribute(MEASURING_ATTR, '');
  root.style.setProperty('transform', 'none');
  sheet.disabled = true;
  try {
    // The 2D read sees what entry saw: containers scrolled as they were then.
    const scroll = states.get(root)?.scroll;
    if (scroll?.size) {
      for (const el of root.querySelectorAll<HTMLElement>('[data-node-id]')) {
        const at = scroll.get(el.getAttribute('data-node-id') ?? '');
        if (at) { el.scrollLeft = at[0]; el.scrollTop = at[1]; }
      }
    }
    read();
  } finally {
    sheet.disabled = false;
    if (transform[0]) root.style.setProperty('transform', transform[0], transform[1]); else root.style.removeProperty('transform');
    root.getBoundingClientRect(); // styles are back while transitions are held: nothing animates
    root.removeAttribute(MEASURING_ATTR);
  }
}

/** Leaving 3D: no cut, mark, timer or measurement survives. */
export function clearSceneClips(root: HTMLElement): void {
  const state = states.get(root);
  if (state?.timer != null) clearTimeout(state.timer);
  state?.observer?.disconnect();
  if (state) for (const el of state.marked.keys()) unmark(el);
  root.ownerDocument.getElementById(MEASURING_STYLE_ID)?.remove();
  for (const el of root.querySelectorAll<HTMLElement>(`[${CLIP_ATTR}]`)) unmark(el);
  states.delete(root);
}

/** For tests and traces: how many nodes carry a cut right now. */
export function sceneClipCount(root: HTMLElement): number {
  return states.get(root)?.marked.size ?? 0;
}
