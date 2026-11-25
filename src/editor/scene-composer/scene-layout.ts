import { transformManager } from '@/canvas/transform';
import type { SceneOrigin, SceneViewportBounds } from '@/shared/scene-projection';

/** Screen area of the existing canvas left unobscured by editor panels. */
export function sceneScreenRect() {
  const host = document.querySelector<HTMLElement>('[data-canvas-root]');
  const rect = host?.getBoundingClientRect();
  const width = rect?.width || window.innerWidth, height = rect?.height || window.innerHeight;
  const left = Math.max(0, (document.querySelector('[data-editor-panel="left-primary"]')?.getBoundingClientRect().right ?? rect?.left ?? 0) - (rect?.left ?? 0));
  const right = Math.min(width, (document.querySelector('[data-properties-panel]')?.getBoundingClientRect().left ?? rect?.right ?? width) - (rect?.left ?? 0));
  return { left, right, width: Math.max(200, right - left), height, x: (left + right) / 2, y: height / 2 };
}

export function fitSceneViewport(bounds: SceneViewportBounds) {
  const area = sceneScreenRect();
  const scale = Math.max(.05, Math.min(1, (area.width - 120) / Math.max(bounds.width, 1), (area.height - 180) / Math.max(bounds.height, 1)));
  transformManager.setTransform({ x: area.x - (bounds.x + bounds.width / 2) * scale, y: area.y - (bounds.y + bounds.height / 2) * scale, scale });
}

/** The 2D camera: a scene point p is drawn at host-local x + p * scale. */
export interface SceneCameraTransform { x: number; y: number; scale: number }
export type SceneScreenArea = ReturnType<typeof sceneScreenRect>;

/** The scene point drawn at the centre of the visible canvas area. */
export function sceneScreenCentre(camera: SceneCameraTransform, area: SceneScreenArea): SceneOrigin {
  return { x: (area.x - camera.x) / camera.scale, y: (area.y - camera.y) / camera.scale };
}

/** The scene rectangle the camera shows in the visible canvas area. */
export function sceneVisibleRect(camera: SceneCameraTransform, area: SceneScreenArea): SceneViewportBounds {
  return {
    x: (area.left - camera.x) / camera.scale,
    y: -camera.y / camera.scale,
    width: Math.max(0, area.right - area.left) / camera.scale,
    height: area.height / camera.scale,
  };
}

function overlapArea(a: SceneViewportBounds, b: SceneViewportBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

const contains = (b: SceneViewportBounds, p: SceneOrigin) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const nearestPoint = (b: SceneViewportBounds, p: SceneOrigin): SceneOrigin => ({ x: clamp(p.x, b.x, b.x + b.width), y: clamp(p.y, b.y, b.y + b.height) });

/** The breakpoint the screen shows: the one under the centre of the visible area,
 * else the visible one nearest the centre (the pivot then lies as close to the
 * centre as it can), else null (none is on screen). `preferred` (the clicked
 * breakpoint) wins ties. */
export function pickSceneViewport(
  candidates: Array<{ id: string; bounds: SceneViewportBounds }>,
  camera: SceneCameraTransform,
  area: SceneScreenArea,
  preferred: string,
): string | null {
  const ordered = [...candidates].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  const centre = sceneScreenCentre(camera, area);
  const atCentre = ordered.find(c => contains(c.bounds, centre));
  if (atCentre) return atCentre.id;
  const visible = sceneVisibleRect(camera, area);
  let best: string | null = null, nearest = Infinity;
  for (const c of ordered) {
    if (!overlapArea(c.bounds, visible)) continue;
    const p = nearestPoint(c.bounds, centre);
    const distance = Math.hypot(p.x - centre.x, p.y - centre.y);
    if (distance < nearest) { best = c.id; nearest = distance; }
  }
  return best;
}

/** Where 3D turns about so the view continues from 2D: the breakpoint's point
 * nearest the centre of the visible area. That point stays where it is on screen
 * while the plane turns. Null when the breakpoint is not on screen at all. */
export function sceneEntryPivot(bounds: SceneViewportBounds, camera: SceneCameraTransform, area: SceneScreenArea): SceneOrigin | null {
  if (!overlapArea(bounds, sceneVisibleRect(camera, area))) return null;
  return nearestPoint(bounds, sceneScreenCentre(camera, area));
}
