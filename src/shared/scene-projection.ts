/** One upright projection shared by the live canvas and its viewport headers.
 * Y has no screen-X component: page edges remain vertical. Camera pan/zoom
 * stays on the existing parent, outside this projection. */
import { trace } from '@/shared/debug-trace';

export const SCENE_PITCH = -35.264389682754654;
export const SCENE_YAW = -45;
export const SCENE_TRANSITION_MS = 320;
export const SCENE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export interface SceneOrigin { x: number; y: number }
export interface SceneOrientation { pitch: number; yaw: number; roll?: number }
export interface SceneViewportBounds { x: number; y: number; width: number; height: number }
export interface SceneProjectionOptions { enabled: boolean; origin?: SceneOrigin; instant?: boolean; orientation?: SceneOrientation; perspective?: boolean; distance?: number }

const properties = ['transform', 'transform-origin', 'transform-style', 'transition', 'backface-visibility'] as const;
interface PlaneState {
  original: Array<[string, string, string]>;
  timer?: number;
  resolve?: () => void;
  enabled: boolean;
  origin: SceneOrigin;
  signature?: string;
  settled: Promise<void>;
}
const planes = new WeakMap<HTMLElement, PlaneState>();

export function projectScenePoint(x: number, y: number, z = 0, orientation: SceneOrientation = { pitch: SCENE_PITCH, yaw: SCENE_YAW }) {
  const pitch = orientation.pitch * Math.PI / 180, yaw = orientation.yaw * Math.PI / 180, roll = (orientation.roll ?? 0) * Math.PI / 180;
  const px = Math.cos(roll) * x - Math.sin(roll) * y;
  const py = Math.sin(roll) * x + Math.cos(roll) * y;
  const rx = Math.cos(yaw) * px + Math.sin(yaw) * z;
  const rz = -Math.sin(yaw) * px + Math.cos(yaw) * z;
  return { x: rx, y: Math.cos(pitch) * py - Math.sin(pitch) * rz, z: Math.sin(pitch) * py + Math.cos(pitch) * rz };
}

export function sceneTransform(options: SceneProjectionOptions): string {
  if (!options.enabled) return 'rotateX(0deg) rotateY(0deg)';
  const o = options.orientation ?? { pitch: SCENE_PITCH, yaw: SCENE_YAW };
  return `${options.perspective ? `perspective(${Math.max(600, options.distance ?? 1600)}px) ` : ''}rotateX(${o.pitch}deg) rotateY(${o.yaw}deg)${o.roll ? ` rotateZ(${o.roll}deg)` : ''}`;
}

/** Animate an existing plane, preserving and restoring all its inline styles. */
export function applySceneProjection(plane: HTMLElement, options: SceneProjectionOptions): Promise<void> {
  const win = plane.ownerDocument.defaultView!;
  let state = planes.get(plane);
  if (!state && !options.enabled) return Promise.resolve();
  const origin = options.origin ?? state?.origin ?? { x: 0, y: 0 };
  const target = sceneTransform(options);
  const signature = `${target}:${origin.x}:${origin.y}`;
  if (state?.signature === signature) return state.settled;
  if (!state) {
    state = { original: properties.map(key => [key, plane.style.getPropertyValue(key), plane.style.getPropertyPriority(key)]), enabled: false, origin, settled: Promise.resolve() };
    planes.set(plane, state);
    plane.style.transform = 'rotateX(0deg) rotateY(0deg)';
    plane.style.transformStyle = 'preserve-3d';
    plane.style.backfaceVisibility = 'visible';
    // Establish the 2D starting frame before changing the target rotation.
    plane.getBoundingClientRect();
  }
  if (state.timer !== undefined) win.clearTimeout(state.timer);
  state.resolve?.();
  state.origin = origin;
  state.enabled = options.enabled;
  state.signature = signature;
  const ms = options.instant || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : SCENE_TRANSITION_MS;
  plane.style.transformOrigin = `${origin.x}px ${origin.y}px`;
  plane.style.transition = `transform ${ms}ms ${SCENE_EASING}`;
  plane.style.transform = target;
  trace.action('scene-projection:transition', { enabled: options.enabled, origin, duration: ms });
  const current = state;
  current.settled = new Promise(resolve => {
    current.resolve = resolve;
    const finish = () => {
      current.timer = undefined;
      current.resolve = undefined;
      if (!current.enabled) {
        for (const [key, value, priority] of current.original) {
          if (value) plane.style.setProperty(key, value, priority); else plane.style.removeProperty(key);
        }
        planes.delete(plane);
      }
      resolve();
    };
    if (ms) current.timer = win.setTimeout(finish, ms); else finish();
  });
  return current.settled;
}
