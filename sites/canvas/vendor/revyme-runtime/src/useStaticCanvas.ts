'use client';

/**
 * `useStaticCanvas()` — returns `true` when the component is being rendered
 * inside the Revyme canvas editor, `false` in the live preview, published
 * site, or any other consumer environment.
 *
 * Sparks / code components use this to skip GPU-expensive animation work
 * (continuous rAF loops, big CSS blur layers, WebGL frames) on the editor
 * canvas where the user only needs a representative still — paint once,
 * stop. The full animated version still runs in preview and production.
 *
 * Mechanics: this default implementation always returns `false`. The canvas
 * editor's spark loader (`code-component-runtime.ts` MODULE_MAP) overrides
 * the export at compile time so it returns `true` in the canvas iframe and
 * `false` in the spark editor's preview pane (which sets `previewMode`).
 *
 * Mirrors Framer's `useIsStaticRenderer` pattern.
 */
export function useStaticCanvas(): boolean {
  return false;
}
