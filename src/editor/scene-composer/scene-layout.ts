import { transformManager } from '@/canvas/transform';
import type { SceneViewportBounds } from '@/shared/scene-projection';

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
