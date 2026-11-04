import { atom } from 'jotai';
import { SCENE_PITCH, SCENE_YAW, type SceneOrientation, type SceneViewportBounds } from '@/shared/scene-projection';

export type SceneAxisView = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom' | 'user';
export interface SceneCamera extends SceneOrientation {
  perspective: boolean;
  view: SceneAxisView;
  previousPerspective: boolean;
  dragging: boolean;
}
export const DEFAULT_SCENE_CAMERA: SceneCamera = { pitch: SCENE_PITCH, yaw: SCENE_YAW, roll: 0, perspective: false, previousPerspective: false, view: 'user', dragging: false };
export const sceneActiveAtom = atom(false);
export const sceneCameraAtom = atom<SceneCamera>({ ...DEFAULT_SCENE_CAMERA });
export const sceneBoundsAtom = atom<SceneViewportBounds | null>(null);

// Blender world axes mapped to the DOM: X right, Y into the page, Z up.
export const SCENE_AXIS_VIEWS: Record<Exclude<SceneAxisView, 'user'>, SceneOrientation> = {
  front: { pitch: 0, yaw: 0 }, back: { pitch: 0, yaw: 180 },
  right: { pitch: 0, yaw: -90 }, left: { pitch: 0, yaw: 90 },
  top: { pitch: -90, yaw: 0 }, bottom: { pitch: 90, yaw: 0 },
};
export const OPPOSITE_VIEW: Record<Exclude<SceneAxisView, 'user'>, Exclude<SceneAxisView, 'user'>> = { front:'back',back:'front',right:'left',left:'right',top:'bottom',bottom:'top' };

export function alignSceneView(camera: SceneCamera, target: Exclude<SceneAxisView, 'user'>): SceneCamera {
  const view = camera.view === target ? OPPOSITE_VIEW[target] : target;
  return { ...SCENE_AXIS_VIEWS[view], roll: 0, view, perspective: false, previousPerspective: camera.view === 'user' ? camera.perspective : camera.previousPerspective, dragging: false };
}

export function orbitSceneView(camera: SceneCamera, dx: number, dy: number): SceneCamera {
  // Blender factory Turntable sensitivity: .4 degrees per logical pixel.
  const reverse = Math.cos(camera.pitch * Math.PI / 180) < 0 ? -1 : 1;
  return { ...camera, pitch: camera.pitch + dy * .4, yaw: camera.yaw + dx * .4 * reverse, view: 'user', perspective: camera.view === 'user' ? camera.perspective : true, dragging: true };
}

/** Blender's Alt orbit snapping: 26 cube directions within 15 degrees. */
export function snapSceneView(camera: SceneCamera): SceneCamera {
  const p = camera.pitch * Math.PI / 180, y = camera.yaw * Math.PI / 180;
  const direction = [-Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
  let best = Math.cos(Math.PI / 12), target: number[] | null = null;
  for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const depth of [-1, 0, 1]) {
    const length = Math.hypot(x, z, depth); if (!length) continue;
    const d = [x / length, z / length, depth / length];
    const dot = d.reduce((sum, v, i) => sum + v * direction[i], 0);
    if (dot >= best) { best = dot; target = d; }
  }
  if (!target) return camera;
  const [x, z, depth] = target;
  const view: SceneAxisView = x === 1 ? 'right' : x === -1 ? 'left' : z === -1 ? 'top' : z === 1 ? 'bottom' : depth === 1 ? 'front' : depth === -1 ? 'back' : 'user';
  return { ...camera, pitch: Math.asin(z) * 180 / Math.PI || 0, yaw: Math.atan2(-x, depth) * 180 / Math.PI || 0, view, perspective: view === 'user' ? camera.perspective : false };
}
