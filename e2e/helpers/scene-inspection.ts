// scene-inspection.ts — drives the 3D inspection camera on a disk site
// (`/builder/<site>`) and reads what its performance depends on.
//
// The checks are shared: Narratives runs them on the canvas demo
// (e2e/specs/09-scene), and downstream layers run them on their own sites.
// Failure modes they cover, written before the code:
//   freeze never on during an orbit or a 3D pinch; never off at rest (blurry);
//   left on after leaving 3D; the grid left out of it (SCENE-PERF-001);
//   the floor still sized by the viewport's height (SCENE-PERF-002);
//   a full measure pass still running in 3D; no remeasure on exit, or one taken
//   through the rotation, so 2D overlays miss their nodes (SCENE-PERF-003).
//
// Opening a disk site lets the editor persist its 2D camera into the site's
// `_meta/page-camera.json` and touch `_revyme/project-meta.json`;
// `preserveSiteState` puts both back so a run leaves the checkout clean.

import fs from 'node:fs';
import path from 'node:path';
import type { CDPSession, Frame, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { Editor } from './editor';

const SANDBOX_PORT = ':5174';
/** The editor's DEV-only test hooks this file uses (src/ProjectLoader.tsx). */
type E2EHooks = { traceEntries(pattern: string): unknown[]; select(ids: string[]): void };
/** Longer than the freeze's rest delay (250 ms), so a released freeze has ended. */
const REST_MS = 600;
/** Wheel ticks per pinch direction: about what a trackpad pinch-in sends. */
const PINCH_TICKS = 40;

export function preserveSiteState(site: string): () => void {
  const files = ['_meta/page-camera.json', '_revyme/project-meta.json'].map((f) => path.resolve('sites', site, f));
  const saved = files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  return () => files.forEach((f, i) => {
    const before = saved[i];
    if (before) fs.writeFileSync(f, before);
    else if (fs.existsSync(f)) fs.rmSync(f);
  });
}

export async function openSite(page: Page, editor: Editor, site: string): Promise<Frame> {
  await page.addInitScript(() => localStorage.setItem('revyme-onboarding-completed', 'true'));
  await page.goto(`/builder/${site}`);
  await editor.waitForCanvas();
  await editor.settled();
  const frame = page.frames().find((f) => f.url().includes(SANDBOX_PORT));
  if (!frame) throw new Error('canvas sandbox frame not found');
  return frame;
}

const contentRoot = (editor: Editor) => editor.sandbox().locator('[data-content-root]');

/** Waits for every transition the enter/exit started (rotation, layer separation). */
async function settleTransitions(editor: Editor): Promise<void> {
  await contentRoot(editor).evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))));
}

export async function enter3d(page: Page, editor: Editor): Promise<void> {
  await page.getByTitle('Isometric view', { exact: true }).click();
  await expect(contentRoot(editor)).toHaveAttribute('data-scene-inspection', 'isometric');
  await expect(page.locator('.scene-axis-gizmo')).toBeVisible();
  await settleTransitions(editor);
  await page.waitForTimeout(REST_MS);
}

export async function exit3d(page: Page, editor: Editor): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(contentRoot(editor)).not.toHaveAttribute('data-scene-inspection');
  await expect(page.getByTitle('Isometric view', { exact: true })).toBeVisible();
  await editor.settled();
}

/** Centre of the canvas area left visible by the side panels. */
export async function canvasCentre(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-canvas-root]')!.getBoundingClientRect();
    const left = document.querySelector('[data-editor-panel="left-primary"]')?.getBoundingClientRect().right ?? host.left;
    const right = document.querySelector('[data-properties-panel]')?.getBoundingClientRect().left ?? host.right;
    return { x: (Math.max(left, host.left) + Math.min(right, host.right)) / 2, y: host.top + host.height / 2 };
  });
}

/** A trackpad pinch: ctrl+wheel, in then back out. */
export async function pinch(page: Page, at: { x: number; y: number }, ticks = PINCH_TICKS): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < ticks * 2; i++) await page.mouse.wheel(0, i < ticks ? -6 : 6);
  await page.keyboard.up('Control');
}

/** Presses on the axis gizmo and orbits; the press stays down until `release`. */
export async function startOrbit(page: Page, steps = 24): Promise<{ release: () => Promise<void> }> {
  const box = (await page.locator('.scene-axis-gizmo').boundingBox())!;
  const x = box.x + box.width / 2 + 2;
  const y = box.y + box.height / 2 + 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + i * 8, y + i * 2);
  return { release: () => page.mouse.up() };
}

/** Whether the 3D layers are frozen at their raster scale right now. */
export function freezeState(frame: Frame) {
  return frame.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-content-root]')!;
    const viewport = [...root.querySelectorAll<HTMLElement>('[data-viewport][data-node-id]')]
      .find((v) => getComputedStyle(v).visibility !== 'hidden');
    const node = viewport?.querySelector<HTMLElement>('[data-node-id] [data-node-id]') ?? null;
    const floor = root.querySelector<HTMLElement>(':scope > [data-scene-grid] > :not([data-scene-axis])');
    return {
      gesture: root.hasAttribute('data-scene-gesture'),
      node: node ? getComputedStyle(node).willChange : null,
      grid: floor ? getComputedStyle(floor).willChange : null,
    };
  });
}

/** Layouts run by the canvas renderer (the whole page when the sandbox shares its process). */
export async function layoutCounter(page: Page, frame: Frame): Promise<() => Promise<number>> {
  let session: CDPSession;
  try {
    session = await page.context().newCDPSession(frame);
  } catch {
    session = await page.context().newCDPSession(page);
  }
  await session.send('Performance.enable');
  return async () => {
    const { metrics } = await session.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0;
  };
}

/** The host's selection outline in page pixels: drawn from the host's rect cache, so it
 *  only lines up with the node when that cache holds the node's current 2D geometry. */
export function selectionOutlineBox(page: Page) {
  return page.evaluate(() => {
    const fade = document.querySelector('[data-selection-fade]');
    const svg = fade && [...fade.querySelectorAll(':scope > svg')].find((s) => s.querySelectorAll(':scope > line').length === 4);
    if (!svg) return null;
    const lines = [...svg.querySelectorAll('line')].map((l) => l.getBoundingClientRect());
    const x = Math.min(...lines.map((r) => r.left));
    const y = Math.min(...lines.map((r) => r.top));
    return { x, y, width: Math.max(...lines.map((r) => r.right)) - x, height: Math.max(...lines.map((r) => r.bottom)) - y };
  });
}

/** Full measure passes the sandbox ran (each emits one `allRects-measure` trace). */
export function measurePasses(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __e2e: E2EHooks }).__e2e.traceEntries('allRects-measure').length);
}

/** Defines the shared 3D-performance checks for one disk site. */
export function defineScenePerformanceSpecs(site: string, label: string): void {
  test.describe(`3D inspection performance on ${label}`, () => {
    let restore: () => void = () => {};
    test.beforeAll(() => { restore = preserveSiteState(site); });
    test.afterAll(() => restore());

    test(`SCENE-PERF-001 ${label}: orbit and pinch freeze the 3D raster scale, rest releases it`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      await enter3d(page, editor);
      const rested = await freezeState(frame);
      expect(rested.gesture, 'no freeze before the camera moves').toBe(false);
      expect(rested.node).toBe('auto');

      // F1 + G4: while the gizmo is dragged, every 3D layer and the grid keep their raster scale.
      const orbit = await startOrbit(page);
      await expect.poll(() => freezeState(frame)).toEqual({ gesture: true, node: 'transform', grid: 'transform' });
      await page.screenshot({ path: info.outputPath(`${site}-orbit-held.png`) });
      await orbit.release();
      // F3: at rest the layers re-raster at the scale they are seen at.
      await expect.poll(() => freezeState(frame), { timeout: 3_000 }).toEqual({ gesture: false, node: 'auto', grid: 'auto' });

      // F2: a pinch in 3D holds the freeze while the wheel runs and releases it after.
      const centre = await canvasCentre(page);
      await page.mouse.move(centre.x, centre.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -6);
      const duringPinch = await freezeState(frame);
      await page.keyboard.up('Control');
      expect(duringPinch.gesture, 'a 3D pinch freezes the raster scale').toBe(true);
      await expect.poll(() => freezeState(frame), { timeout: 3_000 }).toMatchObject({ gesture: false, node: 'auto' });
      await page.screenshot({ path: info.outputPath(`${site}-zoomed-rested.png`) });

      // F5: nothing of the freeze survives the exit, even a release armed just before it.
      const late = await startOrbit(page, 6);
      await late.release();
      await exit3d(page, editor);
      await page.waitForTimeout(REST_MS);
      const after = await frame.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-content-root]')!;
        const node = root.querySelector<HTMLElement>('[data-viewport] [data-node-id] [data-node-id]');
        return { gesture: root.hasAttribute('data-scene-gesture'), node: node ? getComputedStyle(node).willChange : null };
      });
      expect(after).toEqual({ gesture: false, node: 'auto' });
    });

    test(`SCENE-PERF-002 ${label}: the floor grid is sized by the viewport width, not its height`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      await enter3d(page, editor);
      const grid = await frame.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-content-root]')!;
        const viewport = [...root.querySelectorAll<HTMLElement>('[data-viewport][data-node-id]')]
          .find((v) => getComputedStyle(v).visibility !== 'hidden')!;
        const floor = root.querySelector<HTMLElement>(':scope > [data-scene-grid] > :not([data-scene-axis])')!;
        return {
          viewportWidth: viewport.offsetWidth,
          viewportHeight: viewport.offsetHeight,
          floor: parseFloat(floor.style.width),
          axes: root.querySelectorAll(':scope > [data-scene-grid] > [data-scene-axis]').length,
        };
      });
      await page.screenshot({ path: info.outputPath(`${site}-grid.png`) });
      // G1: the floor spans the page's width with a margin, never twice its height.
      expect(grid.floor).toBeGreaterThanOrEqual(grid.viewportWidth);
      expect(grid.floor).toBeLessThanOrEqual(Math.max(2 * grid.viewportWidth, 1600));
      expect(grid.floor).toBeLessThanOrEqual(4000);
      expect(grid.axes).toBe(3); // G3
    });

    test(`SCENE-PERF-003 ${label}: no full remeasure while inspecting, one on exit`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      const layouts = await layoutCounter(page, frame);
      const centre = await canvasCentre(page);

      // The same pinch in 2D is the yardstick.
      const before2d = await layouts();
      await pinch(page, centre);
      await page.waitForTimeout(REST_MS);
      const layouts2d = (await layouts()) - before2d;

      await enter3d(page, editor);
      const passes = await measurePasses(page);
      const before3d = await layouts();
      await pinch(page, centre);
      await startOrbit(page, 12).then((o) => o.release());
      await page.waitForTimeout(REST_MS);
      const layouts3d = (await layouts()) - before3d;
      // M1: no measure pass ran in 3D, and the canvas laid out about as often as in 2D.
      expect(await measurePasses(page), 'full measure passes while inspecting').toBe(passes);
      expect(layouts3d, `3D pinch layouts ${layouts3d} vs 2D ${layouts2d}`).toBeLessThan(layouts2d + 500);

      // M2/M3: leaving remeasures once, after the rotation is gone, so 2D overlays line up.
      await exit3d(page, editor);
      await expect.poll(() => measurePasses(page)).toBeGreaterThan(passes);
      const target = await frame.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[data-viewport][data-node-id]')!;
        const pick = [...viewport.children].find((el) => {
          const r = el.getBoundingClientRect();
          return el.getAttribute('data-id') && r.width > 40 && r.height > 20 && r.top >= 0 && r.top < innerHeight;
        });
        return pick?.getAttribute('data-id') ?? viewport.getAttribute('data-id');
      });
      await page.evaluate((id) => (window as unknown as { __e2e: E2EHooks }).__e2e.select([id!]), target);
      await editor.settled();
      const node = (await editor.nodeBox(target!))!;
      await expect.poll(async () => {
        const b = await selectionOutlineBox(page);
        if (!b) return Infinity;
        return Math.max(Math.abs(b.x - node.x), Math.abs(b.y - node.y), Math.abs(b.width - node.width), Math.abs(b.height - node.height));
      }, { message: 'the selection outline must match the node after leaving 3D' }).toBeLessThan(3);
      await page.screenshot({ path: info.outputPath(`${site}-after-exit-selection.png`) });
      await info.attach('measure-counts', {
        body: JSON.stringify({ site, layouts2d, layouts3d, target }, null, 2),
        contentType: 'application/json',
      });
    });
  });
}
