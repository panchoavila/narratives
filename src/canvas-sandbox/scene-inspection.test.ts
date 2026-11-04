import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { parseCanvasConfig } from '@/code/project/canvas-config';
import { renderNodes } from '@/canvas/Renderer';
import { applySceneInspection, getSceneViewportBounds } from './sandbox/scene-inspection';
import { applySceneProjection, projectScenePoint, SCENE_TRANSITION_MS } from '@/shared/scene-projection';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c.codePointAt(0)!.toString(16)} `) });
});
afterEach(() => { document.body.replaceChildren(); document.getElementById('revyme-scene-inspection')?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('one upright editing canvas across all breakpoints', () => {
  for (const file of ['app/page.client.tsx', 'app/espacio/page.client.tsx']) {
    it(`projects ${file} and its headers together without rebuilding the viewports`, async () => {
      const source = readFileSync(`sites/canvas/${file}`, 'utf8');
      const nodes = parseJSXToNodes(source);
      const views = parseCanvasConfig(source)!.viewports;
      const camera = document.createElement('div');
      camera.style.transform = 'translate3d(200px, 100px, 0) scale(0.5)';
      const scene = document.createElement('div');
      const headers = document.createElement('div');
      camera.append(scene); document.body.append(camera, headers);
      renderNodes(scene, nodes, null, () => {}, views, source, undefined, undefined, undefined, true);
      const elements = [...scene.querySelectorAll('[data-node-id]')];
      const before = scene.innerHTML;
      const cameraBefore = camera.style.cssText;
      const options = { enabled: true, origin: { x: 800, y: 450 }, separation: 24, selectedId: 'root', selectionColor: '#b556a2' };
      const entering = Promise.all([applySceneInspection(scene, options), applySceneProjection(headers, options)]);
      expect(scene.style.transform).toBe(headers.style.transform);
      expect(scene.style.transformOrigin).toBe(headers.style.transformOrigin);
      expect(scene.style.transition).toBe(headers.style.transition);
      expect(scene.style.transform).not.toContain('rotateZ');
      expect(scene.querySelectorAll('[data-viewport]')).toHaveLength(3);
      expect([...scene.querySelectorAll('[data-node-id]')]).toEqual(elements);
      expect(scene.innerHTML).toBe(before);
      // Camera movement changes its original parent, never the projection.
      camera.style.transform = 'translate3d(400px, 120px, 0) scale(0.75)';
      expect(scene.style.transform).toBe(headers.style.transform);
      for (const viewport of scene.querySelectorAll<HTMLElement>('[data-viewport]')) {
        expect(getComputedStyle(viewport).translate).toBe('none');
        expect(viewport.style.transform).not.toContain('rotate');
      }
      await vi.advanceTimersByTimeAsync(SCENE_TRANSITION_MS);
      await entering;
      const leaving = Promise.all([applySceneInspection(scene, { ...options, enabled: false }), applySceneProjection(headers, { ...options, enabled: false })]);
      expect(scene.dataset.sceneInspection).toBe('2d');
      expect(scene.style.transform).toBe('rotateX(0deg) rotateY(0deg)');
      await vi.advanceTimersByTimeAsync(SCENE_TRANSITION_MS);
      await leaving;
      expect(scene.hasAttribute('data-scene-inspection')).toBe(false);
      expect(scene.style.transform).toBe('');
      expect(headers.style.transform).toBe('');
      expect(scene.innerHTML).toBe(before);
      expect(camera.style.cssText).not.toBe(cameraBefore); // retain the user's camera change
      expect(camera.style.transform).toContain('400px');
    });
  }

  it('keeps page edges vertical and equally foreshortens all three axes', () => {
    const x = projectScenePoint(1, 0), y = projectScenePoint(0, 1), z = projectScenePoint(0, 0, 1);
    expect(y.x).toBe(0);
    expect(y.y).toBeGreaterThan(0.8);
    expect(Math.hypot(x.x, x.y)).toBeCloseTo(Math.hypot(y.x, y.y), 10);
    expect(Math.hypot(z.x, z.y)).toBeCloseTo(Math.hypot(y.x, y.y), 10);
    const top = projectScenePoint(1200, 0), bottom = projectScenePoint(1200, 900);
    expect(bottom.x).toBe(top.x);
    expect(bottom.y).toBeGreaterThan(top.y);
  });

  it('can reverse mid-transition and restores previous plane styles exactly', async () => {
    const scene = document.createElement('div'); document.body.append(scene);
    scene.style.transform = 'translateZ(0)'; scene.style.transformOrigin = '12px 24px';
    scene.style.transition = 'opacity 100ms linear';
    const original = scene.style.cssText;
    const on = applySceneInspection(scene, { enabled: true, separation: 24, selectedId: '' });
    await vi.advanceTimersByTimeAsync(80);
    const off = applySceneInspection(scene, { enabled: false, separation: 0, selectedId: '' });
    await vi.advanceTimersByTimeAsync(SCENE_TRANSITION_MS);
    await Promise.all([on, off]);
    expect(scene.style.cssText).toBe(original);
    expect(document.getElementById('revyme-scene-inspection')).toBeNull();
  });

  it('uses an immediate mode switch for reduced motion', async () => {
    window.matchMedia = (() => ({ matches: true })) as any;
    const scene = document.createElement('div'); document.body.append(scene);
    await applySceneInspection(scene, { enabled: true, separation: 24, selectedId: '' });
    expect(scene.style.transition).toContain('0ms');
    await applySceneInspection(scene, { enabled: false, separation: 0, selectedId: '' });
    expect(scene.style.transform).toBe('');
  });
});

describe('focused live responsive viewport', () => {
  it('measures fractional border-box dimensions in layout space, ignoring 3D projection', () => {
    const scene = document.createElement('div'); document.body.append(scene);
    const viewport = document.createElement('div'); scene.append(viewport);
    viewport.dataset.viewport = 'mobile'; viewport.dataset.nodeId = 'mobile-root';
    viewport.style.cssText = 'position:absolute;left:2100.5px;top:12.25px;width:390.5px;height:940.75px;padding:24px;border:1px solid;box-sizing:border-box;transform:rotateY(45deg)';
    expect(getSceneViewportBounds(scene, 'mobile')).toEqual({x:2100.5,y:12.25,width:390.5,height:940.75});
    expect(getSceneViewportBounds(scene, 'missing')).toBeNull();
  });
  it('shows one responsive version and moves the exact grid origin without replacing nodes', async () => {
    const source = readFileSync('sites/canvas/app/page.client.tsx', 'utf8');
    const scene = document.createElement('div'); document.body.append(scene);
    const views = parseCanvasConfig(source)!.viewports;
    renderNodes(scene, parseJSXToNodes(source), null, () => {}, views, source, undefined, undefined, undefined, true);
    const elements = [...scene.querySelectorAll('[data-node-id]')];
    const before = scene.innerHTML;
    const opts = { enabled: true, instant: true, separation: 24, selectedId: '', viewportId: 'desktop', bounds: { x: 0, y: 0, width: 1200, height: 900 }, origin: { x: 600, y: 450 } };
    await applySceneInspection(scene, opts);
    const root = (id: string) => scene.querySelector<HTMLElement>(`[data-viewport="${id}"]`)!;
    expect(getComputedStyle(root('desktop')).visibility).not.toBe('hidden');
    expect(getComputedStyle(root('mobile')).visibility).toBe('hidden');
    expect(getComputedStyle(root('tablet')).visibility).toBe('hidden');
    const grid = scene.querySelector<HTMLElement>('[data-scene-grid]')!;
    expect(grid.style.left).toBe('600px'); expect(grid.style.top).toBe('450px');
    expect(grid.querySelectorAll('[data-scene-axis]')).toHaveLength(3);
    await applySceneInspection(scene, { ...opts, viewportId: 'mobile', bounds: { x: 2300, y: 12, width: 390, height: 920 }, origin: { x: 2495, y: 472 } });
    expect(getComputedStyle(root('desktop')).visibility).toBe('hidden');
    expect(getComputedStyle(root('mobile')).visibility).not.toBe('hidden');
    expect(grid.style.left).toBe('2495px'); expect(grid.style.top).toBe('472px');
    expect(scene.style.transformOrigin).toBe('2495px 472px');
    expect([...scene.querySelectorAll('[data-node-id]')]).toEqual(elements);
    await applySceneInspection(scene, { enabled: false, instant: true, separation: 0, selectedId: '' });
    expect(scene.innerHTML).toBe(before);
    for (const v of views) expect(getComputedStyle(root(v.id)).visibility).not.toBe('hidden');
  });
});
