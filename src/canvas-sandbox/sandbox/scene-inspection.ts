import { trace } from '@/shared/debug-trace';
import { applySceneProjection, SCENE_TRANSITION_MS, SCENE_EASING, type SceneProjectionOptions, type SceneViewportBounds } from '@/shared/scene-projection';

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
  if (!options.viewportId || !options.bounds || !options.origin) { grid?.remove(); return; }
  if (!grid) { grid = root.ownerDocument.createElement('div'); grid.dataset.sceneGrid = ''; root.appendChild(grid); }
  const signature = JSON.stringify([options.viewportId, options.bounds, options.origin, options.gridColor]);
  if (grid.dataset.sceneGrid === signature) return;
  grid.dataset.sceneGrid = signature;
  const { x, y } = options.origin;
  const extent = Math.ceil(Math.max(options.bounds.width, options.bounds.height, 800) / 100) * 100;
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
    // No viewport gets an individual rotation. Depth alone separates nested
    // elements; the shared parent carries the upright world projection.
    // Spatial components keep their own geometry through every intermediate
    // wrapper. Grouping properties would otherwise flatten that geometry
    // before the inspector camera can rotate it.
    const css = `
${scope}, ${scope} [data-node-id] { transform-style: preserve-3d !important; contain: none !important; overflow: visible !important; }
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
${options.viewportId ? `${scope} > [data-viewport]:not([data-viewport=${viewport}]), ${scope} > [data-viewport]:not([data-viewport=${viewport}]) * { visibility: hidden !important; }` : ''}
${options.selectedId ? `${scope} [data-node-id][data-id=${selected}] { outline: 2px solid var(--scene-selection, currentColor) !important; outline-offset: 3px !important; }` : ''}
@media (prefers-reduced-motion: reduce) { ${scope} [data-node-id]:not(svg [data-node-id]) { transition: none !important; } }
`;
    if (style.textContent !== css) style.textContent = css;
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
  await applySceneProjection(root, options);
  if (requests.get(root) !== request) return;
  if (!options.enabled) {
    root.removeAttribute('data-scene-inspection');
    root.style.removeProperty('--scene-selection');
    style?.remove();
    root.querySelector(':scope > [data-scene-grid]')?.remove();
  }
  trace.action('scene-inspection:mode', { enabled: options.enabled, separation: options.separation, projection: 'upright-shared-plane' });
}
