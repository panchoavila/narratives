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
type E2EHooks = {
  traceEntries(pattern: string): Array<{ category: string; data: unknown }>;
  select(ids: string[], vpId?: string): void;
  interactingViewport(): string;
};
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

// ─── 3D continues the 2D view (ENTRY-*) ─────────────────────────────────
// Failure modes, written before the code (Websites
// research/2026-11-25-3d-continuous-entry/FAILURE-MODES.md): the camera jumps on
// entry (C1); the pivot is not the point at the centre of the screen (C2) or
// moves after entry (C3); the header plane and the canvas disagree (C4); the
// grid follows the pivot (C5); an off-screen breakpoint gives an empty 3D
// view (C6); 3D shows another breakpoint than the one on screen (C7); a centre
// outside every breakpoint (C8); exit restores the pre-entry camera (C9);
// re-entry reuses the old pivot (C10); a double click or Escape during entry
// leaves 3D half on (C11); switching breakpoint in 3D does not reframe (C12);
// entering 3D changes where edits go (C14); a re-entry during the exit
// animation moves the pivot while the plane is still turned (C15).
//
// The probe is a 2x2 element inside the scene root at a scene point. It is not
// a canvas node, so layer separation never moves it: only the camera and the
// plane's rotation do, which is exactly what the view continuity is about.

/** Largest on-screen drift of the point being looked at, in CSS px. */
const DRIFT_PX = 2;
/** How long to sample the probe after a click on the 3D toggle or Escape. */
const SAMPLE_MS = 900;

interface SceneViewportBox { id: string; x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }

/** The breakpoints in scene coordinates, read from the sandbox DOM. A breakpoint
 *  off screen is culled (display:none); its placeholder keeps its exact box. */
function sceneViewports(frame: Frame): Promise<SceneViewportBox[]> {
  return frame.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-content-root] > [data-viewport][data-node-id]')]
    .map((el) => {
      const id = el.dataset.viewport!;
      const ph = document.querySelector<HTMLElement>(`[data-content-root] > [data-culling-placeholder="${id}"]`);
      return {
        id,
        x: parseFloat(el.style.left) || el.offsetLeft,
        y: parseFloat(el.style.top) || el.offsetTop,
        width: el.offsetWidth || parseFloat(ph?.style.width ?? '') || parseFloat(el.style.width) || 0,
        height: el.offsetHeight || parseFloat(ph?.style.height ?? '') || 0,
      };
    }));
}

/** The breakpoint 3D shows: the one not hidden by the inspection CSS. */
function shownViewport(frame: Frame): Promise<string | null> {
  return frame.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-content-root] > [data-viewport][data-node-id]')]
    .find((el) => getComputedStyle(el).visibility !== 'hidden')?.dataset.viewport ?? null);
}

/** The 2D camera as the sandbox applies it (translate3d + scale on `[data-canvas-camera]`). */
function cameraTransform(frame: Frame): Promise<string> {
  return frame.evaluate(() => document.querySelector<HTMLElement>('[data-content-root]')!.parentElement!.style.transform);
}

/** 2D scene -> page mapping, from two probes at scene (0,0) and (1000,0): never
 *  culled, unlike a breakpoint. Valid only while the plane is flat. */
async function sceneMapping(frame: Frame): Promise<{ s: number; ox: number; oy: number }> {
  await addProbe(frame, 'map-a', { x: 0, y: 0 });
  await addProbe(frame, 'map-b', { x: 1000, y: 0 });
  const a = await probeAt(frame, 'map-a'), b = await probeAt(frame, 'map-b');
  await frame.evaluate(() => document.querySelectorAll('[data-e2e-probe^="map-"]').forEach((el) => el.remove()));
  return { s: (b.x - a.x) / 1000, ox: a.x, oy: a.y };
}

async function sceneAtPage(frame: Frame, p: Point): Promise<Point> {
  const m = await sceneMapping(frame);
  return { x: (p.x - m.ox) / m.s, y: (p.y - m.oy) / m.s };
}

/** Pans (plain wheel) until the scene point `target` sits at the canvas centre. */
async function panSceneTo(page: Page, frame: Frame, target: Point): Promise<void> {
  const centre = await canvasCentre(page);
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 12; i++) {
    const m = await sceneMapping(frame);
    const dx = m.ox + target.x * m.s - centre.x, dy = m.oy + target.y * m.s - centre.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    await page.mouse.wheel(Math.max(-600, Math.min(600, dx)), Math.max(-600, Math.min(600, dy)));
    await page.waitForTimeout(80);
  }
  throw new Error(`could not pan scene point ${JSON.stringify(target)} to the canvas centre`);
}

/** A trackpad pinch in one direction only, at the canvas centre. */
async function zoomAtCentre(page: Page, ticks: number): Promise<void> {
  const centre = await canvasCentre(page);
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < Math.abs(ticks); i++) await page.mouse.wheel(0, ticks > 0 ? -6 : 6);
  await page.keyboard.up('Control');
  await page.waitForTimeout(REST_MS);
}

async function addProbe(frame: Frame, name: string, p: Point): Promise<void> {
  await frame.evaluate(({ name, p }) => {
    const probe = document.createElement('div');
    probe.dataset.e2eProbe = name;
    probe.style.cssText = `position:absolute;left:${p.x - 1}px;top:${p.y - 1}px;width:2px;height:2px;pointer-events:none;`;
    document.querySelector('[data-content-root]')!.appendChild(probe);
  }, { name, p });
}

function removeProbes(frame: Frame): Promise<void> {
  return frame.evaluate(() => document.querySelectorAll('[data-e2e-probe]').forEach((el) => el.remove()));
}

async function probeAt(frame: Frame, name: string): Promise<Point> {
  const b = (await frame.locator(`[data-e2e-probe="${name}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Samples the probe for `ms`; one screenshot about halfway through the animation. */
async function sampleProbe(page: Page, frame: Frame, name: string, ms: number, shot?: string): Promise<Array<Point & { t: number }>> {
  const samples: Array<Point & { t: number }> = [];
  const start = Date.now();
  let shotTaken = !shot;
  while (Date.now() - start < ms) {
    samples.push({ t: Date.now() - start, ...(await probeAt(frame, name)) });
    if (!shotTaken && Date.now() - start > 140) { shotTaken = true; await page.screenshot({ path: shot! }); }
  }
  return samples;
}

/** Samples several probes together for `ms`. */
async function sampleProbes(frame: Frame, names: string[], ms: number): Promise<Record<string, Point[]>> {
  const out: Record<string, Point[]> = Object.fromEntries(names.map((n) => [n, []]));
  const start = Date.now();
  while (Date.now() - start < ms) for (const n of names) out[n].push(await probeAt(frame, n));
  return out;
}

const interacting = (page: Page) => page.evaluate(() => (window as unknown as { __e2e: E2EHooks }).__e2e.interactingViewport());
const traceCount = (page: Page, pattern: string) => page.evaluate((p) => (window as unknown as { __e2e: E2EHooks }).__e2e.traceEntries(p).length, pattern);

const drift = (samples: Point[], from: Point) => Math.max(0, ...samples.map((p) => Math.hypot(p.x - from.x, p.y - from.y)));

/** The plane's pivot, read from the scene root, and the host header plane's. */
async function pivots(page: Page, frame: Frame): Promise<{ scene: Point; headers: Point | null }> {
  const parse = (v: string) => { const [x, y] = v.split(' ').map(parseFloat); return { x, y }; };
  const scene = parse(await frame.evaluate(() => document.querySelector<HTMLElement>('[data-content-root]')!.style.transformOrigin));
  const headers = await page.evaluate(() => document.querySelector<HTMLElement>('[data-viewport-header-plane]')?.style.transformOrigin ?? '');
  return { scene, headers: headers ? parse(headers) : null };
}

/** Clicks the 3D toggle and samples the probe while the view turns. */
async function enter3dWatching(page: Page, editor: Editor, frame: Frame, probe: string, shot?: string) {
  await page.getByTitle('Isometric view', { exact: true }).click();
  const samples = await sampleProbe(page, frame, probe, SAMPLE_MS, shot);
  await expect(contentRoot(editor)).toHaveAttribute('data-scene-inspection', 'isometric');
  await settleTransitions(editor);
  await page.waitForTimeout(REST_MS);
  return samples;
}

/** Presses Escape and samples the probe while the view flattens. */
async function exit3dWatching(page: Page, editor: Editor, frame: Frame, probe: string) {
  await page.keyboard.press('Escape');
  const samples = await sampleProbe(page, frame, probe, SAMPLE_MS);
  await expect(contentRoot(editor)).not.toHaveAttribute('data-scene-inspection');
  await editor.settled();
  return samples;
}

/** Defines the "3D continues the 2D view" checks for one disk site. */
export function defineSceneEntrySpecs(site: string, label: string): void {
  test.describe(`3D continues the 2D view on ${label}`, () => {
    let restore: () => void = () => {};
    test.beforeAll(() => { restore = preserveSiteState(site); });
    test.afterAll(() => restore());

    test(`ENTRY-001 ${label}: the point at the centre stays put through entry, orbit, zoom and exit`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      const [first] = await sceneViewports(frame);
      // Look at part of the first breakpoint, zoomed in, away from its centre.
      const target = { x: first.x + Math.min(400, first.width * 0.3), y: first.y + Math.min(300, first.height * 0.2) };
      await page.evaluate(([vp]) => (window as unknown as { __e2e: E2EHooks }).__e2e.select([], vp), [first.id]);
      await panSceneTo(page, frame, target);
      await zoomAtCentre(page, 12);
      const centre = await canvasCentre(page);
      const looked = await sceneAtPage(frame, centre);
      await addProbe(frame, 'centre', looked);
      const before = await probeAt(frame, 'centre');
      const camera2d = await cameraTransform(frame);
      const scale2d = (await sceneMapping(frame)).s;
      await page.screenshot({ path: info.outputPath(`${site}-entry-0-before.png`) });

      // C1 + C2: entry keeps the camera and turns about the point being looked at.
      const entering = await enter3dWatching(page, editor, frame, 'centre', info.outputPath(`${site}-entry-1-mid.png`));
      await page.screenshot({ path: info.outputPath(`${site}-entry-2-settled.png`) });
      const camera3d = await cameraTransform(frame);
      const p3d = await pivots(page, frame);
      const grid = await frame.evaluate(() => {
        const g = document.querySelector<HTMLElement>('[data-content-root] > [data-scene-grid]')!;
        return { left: parseFloat(g.style.left), top: parseFloat(g.style.top) };
      });
      const shown = await shownViewport(frame);
      const shownBox = (await sceneViewports(frame)).find((v) => v.id === shown)!;

      // C3: an orbit, a 3D zoom and a selection change leave the pivot where it is.
      const orbit = await startOrbit(page, 12);
      const orbiting = await sampleProbe(page, frame, 'centre', 300);
      await orbit.release();
      await page.waitForTimeout(REST_MS);
      await zoomAtCentre(page, 10);
      const firstNode = await frame.evaluate((id) => document.querySelector(`[data-content-root] > [data-viewport="${id}"][data-node-id]`)!.getAttribute('data-id')!, first.id);
      await page.evaluate(([id]) => (window as unknown as { __e2e: E2EHooks }).__e2e.select([id]), [firstNode]);
      await page.waitForTimeout(REST_MS);
      const pAfter = await pivots(page, frame);
      const zoomed3d = await probeAt(frame, 'centre');
      await page.screenshot({ path: info.outputPath(`${site}-entry-3-orbited-zoomed.png`) });

      // C9: exit flattens in place and keeps the 3D zoom.
      const exiting = await exit3dWatching(page, editor, frame, 'centre');
      const scaleAfter = (await sceneMapping(frame)).s;
      const after = await probeAt(frame, 'centre');
      await page.screenshot({ path: info.outputPath(`${site}-entry-4-after-exit.png`) });
      await removeProbes(frame);

      const summary = {
        site, viewport: first.id, looked, centre, before, camera2d, camera3d, scale2d, scaleAfter,
        entryDrift: drift(entering, before), orbitDrift: drift(orbiting, before), exitDrift: drift(exiting, zoomed3d),
        pivotEntry: p3d, pivotAfterOrbitZoomSelect: pAfter, grid, shown,
        samples: { entering, orbiting, exiting },
      };
      fs.writeFileSync(info.outputPath(`${site}-entry-001.json`), JSON.stringify(summary, null, 2));
      await info.attach('entry-001', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });

      expect(Math.hypot(before.x - centre.x, before.y - centre.y), 'the probe starts at the canvas centre').toBeLessThan(DRIFT_PX);
      expect(camera3d, 'C1: entry keeps the 2D camera').toBe(camera2d);
      expect(shown, 'the breakpoint on screen is the one shown in 3D').toBe(first.id);
      expect(summary.entryDrift, 'C2: the point looked at stays put while the view turns').toBeLessThan(DRIFT_PX);
      expect(Math.abs(p3d.scene.x - looked.x) + Math.abs(p3d.scene.y - looked.y), 'C2: the pivot is the point looked at').toBeLessThan(1);
      expect(p3d.headers, 'C4: the header plane turns about the same pivot').toEqual(p3d.scene);
      expect(Math.abs(grid.left - (shownBox.x + shownBox.width / 2)) + Math.abs(grid.top - (shownBox.y + shownBox.height / 2)), 'C5: the grid stays centred on the breakpoint').toBeLessThan(1);
      expect(summary.orbitDrift, 'C3: the pivot holds through an orbit').toBeLessThan(DRIFT_PX);
      expect(pAfter.scene, 'C3: orbit, zoom and selection keep the entry pivot').toEqual(p3d.scene);
      expect(summary.exitDrift, 'C9: the point stays put while the view flattens').toBeLessThan(DRIFT_PX);
      expect(scaleAfter / scale2d, 'C9: exit keeps the zoom done in 3D').toBeGreaterThan(1.1);
      expect(Math.hypot(after.x - zoomed3d.x, after.y - zoomed3d.y), 'C9: no jump after exit').toBeLessThan(DRIFT_PX);
    });

    test(`ENTRY-002 ${label}: 3D shows the breakpoint on screen, and re-entry turns about the new centre`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      const viewports = await sceneViewports(frame);
      test.skip(viewports.length < 2, 'needs two breakpoints');
      const results: Array<Record<string, unknown>> = [];
      // The click stays in the first breakpoint; the screen moves to the others.
      await page.evaluate(([vp]) => (window as unknown as { __e2e: E2EHooks }).__e2e.select([], vp), [viewports[0].id]);
      for (const vp of viewports.slice(1, 3)) {
        const target = { x: vp.x + vp.width / 2, y: vp.y + Math.min(300, vp.height / 2) };
        await panSceneTo(page, frame, target);
        const looked = await sceneAtPage(frame, await canvasCentre(page));
        await addProbe(frame, vp.id, looked);
        const before = await probeAt(frame, vp.id);
        const entering = await enter3dWatching(page, editor, frame, vp.id);
        const shown = await shownViewport(frame);
        await page.screenshot({ path: info.outputPath(`${site}-entry-002-${vp.id}.png`) });
        const editingIn3d = await interacting(page);
        await exit3d(page, editor);
        const editingAfter = await interacting(page);
        results.push({ viewport: vp.id, shown, looked, entryDrift: drift(entering, before), editingIn3d, editingAfter });
        await removeProbes(frame);
        expect(editingAfter, `C14: leaving 3D gives edits back to ${viewports[0].id}`).toBe(viewports[0].id);
        // C7 + C10: the breakpoint under the centre, turned about the new centre.
        expect(shown, `C7: 3D shows ${vp.id}, the breakpoint on screen`).toBe(vp.id);
        expect(drift(entering, before), `C10: re-entry turns about the new centre (${vp.id})`).toBeLessThan(DRIFT_PX);
      }
      fs.writeFileSync(info.outputPath(`${site}-entry-002.json`), JSON.stringify(results, null, 2));
    });

    test(`ENTRY-003 ${label}: off screen reframes, a centre between breakpoints clamps, a double click stays 2D, a breakpoint switch reframes`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      const viewports = await sceneViewports(frame);
      const [first] = viewports;
      const area = async () => {
        const c = await canvasCentre(page);
        const host = (await page.locator('[data-canvas-root]').boundingBox())!;
        return { left: c.x - 200, right: c.x + 200, top: host.y, bottom: host.y + host.height };
      };
      const report: Record<string, unknown> = { site };

      // C6: nothing on screen -> 3D reframes to the breakpoint instead of an empty view.
      await page.evaluate(([vp]) => (window as unknown as { __e2e: E2EHooks }).__e2e.select([], vp), [first.id]);
      const host = (await page.locator('[data-canvas-root]').boundingBox())!;
      const m = await sceneMapping(frame);
      // 1.2 screens up and left of the breakpoint's corner: nothing of it is on screen.
      await panSceneTo(page, frame, { x: first.x - 1.2 * host.width / m.s, y: first.y - 1.2 * host.height / m.s });
      await enter3d(page, editor);
      const shown = await shownViewport(frame);
      const box = (await frame.locator(`[data-content-root] > [data-viewport="${shown}"][data-node-id]`).boundingBox())!;
      const a = await area();
      report.offscreen = { shown, box, area: a };
      await page.screenshot({ path: info.outputPath(`${site}-entry-003-offscreen.png`) });
      await exit3d(page, editor);
      expect(box.x < a.right && box.x + box.width > a.left && box.y < a.bottom && box.y + box.height > a.top, 'C6: the breakpoint is on screen after entry').toBe(true);

      // C8: the centre between two breakpoints -> the pivot is the nearest point of the chosen one.
      const right = viewports.find((v) => v.x > first.x + first.width);
      if (right) {
        const y = first.y + Math.min(300, first.height / 2, right.height / 2);
        await panSceneTo(page, frame, { x: (first.x + first.width + right.x) / 2, y });
        await addProbe(frame, 'left-edge', { x: first.x + first.width, y });
        await addProbe(frame, 'right-edge', { x: right.x, y });
        const edges = { [first.id]: await probeAt(frame, 'left-edge'), [right.id]: await probeAt(frame, 'right-edge') };
        await page.getByTitle('Isometric view', { exact: true }).click();
        const both = await sampleProbes(frame, ['left-edge', 'right-edge'], SAMPLE_MS);
        await settleTransitions(editor);
        const chosen = await shownViewport(frame);
        const pivot = (await pivots(page, frame)).scene;
        const leftSamples = both['left-edge'], rightSamples = both['right-edge'];
        await page.screenshot({ path: info.outputPath(`${site}-entry-003-gap.png`) });
        await exit3d(page, editor);
        await removeProbes(frame);
        const held = chosen === first.id ? drift(leftSamples, edges[first.id]) : drift(rightSamples, edges[right.id]);
        report.gap = { chosen, pivot, held };
        expect([first.id, right.id], 'C8: a breakpoint next to the centre is chosen').toContain(chosen);
        expect(pivot.x, 'C8: the pivot is that breakpoint\'s nearest edge').toBeCloseTo(chosen === first.id ? first.x + first.width : right.x, 0);
        expect(held, 'C8: the clamped point stays put').toBeLessThan(DRIFT_PX);
      }

      // C11: two clicks in one task (the second lands while the first entry is
      // still measuring) cancel it; so does Escape during that wait.
      const cancelledBefore = await traceCount(page, 'scene-composer:entry-cancelled');
      await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('[title="Isometric view"]')!;
        button.click(); button.click();
      });
      await page.waitForTimeout(SAMPLE_MS + REST_MS);
      const afterDouble = await contentRoot(editor).getAttribute('data-scene-inspection');
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('[title="Isometric view"]')!.click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await page.waitForTimeout(SAMPLE_MS + REST_MS);
      const afterEscape = await contentRoot(editor).getAttribute('data-scene-inspection');
      const cancelled = (await traceCount(page, 'scene-composer:entry-cancelled')) - cancelledBefore;
      report.cancel = { afterDouble, afterEscape, cancelled };
      expect(afterDouble, 'C11: a double click does not leave 3D on').toBeNull();
      expect(afterEscape, 'C11: Escape during the entry keeps 2D').toBeNull();
      expect(cancelled, 'C11: both went through the cancel path').toBe(2);

      // C12: switching breakpoint while in 3D reframes to it, pivot at its centre.
      const other = viewports.find((v) => v.id !== first.id);
      if (other) {
        await panSceneTo(page, frame, { x: first.x + first.width / 2, y: first.y + Math.min(300, first.height / 2) });
        await enter3d(page, editor);
        await page.evaluate(([vp]) => (window as unknown as { __e2e: E2EHooks }).__e2e.select([], vp), [other.id]);
        await expect.poll(() => shownViewport(frame)).toBe(other.id);
        await settleTransitions(editor);
        await page.waitForTimeout(REST_MS);
        const pivot = (await pivots(page, frame)).scene;
        // Measured now: a culled breakpoint's placeholder can be larger than its tile.
        const live = (await sceneViewports(frame)).find((v) => v.id === other.id)!;
        const otherBox = (await frame.locator(`[data-content-root] > [data-viewport="${other.id}"][data-node-id]`).boundingBox())!;
        const a2 = await area();
        await page.screenshot({ path: info.outputPath(`${site}-entry-003-switch.png`) });
        await exit3d(page, editor);
        report.switch = { other: other.id, pivot, otherBox };
        expect(Math.abs(pivot.x - (live.x + live.width / 2)) + Math.abs(pivot.y - (live.y + live.height / 2)), 'C12: pivot at the new breakpoint\'s centre').toBeLessThan(1);
        expect(otherBox.x < a2.right && otherBox.x + otherBox.width > a2.left, 'C12: the new breakpoint is framed').toBe(true);
      }
      // C15: Escape and an immediate re-entry, after a pan in 3D moved the camera.
      await enter3d(page, editor);
      const centre = await canvasCentre(page);
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.wheel(240, 120);
      await page.waitForTimeout(REST_MS);
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.querySelector<HTMLElement>('[title="Isometric view"]')!.click());
      await expect(contentRoot(editor)).toHaveAttribute('data-scene-inspection', 'isometric');
      await settleTransitions(editor);
      const order = await page.evaluate(() => (window as unknown as { __e2e: E2EHooks }).__e2e
        .traceEntries('scene-composer:(mode|entry)$').map((e) => e.category));
      report.reentry = { order: order.slice(-4) };
      await page.screenshot({ path: info.outputPath(`${site}-entry-003-reentry.png`) });
      await exit3d(page, editor);
      // An exit cut short by a new entry never logs its settle, so the last two
      // must be this exit settling, then the re-entry.
      expect(order.slice(-2), 'C15: the re-entry starts after the exit has flattened the plane').toEqual(['scene-composer:mode', 'scene-composer:entry']);

      fs.writeFileSync(info.outputPath(`${site}-entry-003.json`), JSON.stringify(report, null, 2));
    });
  });
}

// ─── Clipping in 3D (CLIP-*) ────────────────────────────────────────────
// Failure modes, written before the code (Websites
// research/2026-11-27-3d-clipping/FAILURE-MODES.md):
//   K1/K2   a leaf (photo, ellipsis text) paints past its own box, or loses depth;
//   K3/K4   a leaf a container cropped in 2D spills in 3D, or the fix flattens;
//   K6/K7   nested clippers intersect, and a leaf outside its clipper is hidden;
//   K8/K9   an authored clip-path is kept, and a turned leaf is left alone;
//   K11/K12 a render in 3D re-applies the crops, and exit leaves nothing behind;
//   K15     a breakpoint that crops in 2D crops its leaves in 3D.
// The fixture is a set of canvas nodes inserted into the active breakpoint, in 2D.
// No site source changes, and it is removed at the end.

const SVG_PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#e33"/><rect x="250" width="100" height="300" fill="#3a3"/></svg>');

/** Card at (40,40) in the breakpoint, 300x200, overflow hidden. Comments give each node's box in card coordinates. */
function clipFixture(photo: string, edgeLeft: number): string {
  const n = (id: string, style: string, tag = 'div', inner = '') =>
    `<${tag} data-node-id="${id}" data-id="${id}" style="${style}"${tag === 'img' ? ` src="${photo}" alt=""` : ''}>${inner}</${tag}>`;
  return n('e2e-card', 'position:absolute;left:40px;top:40px;width:300px;height:200px;overflow:hidden;background:#fff;z-index:9999', 'div', [
    n('e2e-photo', 'position:absolute;left:-150px;top:-50px;width:600px;height:300px;margin:0', 'img'), // B: 150 | 50 past each side
    n('e2e-cover', 'position:absolute;left:10px;top:10px;width:100px;height:100px;object-fit:cover;margin:0', 'img'), // A
    n('e2e-text', 'position:absolute;left:200px;top:150px;width:300px;height:20px;margin:0;font:14px/20px sans-serif', 'p', 'text past the card edge'), // B: 200 right
    n('e2e-inner', 'position:absolute;left:150px;top:20px;width:120px;height:120px;overflow:hidden;background:#ddd', 'div',
      n('e2e-nested', 'position:absolute;left:60px;top:60px;width:200px;height:200px;background:#33a')), // K6: (210..410, 80..280) in card
    n('e2e-outside', 'position:absolute;left:400px;top:0;width:50px;height:50px;background:#a3a'), // K7
    n('e2e-turned', 'position:absolute;left:250px;top:150px;width:100px;height:100px;background:#aa3;transform:rotate(20deg)'), // K9
    n('e2e-authored', 'position:absolute;left:-30px;top:120px;width:100px;height:100px;background:#3aa;clip-path:circle(40%)'), // K8
    n('e2e-ellipsis', 'position:absolute;left:10px;top:120px;width:80px;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:14px/20px sans-serif', 'p', 'a long line that the box cuts'), // A
  ].join('')) +
    n('e2e-free', 'position:absolute;left:140px;top:300px;width:100px;height:100px;overflow:visible;background:#eee', 'div',
      n('e2e-free-child', 'position:absolute;left:-50px;top:0;width:100px;height:50px;background:#333')) + // K3: never cropped
    n('e2e-edge', `position:absolute;left:${edgeLeft}px;top:300px;width:200px;height:50px;background:#f80`); // K15: 150 past the breakpoint
}

/** clip-path as computed: inset(t r b l) in px, or the raw value. */
function parseInset(v: string): number[] | string {
  const m = /^inset\(([^)]*)\)$/.exec(v.trim());
  if (!m) return v;
  const parts = m[1].split(/\s+/).map((p) => (p.endsWith('%') ? p : parseFloat(p)));
  if (parts.some((p) => typeof p === 'string')) return v;
  const [t, r = t, b = t, l = r] = parts as number[];
  return [t, r, b, l].map((x) => Math.round(x));
}

async function nodeState(frame: Frame, ids: string[]) {
  return frame.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const el = document.querySelector<HTMLElement>(`[data-content-root] [data-id="${id}"]`);
    if (!el) return [id, null];
    const cs = getComputedStyle(el);
    return [id, { overflow: cs.overflow, clipPath: cs.clipPath, mark: el.getAttribute('data-scene-clip') }];
  })), ids);
}

/** Whether `id` still rises in 3D: dropping its lift must move it on screen. */
async function depthLive(frame: Frame, id: string): Promise<{ live: boolean; dx: number; dy: number }> {
  return frame.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-content-root] [data-id="${id}"]`)!;
    // Nodes animate `translate` (320 ms): without this the read returns the old value.
    el.style.setProperty('transition', 'none', 'important');
    const lifted = el.getBoundingClientRect();
    el.style.setProperty('translate', 'none', 'important');
    const flat = el.getBoundingClientRect();
    el.style.removeProperty('translate');
    el.getBoundingClientRect();
    el.style.removeProperty('transition');
    const dx = lifted.x - flat.x, dy = lifted.y - flat.y;
    return { live: Math.abs(dx) + Math.abs(dy) > 1, dx, dy };
  }, id);
}

/** Leaves a container crops in 2D, in the active breakpoint (same rules as the code: no turned boxes,
 *  no authored clip-path, nothing spatial). Read in 2D, before entry. */
function croppedLeaves2d(frame: Frame, viewportId: string): Promise<string[]> {
  return frame.evaluate((vpId) => {
    const vp = [...document.querySelectorAll<HTMLElement>('[data-content-root] > [data-viewport][data-node-id]')].find((v) => v.dataset.viewport === vpId)!;
    const replaced = 'img, video, canvas, iframe, embed, object, svg';
    const leaf = (el: Element) => el.matches(replaced) || !el.querySelector('[data-node-id]');
    const turned = (el: Element) => { const cs = getComputedStyle(el); return (cs.rotate && cs.rotate !== 'none') || (cs.transform !== 'none' && !/^matrix\([^,]+, 0, 0,/.test(cs.transform)); };
    const crops = (el: Element) => { const cs = getComputedStyle(el); return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'; };
    const out: string[] = [];
    for (const el of [vp, ...vp.querySelectorAll<HTMLElement>('[data-node-id]')]) {
      if (!leaf(el) || el.closest('[data-revyme-spatial-surface]') || getComputedStyle(el).clipPath !== 'none' || turned(el)) continue;
      if (el.tagName.toLowerCase() !== 'svg' && el.closest('svg') && el.closest('svg') !== el) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      for (let a = el.parentElement; a && a.hasAttribute('data-node-id'); a = a.parentElement) {
        if (turned(a)) break;
        if (leaf(a) || !crops(a) || a.querySelector('[data-revyme-spatial-surface]')) continue;
        const c = a.getBoundingClientRect();
        if (r.left < c.left - 1 || r.top < c.top - 1 || r.right > c.right + 1 || r.bottom > c.bottom + 1) { out.push(el.getAttribute('data-id') ?? '?'); break; }
      }
    }
    return out;
  }, viewportId);
}

/** Defines the "3D keeps the 2D crops" checks for one disk site. `pages` are extra page
 *  files (opened with the E2E hook) whose real content is checked too. */
export function defineSceneClipSpecs(site: string, label: string, pages: string[] = []): void {
  test.describe(`3D keeps the 2D crops on ${label}`, () => {
    let restore: () => void = () => {};
    test.beforeAll(() => { restore = preserveSiteState(site); });
    test.afterAll(() => restore());

    test(`CLIP-001 ${label}: photos, text and nested crops hold in 3D without flattening`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
      const frame = await openSite(page, editor, site);
      const vpId = await page.evaluate(() => (window as unknown as { __e2e: E2EHooks }).__e2e.interactingViewport());
      const vpBox = (await sceneViewports(frame)).find((v) => v.id === vpId)!;
      const vpCrops = await frame.evaluate((id) => getComputedStyle(document.querySelector<HTMLElement>(`[data-content-root] > [data-viewport="${id}"][data-node-id]`)!).overflow, vpId);
      await frame.evaluate(({ id, html }) => {
        document.querySelector<HTMLElement>(`[data-content-root] > [data-viewport="${id}"][data-node-id]`)!.insertAdjacentHTML('beforeend', html);
      }, { id: vpId, html: clipFixture(SVG_PHOTO, vpBox.width - 50) });
      const ids = ['e2e-card', 'e2e-photo', 'e2e-cover', 'e2e-text', 'e2e-inner', 'e2e-nested', 'e2e-outside', 'e2e-turned', 'e2e-authored', 'e2e-ellipsis', 'e2e-free-child', 'e2e-edge'];
      const before = await nodeState(frame, ids);
      await panSceneTo(page, frame, { x: vpBox.x + 190, y: vpBox.y + 200 });
      await page.screenshot({ path: info.outputPath(`${site}-clip-2d.png`) });

      await enter3d(page, editor);
      const in3d = await nodeState(frame, ids);
      const depth = { card: await depthLive(frame, 'e2e-card'), photo: await depthLive(frame, 'e2e-photo'), cover: await depthLive(frame, 'e2e-cover'), inner: await depthLive(frame, 'e2e-inner'), nested: await depthLive(frame, 'e2e-nested'), text: await depthLive(frame, 'e2e-text') };
      await page.screenshot({ path: info.outputPath(`${site}-clip-3d.png`) });

      // K11: a render may strip the marks; the next update (a selection) writes them back.
      await frame.evaluate(() => document.querySelectorAll('[data-scene-clip]').forEach((el) => el.removeAttribute('data-scene-clip')));
      await page.evaluate(() => (window as unknown as { __e2e: E2EHooks }).__e2e.select(['e2e-card']));
      await expect.poll(async () => (await nodeState(frame, ['e2e-photo']))['e2e-photo']?.mark ?? null).not.toBeNull();
      const reapplied = await nodeState(frame, ['e2e-photo', 'e2e-text']);

      await exit3d(page, editor);
      const after = await nodeState(frame, ids);
      const leftovers = await frame.evaluate(() => ({ marks: document.querySelectorAll('[data-scene-clip]').length, style: !!document.getElementById('revyme-scene-clips') }));
      await frame.evaluate(() => document.querySelectorAll('[data-id^="e2e-"]').forEach((el) => { if (!el.parentElement?.closest('[data-id^="e2e-"]')) el.remove(); }));

      const summary = { site, viewport: vpId, viewportOverflow: vpCrops, before, in3d, depth, reapplied, after, leftovers };
      fs.writeFileSync(info.outputPath(`${site}-clip-001.json`), JSON.stringify(summary, null, 2));
      const inset = (id: string) => parseInset(in3d[id]!.clipPath);

      expect(in3d['e2e-cover']!.overflow, 'K1: a photo keeps its own crop').toBe('clip');
      expect(in3d['e2e-ellipsis']!.overflow, 'K1: a text leaf keeps its own crop').toBe('hidden');
      expect(depth.cover.live, 'K2: the photo still rises').toBe(true);
      expect(in3d['e2e-card']!.overflow, 'K4: the container stays visible, so its children keep depth').toBe('visible');
      expect(depth.photo.live && depth.nested.live, 'K4: cropped leaves still rise').toBe(true);
      expect(inset('e2e-photo'), 'K3: the photo is cut to the card').toEqual([50, 150, 50, 150]);
      expect(inset('e2e-text'), 'K3: the text is cut at the card edge').toEqual([0, 200, 0, 0]);
      expect(inset('e2e-nested'), 'K6: nested crops intersect').toEqual([0, 140, 140, 0]);
      expect(in3d['e2e-outside']!.clipPath, 'K7: a leaf outside its card is hidden').toMatch(/^inset\(50%/);
      expect(in3d['e2e-turned']!.mark, 'K9: a turned leaf is left alone').toBeNull();
      expect(in3d['e2e-authored']!.clipPath, 'K8: an authored clip-path is kept').toBe(before['e2e-authored']!.clipPath);
      expect(in3d['e2e-free-child']!.mark, 'K3: a leaf nothing crops is not cut').toBeNull();
      if (vpCrops !== 'visible') expect(inset('e2e-edge'), 'K15: a cropping breakpoint cuts its leaves').toEqual([0, 150, 0, 0]);
      else expect(in3d['e2e-edge']!.mark, 'K15: a breakpoint that does not crop cuts nothing').toBeNull();
      expect(reapplied['e2e-photo']!.mark, 'K11: the marks come back after an update').not.toBeNull();
      expect(after['e2e-photo']!.clipPath, 'K12: no crop survives exit').toBe('none');
      expect(after['e2e-card']!.overflow, 'K12: the card crops again in 2D').toBe('hidden');
      expect(leftovers, 'K12: no mark or stylesheet survives exit').toEqual({ marks: 0, style: false });
    });

    for (const file of ['', ...pages]) {
      const pageLabel = file || 'the home page';
      test(`CLIP-002 ${label}, ${pageLabel}: every leaf a container crops in 2D is cut in 3D, every leaf keeps its own crop`, { tag: ['@p1', '@scene'] }, async ({ page, editor }, info) => {
        const frame = await openSite(page, editor, site);
        if (file) {
          await page.evaluate((f) => (window as unknown as { __e2e: { openFile(p: string): void } }).__e2e.openFile(f), file);
          await editor.settled();
          await frame.locator('[data-content-root] > [data-viewport][data-node-id]').first().waitFor({ state: 'attached' });
          await page.waitForTimeout(REST_MS);
        }
        const vpId = await page.evaluate(() => (window as unknown as { __e2e: E2EHooks }).__e2e.interactingViewport());
        const cropped = await croppedLeaves2d(frame, vpId);
        const ownCrop2d = await frame.evaluate((id) => [...document.querySelectorAll<HTMLElement>(`[data-content-root] > [data-viewport="${id}"] img[data-node-id]`)]
          .map((el) => getComputedStyle(el).overflow), vpId);
        await enter3d(page, editor);
        const marked = await frame.evaluate((ids) => ids.filter((id) => [...document.querySelectorAll(`[data-content-root] [data-id="${id}"]`)].some((el) => el.hasAttribute('data-scene-clip'))), cropped);
        const ownCrop3d = await frame.evaluate((id) => [...document.querySelectorAll<HTMLElement>(`[data-content-root] > [data-viewport="${id}"] img[data-node-id]`)]
          .map((el) => getComputedStyle(el).overflow), vpId);
        const slug = (file || 'home').replace(/[^\w]+/g, '-');
        await page.screenshot({ path: info.outputPath(`${site}-clip-002-${slug}.png`) });
        await exit3d(page, editor);
        const report = { site, file: file || 'home', viewport: vpId, cropped: cropped.length, marked: marked.length, missing: cropped.filter((id) => !marked.includes(id)), imgs: ownCrop3d.length, imgsVisible3d: ownCrop3d.filter((o) => o === 'visible').length };
        fs.writeFileSync(info.outputPath(`${site}-clip-002-${slug}.json`), JSON.stringify(report, null, 2));
        expect(report.missing, 'K3: every leaf cropped in 2D is cut in 3D').toEqual([]);
        expect(ownCrop3d, 'K1: every photo keeps its 2D overflow in 3D').toEqual(ownCrop2d);
      });
    }
  });
}
