import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { selectedIdsAtom } from '@/code/stores/store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { getCanvasBridge } from '@/canvas/canvas-bridge';
import { transformManager } from '@/canvas/transform';
import { getViewportHeaderPlane, setViewportHeaderInspection, focusViewportHeader } from '@/canvas/ViewportHeaderManager';
import { applySceneProjection, type SceneViewportBounds } from '@/shared/scene-projection';
import { trace } from '@/shared/debug-trace';
import { DEFAULT_SCENE_CAMERA, sceneActiveAtom, sceneBoundsAtom, sceneCameraAtom, sceneSeparationAtom } from './scene-state';
import { fitSceneViewport } from './scene-layout';
import './editor-isometric.css';

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

  useEffect(() => { setActive(false); setError(''); }, [file, setActive]);
  useEffect(() => {
    if (!active) return;
    const host = document.querySelector<HTMLElement>('[data-canvas-root]');
    const headers = host?.querySelector<HTMLElement>('[data-viewport-header-overlay]');
    const bridge = getCanvasBridge();
    if (!host || !headers || !bridge.setSceneInspection) { setError('Canvas is not ready'); setActive(false); return; }
    ++generation.current;
    const originalFile = store.get(activeFilePathAtom);
    const originalCamera = transformManager.getTransform();
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
      focused.current = ''; setBounds(null);
      const exit = ++generation.current;
      const off = { enabled: false, separation: 0, selectedId: '' };
      void Promise.all([applySceneProjection(getViewportHeaderPlane(headers), off), bridge.setSceneInspection!(off)]).catch(cause => trace.error('scene-composer:close', cause)).finally(() => {
        if (generation.current !== exit) return;
        delete host.dataset.sceneView;
        setViewportHeaderInspection(headers, false);
        if (store.get(activeFilePathAtom) === originalFile) transformManager.setTransform(originalCamera);
        trace.action('scene-composer:mode', { isometric: false });
      });
    };
  }, [active, store, setActive, setBounds]);

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
        focused.current = id; fitSceneViewport(next);
        referenceScale.current = transformManager.getTransform().scale;
        setZoom(referenceScale.current);
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
    const options = { enabled: true, viewportId, bounds, separation, selectedId: selected[0] || '', origin: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, orientation: camera, perspective: camera.perspective, distance: Math.max(1600, bounds.width * 2, bounds.height * 2) * referenceScale.current / Math.max(.01, zoom), instant: camera.dragging || zoomChanged, interacting: camera.dragging, selectionColor: getComputedStyle(host).getPropertyValue('--accent').trim() };
    focusViewportHeader(headers, viewportId, bounds);
    void Promise.all([applySceneProjection(getViewportHeaderPlane(headers), options), getCanvasBridge().setSceneInspection?.(options)]).catch(cause => { trace.error('scene-composer:projection', cause); setError('Could not change canvas view'); });
  }, [active, bounds, viewportId, camera, selected, zoom, separation]);

  return { active, error, toggle: useCallback(() => {
    if (!active) { setCamera({ ...DEFAULT_SCENE_CAMERA }); setBounds(null); }
    setActive(!active);
  }, [active, setActive, setBounds, setCamera]) };
}
