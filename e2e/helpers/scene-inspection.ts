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
