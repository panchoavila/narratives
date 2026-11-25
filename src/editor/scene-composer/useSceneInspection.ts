import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { selectedIdsAtom } from '@/code/stores/store';
import { interactingViewportIdAtom, visibleViewportsAtom } from '@/code/stores/viewport-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { getCanvasBridge } from '@/canvas/canvas-bridge';
import { transformManager } from '@/canvas/transform';
import { getViewportHeaderPlane, setViewportHeaderInspection, focusViewportHeader } from '@/canvas/ViewportHeaderManager';
import { applySceneProjection, type SceneOrigin, type SceneViewportBounds } from '@/shared/scene-projection';
import { trace } from '@/shared/debug-trace';
import { DEFAULT_SCENE_CAMERA, sceneActiveAtom, sceneBoundsAtom, sceneCameraAtom, sceneSeparationAtom } from './scene-state';
import { fitSceneViewport, pickSceneViewport, sceneEntryPivot, sceneScreenRect, type SceneScreenArea } from './scene-layout';
import './editor-isometric.css';

/** Longest wait for the sandbox to measure the breakpoints before entering 3D anyway. */
const CHOOSE_VIEWPORT_TIMEOUT_MS = 800;

/** The breakpoint the screen is showing, measured in the sandbox; the clicked one
 * when the bridge cannot measure or does not answer in time. */
async function viewportOnScreen(preferred: string, ids: string[], area: SceneScreenArea): Promise<string> {
  const bridge = getCanvasBridge();
  if (!bridge.getSceneViewportBounds || ids.length < 2) return preferred;
  const measure = Promise.all(ids.map(id => bridge.getSceneViewportBounds!(id).then(
    bounds => (bounds && bounds.width > 0 && bounds.height > 0 ? { id, bounds } : null),
    () => null,
  )));
  const timeout = new Promise<null>(resolve => window.setTimeout(() => resolve(null), CHOOSE_VIEWPORT_TIMEOUT_MS));
  const measured = await Promise.race([measure, timeout]);
  if (!measured) { trace.error('scene-composer:choose-viewport', 'timeout'); return preferred; }
  const candidates = measured.filter((c): c is { id: string; bounds: SceneViewportBounds } => !!c);
  return pickSceneViewport(candidates, transformManager.getTransform(), area, preferred) ?? preferred;
}

/** View state only: the real renderer, viewport nodes and source remain intact. */
export function useSceneInspection() {
  const [active, setActive] = useAtom(sceneActiveAtom);
  const [bounds, setBounds] = useAtom(sceneBoundsAtom);
  const [camera, setCamera] = useAtom(sceneCameraAtom);
  const separation = useAtomValue(sceneSeparationAtom);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(() => transformManager.getTransform().scale);
  const referenceScale = useRef(zoom);
  const appliedZoom = useRef(zoom);
  const selected = useAtomValue(selectedIdsAtom);
  const viewportId = useAtomValue(interactingViewportIdAtom);
  const file = useAtomValue(activeFilePathAtom);
  const store = useStore();
  const generation = useRef(0);
  const focused = useRef('');
  const measuredViewport = useRef('');
  // The rotation pivot. Set once per entry, while the plane is still flat: moving
  // it while the plane is rotated would shift the whole picture by (I - R)·Δ.
  const pivot = useRef<SceneOrigin | null>(null);
  // An entry waiting for the sandbox to say which breakpoint is on screen.
  const pendingEntry = useRef(0);
  const entering = useRef(false);
  // The visible canvas area when 3D was asked for: the 3D panel that opens next
  // narrows it, and the pivot is what the user was looking at, not its new centre.
  const entryArea = useRef<SceneScreenArea | null>(null);

  useEffect(() => { ++pendingEntry.current; entering.current = false; setActive(false); setError(''); }, [file, setActive]);
  useEffect(() => {
    if (!active) return;
    const host = document.querySelector<HTMLElement>('[data-canvas-root]');
    const headers = host?.querySelector<HTMLElement>('[data-viewport-header-overlay]');
    const bridge = getCanvasBridge();
    if (!host || !headers || !bridge.setSceneInspection) { setError('Canvas is not ready'); setActive(false); return; }
    ++generation.current;
    const stopCamera = transformManager.subscribe(() => setZoom(transformManager.getTransform().scale));
    setViewportHeaderInspection(headers, true);
    host.dataset.sceneView = 'isometric';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[data-tool-popup]')) { e.preventDefault(); e.stopImmediatePropagation(); setActive(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      stopCamera();
      focused.current = ''; pivot.current = null; entryArea.current = null; setBounds(null);
      const exit = ++generation.current;
      const off = { enabled: false, separation: 0, selectedId: '' };
      void Promise.all([applySceneProjection(getViewportHeaderPlane(headers), off), bridge.setSceneInspection!(off)]).catch(cause => trace.error('scene-composer:close', cause)).finally(() => {
        if (generation.current !== exit) return;
        delete host.dataset.sceneView;
        setViewportHeaderInspection(headers, false);
        // The 2D view continues from the 3D one: pan and zoom done in 3D are kept.
        trace.action('scene-composer:mode', { isometric: false, camera: transformManager.getTransform() });
      });
    };
  }, [active, setActive, setBounds]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const bridge = getCanvasBridge();
    const accept = (id: string, next: SceneViewportBounds) => {
      if (cancelled || id !== viewportId) return;
      const changedViewport = measuredViewport.current !== id;
      measuredViewport.current = id;
      setBounds(old => !changedViewport && JSON.stringify(old) === JSON.stringify(next) ? old : next);
      if (focused.current !== id && next.width > 0 && next.height > 0) {
        // Entry keeps the 2D camera and turns the view about the point at the centre
        // of the screen. A breakpoint off screen, or a switch to another breakpoint
        // while in 3D, reframes instead (only a reframe hides a pivot change).
        const entry = focused.current === '';
        focused.current = id;
        const kept = entry ? sceneEntryPivot(next, transformManager.getTransform(), entryArea.current ?? sceneScreenRect()) : null;
        if (!kept) fitSceneViewport(next);
        pivot.current = kept ?? { x: next.x + next.width / 2, y: next.y + next.height / 2 };
        referenceScale.current = transformManager.getTransform().scale;
        // On entry the rotation animates: the zoom it starts from is not a 3D zoom.
        if (entry) appliedZoom.current = referenceScale.current;
        setZoom(referenceScale.current);
        trace.action('scene-composer:pivot', { viewportId: id, entry, kept: !!kept, pivot: pivot.current, camera: transformManager.getTransform() });
      }
    };
    const stop = bridge.subscribeSceneViewportBounds?.(accept);
    void bridge.getSceneViewportBounds?.(viewportId).then(next => { if (next) accept(viewportId, next); }).catch(cause => trace.error('scene-composer:bounds', cause));
    return () => { cancelled = true; stop?.(); };
  }, [active, viewportId, setBounds]);

  useEffect(() => {
    if (!active || !bounds || measuredViewport.current !== viewportId) return;
    const host = document.querySelector<HTMLElement>('[data-canvas-root]');
    const headers = host?.querySelector<HTMLElement>('[data-viewport-header-overlay]');
    if (!host || !headers) return;
    const zoomChanged = appliedZoom.current !== zoom;
    appliedZoom.current = zoom;
    const options = { enabled: true, viewportId, bounds, separation, selectedId: selected[0] || '', origin: pivot.current ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, orientation: camera, perspective: camera.perspective, distance: Math.max(1600, bounds.width * 2, bounds.height * 2) * referenceScale.current / Math.max(.01, zoom), instant: camera.dragging || zoomChanged, interacting: camera.dragging, selectionColor: getComputedStyle(host).getPropertyValue('--accent').trim() };
    focusViewportHeader(headers, viewportId, bounds);
    void Promise.all([applySceneProjection(getViewportHeaderPlane(headers), options), getCanvasBridge().setSceneInspection?.(options)]).catch(cause => { trace.error('scene-composer:projection', cause); setError('Could not change canvas view'); });
  }, [active, bounds, viewportId, camera, selected, zoom, separation]);

  return { active, error, toggle: useCallback(() => {
    if (active) { setActive(false); return; }
    // A second click while the breakpoint is being chosen cancels the entry.
    const attempt = ++pendingEntry.current;
    if (entering.current) { entering.current = false; trace.action('scene-composer:entry-cancelled', { attempt }); return; }
    entering.current = true;
    const preferred = store.get(interactingViewportIdAtom);
    const area = sceneScreenRect();
    void viewportOnScreen(preferred, store.get(visibleViewportsAtom).map(v => v.id), area).then(chosen => {
      if (pendingEntry.current !== attempt) return;
      entering.current = false;
      if (chosen !== preferred) store.set(interactingViewportIdAtom, chosen);
      entryArea.current = area;
      trace.action('scene-composer:entry', { preferred, chosen, area });
      setCamera({ ...DEFAULT_SCENE_CAMERA }); setBounds(null);
      setActive(true);
    });
  }, [active, store, setActive, setBounds, setCamera]) };
}
