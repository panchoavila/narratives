// sandbox-state.ts — shared mutable state for the sandbox runtime modules.
// Extracted from bridge-sandbox.ts (Phase 7 split) so the handler modules
// (rect-emit, style-handlers, read-handlers, group-resize, placeholders) can
// read `contentRoot` / `currentSandboxTransform` and `emit` events without
// importing bridge-sandbox — which is what created the documented
// bridge-sandbox ↔ sandbox-code-host circular import. Reads use live ESM
// bindings; writes go through the exported setters (assigning to an imported
// binding is illegal).

import type { SandboxEvent } from '../protocol';
import { wrapEvent } from '../protocol';

export let contentRoot: HTMLElement | null = null;
export let currentSandboxTransform: { x: number; y: number; scale: number } = { x: 0, y: 0, scale: 1 };

export function setContentRoot(el: HTMLElement): void {
  contentRoot = el;
}

/** Epoch of the last render processed — echoed on allRects (stale rejection). */
export let currentRenderSeq: number | undefined = undefined;
export function setCurrentRenderSeq(seq: number | undefined): void {
  currentRenderSeq = seq;
}

export function setCurrentSandboxTransform(t: { x: number; y: number; scale: number }): void {
  currentSandboxTransform = t;
}

/** Full measure passes are deferred while the 3D inspection camera is on: every
 *  node then has a rotated ancestor, so a pass measures each one through 3D
 *  projection (marker elements and a forced layout per node) and ships rects the
 *  hidden 2D overlays cannot use. Leaving 3D resumes and measures once. */
export let measuresSuspended = false;
export function setMeasuresSuspended(suspended: boolean): void {
  measuresSuspended = suspended;
}

/** Send an event to the parent. Parent origin varies (3333 direct, 3000 proxy) — use '*'. */
export function emit(event: SandboxEvent): void {
  parent.postMessage(wrapEvent(event), '*');
}
