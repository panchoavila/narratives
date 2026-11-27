import { trace } from '@/shared/debug-trace';
import { applySceneProjection, SCENE_TRANSITION_MS, SCENE_EASING, type SceneProjectionOptions, type SceneViewportBounds } from '@/shared/scene-projection';
import { FORCED_VISIBLE, applySceneClips, clearSceneClips, measureSceneClips } from './scene-clipping';

export interface SceneInspectionOptions extends SceneProjectionOptions {
  separation: number;
  selectedId: string;
  selectionColor?: string;
  viewportId?: string;
  bounds?: SceneViewportBounds;
  gridColor?: string;
  interacting?: boolean;
}

const STYLE_ID = 'revyme-scene-inspection';
const scope = '[data-scene-inspection]';
const requests = new WeakMap<HTMLElement, number>();

// RASTER-SCALE FREEZE. Every node is its own 3D layer here, and an orthographic
// camera change alters the projected scale of all of them, so Chrome re-rasters
// every layer on every frame of an orbit or 3D zoom: measured at ~75,000 tile
// rasters per 12 s orbit on a 945-node page, the GPU process main thread
// saturated, ~30 fps (Chrome 158, M1 Max, DPR 2). While the camera moves,
// `data-scene-gesture` on the scene root puts `will-change: transform` on the
// layers, which keeps them at the scale they have; one rest after the camera
// stops, the attribute goes and they re-raster sharp once. Holders cover
// gestures with a known end (an orbit drag, a projection transition); pulses
// cover discrete steps (wheel zoom, pan), each restarting the rest.
/** Quiet time after the camera's last move before the layers re-raster sharp. */
export const SCENE_GESTURE_REST_MS = 250;
interface SceneGesture { holders: Set<string>; rest: ReturnType<typeof setTimeout> | null }
const gestures = new WeakMap<HTMLElement, SceneGesture>();

function gestureOf(root: HTMLElement): SceneGesture {
  let gesture = gestures.get(root);
  if (!gesture) gestures.set(root, (gesture = { holders: new Set(), rest: null }));
  return gesture;
}

function showGesture(root: HTMLElement, gesture: SceneGesture): void {
  const frozen = gesture.holders.size > 0 || gesture.rest !== null;
  if (frozen === root.hasAttribute('data-scene-gesture')) return;
  root.toggleAttribute('data-scene-gesture', frozen);
  trace.dom('scene-inspection:raster-freeze', { frozen });
}

function restartRest(root: HTMLElement, gesture: SceneGesture): void {
  if (gesture.rest !== null) clearTimeout(gesture.rest);
  gesture.rest = setTimeout(() => {
    gesture.rest = null;
    showGesture(root, gesture);
  }, SCENE_GESTURE_REST_MS);
}

/** Freeze while `holder` holds; the last holder letting go starts the rest. */
export function holdSceneGesture(root: HTMLElement, holder: string, held: boolean): void {
  const gesture = gestureOf(root);
  if (held) gesture.holders.add(holder);
  else if (gesture.holders.delete(holder) && gesture.holders.size === 0) restartRest(root, gesture);
  showGesture(root, gesture);
}

/** Freeze for one rest after a discrete camera step (a wheel tick). */
export function pulseSceneGesture(root: HTMLElement): void {
  const gesture = gestureOf(root);
  restartRest(root, gesture);
  showGesture(root, gesture);
}

/** End the freeze now, cancelling any pending rest: leaving 3D. */
export function clearSceneGesture(root: HTMLElement): void {
  const gesture = gestures.get(root);
  if (gesture?.rest != null) clearTimeout(gesture.rest);
  gestures.delete(root);
  if (!root.hasAttribute('data-scene-gesture')) return;
  root.removeAttribute('data-scene-gesture');
  trace.dom('scene-inspection:raster-freeze', { frozen: false, cleared: true });
}

// The floor lies in the X/Z plane, so the active viewport's WIDTH is what it has
// to span; the viewport's height runs along Y and never lies on the floor.
// Sized by the height, a 1440x4600 desktop viewport got a 9,200 px square floor,
// a 339 Mpx layer at DPR 2 (7x the page's own layers) re-rastered on every
// orbit frame. Half-side = 3/4 of the width (the radial mask fades the floor
// out at 70% of it, just past the page's edges), at least 800, at most 2000.
const GRID_MIN_EXTENT = 800;
const GRID_MAX_EXTENT = 2000;
export function sceneGridExtent(bounds: SceneViewportBounds): number {
  return Math.min(GRID_MAX_EXTENT, Math.ceil(Math.max(bounds.width * 0.75, GRID_MIN_EXTENT) / 100) * 100);
}

export function findSceneViewport(root: HTMLElement, id: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-viewport]')].find(el => el.dataset.viewport === id && el.hasAttribute('data-node-id')) ?? null;
}
/** Layout measurements, never projected axis-aligned screen rectangles. */
export function getSceneViewportBounds(root: HTMLElement, id: string): SceneViewportBounds | null {
  const el = findSceneViewport(root, id);
  if (!el) return null;
  const css = root.ownerDocument.defaultView!.getComputedStyle(el);
  const size = (axis: 'width' | 'height') => {
    const value = parseFloat(css[axis]);
    if (!Number.isFinite(value)) return axis === 'width' ? el.offsetWidth : el.offsetHeight;
    if (css.boxSizing === 'border-box') return value;
    const sides = axis === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom'];
    return value + sides.reduce((sum, side) => sum + (parseFloat(css.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0) + (parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0), 0);
  };
  return { x: parseFloat(el.style.left) || el.offsetLeft, y: parseFloat(el.style.top) || el.offsetTop, width: size('width'), height: size('height') };
}

function updateGrid(root: HTMLElement, options: SceneInspectionOptions) {
  let grid = root.querySelector<HTMLElement>(':scope > [data-scene-grid]');
  if (!options.viewportId || !options.bounds) { grid?.remove(); return; }
  if (!grid) { grid = root.ownerDocument.createElement('div'); grid.dataset.sceneGrid = ''; root.appendChild(grid); }
  const signature = JSON.stringify([options.viewportId, options.bounds, options.gridColor]);
  if (grid.dataset.sceneGrid === signature) return;
  grid.dataset.sceneGrid = signature;
  // The floor is a fixed world feature centred on the breakpoint. The pivot is
  // wherever the user was looking at entry, so the grid does not follow it.
  const x = options.bounds.x + options.bounds.width / 2;
  const y = options.bounds.y + options.bounds.height / 2;
  const extent = sceneGridExtent(options.bounds);
  const step = Math.max(50, Math.round(extent / 2000) * 50);
  grid.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0;transform-style:preserve-3d;pointer-events:none;`;
  grid.dataset.sceneViewport = options.viewportId;
  grid.replaceChildren();
  const floor = root.ownerDocument.createElement('div');
  const color = options.gridColor || 'rgba(128,128,128,.18)';
  floor.style.cssText = `position:absolute;left:${-extent}px;top:${-extent}px;width:${extent * 2}px;height:${extent * 2}px;transform:rotateX(90deg);background-image:linear-gradient(to right,${color} 1px,transparent 1px),linear-gradient(to bottom,${color} 1px,transparent 1px);background-size:${step}px ${step}px;mask-image:radial-gradient(ellipse,black 25%,transparent 70%);`;
  grid.appendChild(floor);
  for (const [axis, color, rotation] of [['X', '#e65369', ''], ['Y', '#88b940', 'rotateY(90deg)'], ['Z', '#4194e8', 'rotateZ(90deg)']]) {
    const line = root.ownerDocument.createElement('div');
    line.dataset.sceneAxis = axis;
    line.style.cssText = `position:absolute;left:${-extent}px;top:0;width:${extent * 2}px;height:1px;background:${color};opacity:.65;transform:${rotation || 'none'};mask-image:linear-gradient(to right,transparent,black 35%,black 65%,transparent);`;
    grid.appendChild(line);
  }
}

/** Rotate the renderer's ONE scene plane, containing all breakpoint views.
 * Nodes, camera, layout, and authored styles remain owned by the live editor. */
export async function applySceneInspection(root: HTMLElement, options: SceneInspectionOptions): Promise<void> {
  const request = (requests.get(root) ?? 0) + 1;
  requests.set(root, request);
  const doc = root.ownerDocument;
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (options.enabled) {
    if (!style) {
      style = doc.createElement('style'); style.id = STYLE_ID; doc.head.appendChild(style);
    }
    const gap = Number.isFinite(options.separation) ? Math.max(0, Math.min(96, options.separation)) : 24;
    const selected = JSON.stringify(options.selectedId).replace(/</g, '\\3c ').replace(/\u2028|\u2029/g, '');
    const viewport = JSON.stringify(options.viewportId ?? '').replace(/</g, '\\3c ');
    // Hidden viewports draw nothing and are no layers; the freeze must not promote them.
    const hiddenViewports = options.viewportId ? `${scope} > [data-viewport]:not([data-viewport=${viewport}])` : '';
    // No viewport gets an individual rotation. Depth alone separates nested
    // elements; the shared parent carries the upright world projection.
    // Spatial components keep their own geometry through every intermediate
    // wrapper. Grouping properties would otherwise flatten that geometry
    // before the inspector camera can rotate it.
    // Only containers lose their overflow (it would flatten their children);
    // leaves keep their own crop, and what containers cropped is redrawn on the
    // leaves with clip-path (scene-clipping.ts).
    const css = `
${scope}, ${scope} [data-node-id] { transform-style: preserve-3d !important; contain: none !important; }
${scope}, ${scope} ${FORCED_VISIBLE} { overflow: visible !important; }
${scope}:has([data-revyme-spatial-surface]), ${scope} :has([data-revyme-spatial-surface]) {
  transform-style: preserve-3d !important; contain: none !important; content-visibility: visible !important;
  overflow: visible !important; opacity: 1 !important; filter: none !important; isolation: auto !important;
  clip: auto !important; clip-path: none !important; mask-image: none !important;
  -webkit-mask-image: none !important; mask-border-source: none !important; mix-blend-mode: normal !important;
}
${scope} [data-revyme-spatial-camera] { perspective: none !important; }
${scope} [data-revyme-spatial-surface] { visibility: visible !important; backface-visibility: visible !important; opacity: 1 !important; }
${scope} [data-node-id]:not(svg [data-node-id]) { translate: 0 0 0; transition: translate ${SCENE_TRANSITION_MS}ms ${SCENE_EASING} !important; }
${scope}[data-scene-inspection="isometric"] [data-node-id]:not(svg [data-node-id]) { translate: 0 0 ${gap}px !important; }
${scope}[data-scene-inspection="isometric"] > [data-node-id], ${scope}[data-scene-inspection="isometric"] [data-viewport] { translate: none !important; }
${scope}[data-scene-gesture] [data-node-id]:not(svg [data-node-id])${hiddenViewports ? `:not(${hiddenViewports}, ${hiddenViewports} *)` : ''}, ${scope}[data-scene-gesture] > [data-scene-grid] > * { will-change: transform !important; }
${options.viewportId ? `${scope} > [data-viewport]:not([data-viewport=${viewport}]), ${scope} > [data-viewport]:not([data-viewport=${viewport}]) * { visibility: hidden !important; }` : ''}
${options.selectedId ? `${scope} [data-node-id][data-id=${selected}] { outline: 2px solid var(--scene-selection, currentColor) !important; outline-offset: 3px !important; }` : ''}
@media (prefers-reduced-motion: reduce) { ${scope} [data-node-id]:not(svg [data-node-id]) { transition: none !important; } }
`;
    // Entry: measure the 2D crops before the attribute scopes the stylesheet in.
    if (!root.hasAttribute('data-scene-inspection')) measureSceneClips(root);
    if (style.textContent !== css) style.textContent = css;
    applySceneClips(root, scope);
    root.style.setProperty('--scene-selection', options.selectionColor || 'currentColor');
    if (!root.hasAttribute('data-scene-inspection')) {
      root.setAttribute('data-scene-inspection', '2d');
      root.getBoundingClientRect();
    }
    root.setAttribute('data-scene-inspection', 'isometric');
    updateGrid(root, options);
  } else if (root.hasAttribute('data-scene-inspection')) {
    root.setAttribute('data-scene-inspection', '2d');
  }
  // A drag holds the freeze until it ends; a projection that animates (enter,
  // exit, an axis view, perspective on/off) holds it until it settles. Each
  // request holds under its own name, so an older request settling (which a
  // newer one triggers) cannot end the newer one's hold.
  holdSceneGesture(root, 'orbit', options.enabled && !!options.interacting);
  const plane = () => `${root.style.transform}|${root.style.transformOrigin}`;
  const before = plane();
  const settled = applySceneProjection(root, options);
  const moving = plane() !== before;
  const transition = `transition:${request}`;
  if (moving) holdSceneGesture(root, transition, true);
  await settled;
  if (moving) holdSceneGesture(root, transition, false);
  if (requests.get(root) !== request) return;
  if (!options.enabled) {
    clearSceneGesture(root);
    root.removeAttribute('data-scene-inspection');
    root.style.removeProperty('--scene-selection');
    style?.remove();
    root.querySelector(':scope > [data-scene-grid]')?.remove();
    clearSceneClips(root);
  }
  trace.action('scene-inspection:mode', { enabled: options.enabled, separation: options.separation, projection: 'upright-shared-plane' });
}
