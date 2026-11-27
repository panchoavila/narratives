// scene-clipping.ts — keeps 2D cropping visible in the 3D inspection view.
//
// The 3D view forces `overflow: visible` on canvas nodes (scene-inspection.ts):
// `overflow` other than visible is a grouping property, so a cropping container
// would flatten its children and lose the per-layer depth. Chrome 148 and 158
// flatten for `overflow: clip` too, although the spec lists it as
// non-grouping (Websites research/2026-11-27-3d-clipping/experiment). That
// forced `visible` also switched off two kinds of cropping:
//
//   A. Leaves crop their own content: an img with `object-fit: cover`, a text
//      with an ellipsis. A leaf (a replaced element, or a node with no node
//      below it) has no 3D children to flatten, so the inspection CSS forces
//      `visible` on containers only (FORCED_VISIBLE) and leaves keep theirs.
//   B. Containers crop their descendants. Containers keep `overflow: visible` and
//      their depth. Each LEAF node a container cropped in 2D gets a
//      `clip-path: inset(...)` equal to that cropping, measured on entry while
//      the plane is still flat. A leaf has no 3D children to flatten.
//
// Measured once per entry, in 2D, for every breakpoint. In 3D the plane is turned
// and every computed `overflow` reads `visible`, so nothing can be measured there.
// The insets are kept per element and re-applied after every render (the renderer
// may drop unknown attributes). They are dropped on exit.

import { trace } from '@/shared/debug-trace';

/** Replaced elements: they crop their own content and have no canvas children. */
export const REPLACED_NODES = 'img, video, canvas, iframe, embed, object, svg';
/** The nodes whose `overflow` 3D forces to `visible`: containers of other nodes. */
export const FORCED_VISIBLE = `[data-node-id]:not(${REPLACED_NODES}):has([data-node-id])`;

const CLIP_STYLE_ID = 'revyme-scene-clips';
const CLIP_ATTR = 'data-scene-clip';
const SPATIAL = '[data-revyme-spatial-surface]';

interface Box { left: number; top: number; right: number; bottom: number }
interface SceneClips { insets: Map<HTMLElement, string>; skipped: { rotated: number; authored: number; spatial: number } }
const clips = new WeakMap<HTMLElement, SceneClips>();

const isReplaced = (el: Element) => el.matches(REPLACED_NODES);
/** A visual leaf of the node tree: no canvas node below it (an svg's inner shapes do not count). */
const isLeaf = (el: HTMLElement) => isReplaced(el) || !el.querySelector('[data-node-id]');
const crops = (cs: CSSStyleDeclaration) => [cs.overflowX, cs.overflowY].some(v => !!v && v !== 'visible');

/** A transform that is not a translate or a scale turns the box: its client rect is a
 *  bounding box, not the box, and an axis-aligned inset cannot describe the crop. */
function turned(cs: CSSStyleDeclaration): boolean {
  if (cs.rotate && cs.rotate !== 'none') return true;
  if (!cs.transform || cs.transform === 'none') return false;
  const m = new DOMMatrixReadOnly(cs.transform);
  return Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || !m.is2D;
}

/** The padding box (where `overflow` crops) in client coordinates. */
function paddingBox(el: HTMLElement, r: DOMRect): Box | null {
  if (!el.offsetWidth || !el.offsetHeight) return null;
  const sx = r.width / el.offsetWidth, sy = r.height / el.offsetHeight;
  const left = r.left + el.clientLeft * sx, top = r.top + el.clientTop * sy;
  return { left, top, right: left + el.clientWidth * sx, bottom: top + el.clientHeight * sy };
}

/**
 * Before the 3D stylesheet applies: which leaves are cropped, and how much.
 * Reads the 2D computed style and client rects of the whole scene root (every
 * breakpoint, so a switch of breakpoint in 3D needs no measurement).
 */
export function measureSceneClips(root: HTMLElement): void {
  const insets = new Map<HTMLElement, string>();
  const skipped = { rotated: 0, authored: 0, spatial: 0 };
  const clippers = new Set<HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-node-id]')) {
    // Leaves keep their own overflow in 3D: only containers lose theirs.
    if (el.closest('svg') || isLeaf(el)) continue;
    const cs = getComputedStyle(el);
    if (!crops(cs)) continue;
    if (el.querySelector(SPATIAL) || el.closest(SPATIAL)) { skipped.spatial++; continue; }
    if (turned(cs)) { skipped.rotated++; continue; }
    clippers.add(el);
  }
  const leaves = new Set<HTMLElement>();
  for (const c of clippers) {
    for (const el of c.querySelectorAll<HTMLElement>('[data-node-id]')) {
      const inSvg = el.tagName.toLowerCase() !== 'svg' && !!el.closest('svg');
      if (!inSvg && isLeaf(el)) leaves.add(el);
    }
  }
  const boxes = new Map<HTMLElement, Box | null>();
  const boxOf = (c: HTMLElement) => {
    if (!boxes.has(c)) boxes.set(c, paddingBox(c, c.getBoundingClientRect()));
    return boxes.get(c)!;
  };
  for (const leaf of leaves) {
    if (leaf.closest(SPATIAL)) { skipped.spatial++; continue; }
    const cs = getComputedStyle(leaf);
    if (cs.clipPath && cs.clipPath !== 'none') { skipped.authored++; continue; }
    // The crop is the intersection of every cropping ancestor; a turned box on the
    // way makes the client rects bounding boxes, so the crop cannot be described.
    let visible: Box | null = null, rotated = turned(cs);
    for (let a = leaf.parentElement; a && a !== root.parentElement && !rotated; a = a.parentElement) {
      if (!a.hasAttribute('data-node-id')) continue;
      if (clippers.has(a)) {
        const b = boxOf(a);
        if (!b) continue;
        visible = visible
          ? { left: Math.max(visible.left, b.left), top: Math.max(visible.top, b.top), right: Math.min(visible.right, b.right), bottom: Math.min(visible.bottom, b.bottom) }
          : b;
      } else if (turned(getComputedStyle(a))) rotated = true;
    }
    if (rotated) { skipped.rotated++; continue; }
    if (!visible || !leaf.offsetWidth || !leaf.offsetHeight) continue;
    const r = leaf.getBoundingClientRect();
    const sx = r.width / leaf.offsetWidth, sy = r.height / leaf.offsetHeight;
    if (!sx || !sy) continue;
    const top = Math.max(0, visible.top - r.top) / sy, bottom = Math.max(0, r.bottom - visible.bottom) / sy;
    const left = Math.max(0, visible.left - r.left) / sx, right = Math.max(0, r.right - visible.right) / sx;
    const empty = visible.right <= r.left || visible.left >= r.right || visible.bottom <= r.top || visible.top >= r.bottom;
    if (!empty && top < 0.5 && right < 0.5 && bottom < 0.5 && left < 0.5) continue;
    const px = (v: number) => `${Math.round(v * 100) / 100}px`;
    insets.set(leaf, empty ? 'inset(50%)' : `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)})`);
  }
  clips.set(root, { insets, skipped });
  trace.dom('scene-inspection:clips-measured', { clippers: clippers.size, leaves: leaves.size, clipped: insets.size, skipped });
}

/** Marks the measured leaves and writes their crops. Idempotent: run after every render in 3D. */
export function applySceneClips(root: HTMLElement, scope: string): void {
  const state = clips.get(root);
  if (!state) return;
  const doc = root.ownerDocument;
  let style = doc.getElementById(CLIP_STYLE_ID) as HTMLStyleElement | null;
  if (!style) { style = doc.createElement('style'); style.id = CLIP_STYLE_ID; doc.head.appendChild(style); }
  const rules: string[] = [];
  let n = 0;
  for (const [leaf, inset] of state.insets) {
    if (!leaf.isConnected) { state.insets.delete(leaf); continue; }
    const id = String(++n);
    if (leaf.getAttribute(CLIP_ATTR) !== id) leaf.setAttribute(CLIP_ATTR, id);
    rules.push(`${scope} [${CLIP_ATTR}="${id}"] { clip-path: ${inset} !important; }`);
  }
  // A leaf that left the measured set (a render replaced it) must not keep a stale number.
  for (const el of root.querySelectorAll<HTMLElement>(`[${CLIP_ATTR}]`)) {
    if (!state.insets.has(el)) el.removeAttribute(CLIP_ATTR);
  }
  const css = rules.join('\n');
  if (style.textContent !== css) style.textContent = css;
}

/** Leaving 3D: no crop, attribute or measurement survives. */
export function clearSceneClips(root: HTMLElement): void {
  clips.delete(root);
  root.ownerDocument.getElementById(CLIP_STYLE_ID)?.remove();
  for (const el of root.querySelectorAll(`[${CLIP_ATTR}]`)) el.removeAttribute(CLIP_ATTR);
}

/** For tests and traces: how many leaves are cropped in 3D right now. */
export function sceneClipCount(root: HTMLElement): number {
  return clips.get(root)?.insets.size ?? 0;
}
