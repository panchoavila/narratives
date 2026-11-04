import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { selectedIdsAtom } from '@/code/stores/store';
import { useActiveViewports } from '@/canvas/hooks/useActiveViewports';
import { transformManager } from '@/canvas/transform';
import { projectScenePoint } from '@/shared/scene-projection';
import { trace } from '@/shared/debug-trace';
import ToolSelect from '@/editor/controls/ToolSelect';
import { alignSceneView, orbitSceneView, snapSceneView, sceneActiveAtom, sceneCameraAtom, type SceneCamera, type SceneAxisView } from './scene-state';
import { sceneScreenRect } from './scene-layout';

export function SceneViewportSelect() {
  const active = useAtomValue(sceneActiveAtom);
  const [viewport, setViewport] = useAtom(interactingViewportIdAtom);
  const setSelection = useSetAtom(selectedIdsAtom);
  const views = useActiveViewports();
  if (!active) return null;
  return <label className="w-36 shrink-0" data-scene-viewport-select="">
    <span className="sr-only">3D viewport</span>
    <ToolSelect value={viewport} onChange={id => { setViewport(id); setSelection(['root']); trace.action('scene-composer:viewport', { id }); }} options={views.map(v => ({ value: v.id, label: v.label || v.id }))} />
  </label>;
}

const axes: { label: string; view: Exclude<SceneAxisView, 'user'>; vector: [number, number, number]; color: string; positive: boolean }[] = [
  { label: 'X', view: 'right', vector: [1,0,0], color: '#e65369', positive: true },
  { label: 'X', view: 'left', vector: [-1,0,0], color: '#e65369', positive: false },
  { label: 'Y', view: 'back', vector: [0,0,-1], color: '#88b940', positive: true },
  { label: 'Y', view: 'front', vector: [0,0,1], color: '#88b940', positive: false },
  { label: 'Z', view: 'top', vector: [0,-1,0], color: '#4194e8', positive: true },
  { label: 'Z', view: 'bottom', vector: [0,1,0], color: '#4194e8', positive: false },
];
const buttonClass = 'scene-navigation-button cut-corners cut-border';

export default function SceneViewControls() {
  const active = useAtomValue(sceneActiveAtom);
  const [camera, setCamera] = useAtom(sceneCameraAtom);
  const [right, setRight] = useState(16);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active) return;
    const update = () => {
      const host = document.querySelector('[data-canvas-root]')?.getBoundingClientRect();
      setRight(Math.max(16, (host?.width || window.innerWidth) - sceneScreenRect().right + 16));
    };
    const observer = new ResizeObserver(update);
    document.querySelectorAll('[data-canvas-root], [data-properties-panel], [data-editor-panel="left-primary"]').forEach(el => observer.observe(el));
    window.addEventListener('resize', update); update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); dragCleanup.current?.(); };
  }, [active]);
  if (!active) return null;

  const startDrag = (event: ReactPointerEvent, kind: 'orbit' | 'pan' | 'zoom') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    dragCleanup.current?.();
    const start = { x: event.clientX, y: event.clientY }, initial = transformManager.getTransform();
    const area = sceneScreenRect();
    let previous = start, raw: SceneCamera = camera, moved = false;
    const applySnap = (alt: boolean) => setCamera(alt ? snapSceneView(raw) : raw);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      e.preventDefault();
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
      moved = true;
      if (kind === 'orbit') { raw = orbitSceneView(raw, e.clientX - previous.x, e.clientY - previous.y); applySnap(e.altKey); }
      else if (kind === 'pan') transformManager.pan(e.clientX - previous.x, e.clientY - previous.y);
      else {
        // Blender Dolly zoom from a simulated start at the viewport center.
        const distanceRatio = Math.max(.02, 1 + 2 * (e.clientY - start.y) / (5 + area.height / 2));
        const now = transformManager.getTransform();
        transformManager.zoom(area.x, area.y, initial.scale / distanceRatio - now.scale);
      }
      previous = { x: e.clientX, y: e.clientY };
    };
    const modifier = (e: KeyboardEvent) => { if (moved && kind === 'orbit' && e.key === 'Alt') { e.preventDefault(); applySnap(e.type === 'keydown'); } };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', modifier);
      window.removeEventListener('keyup', modifier);
      window.removeEventListener('blur', cancel);
      dragCleanup.current = null;
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      stop();
      if (kind === 'orbit') {
        if (moved) setCamera(c => ({ ...c, dragging: false }));
        else {
          const axis = (event.target as Element).closest('[data-scene-axis-view]')?.getAttribute('data-scene-axis-view') as Exclude<SceneAxisView, 'user'> | null;
          if (axis) { setCamera(c => alignSceneView(c, axis)); trace.action('scene-composer:axis', { axis }); }
        }
      }
    };
    const cancel = () => { stop(); setCamera(c => ({ ...c, dragging: false })); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', modifier);
    window.addEventListener('keyup', modifier);
    window.addEventListener('blur', cancel);
    dragCleanup.current = stop;
  };
  const projected = axes.map(axis => ({ ...axis, point: projectScenePoint(...axis.vector, camera) })).sort((a,b) => a.point.z - b.point.z);
  return <div data-scene-controls="" style={{ position: 'absolute', top: 54, right, zIndex: 20 }} onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
    <div className="scene-axis-gizmo" role="group" aria-label="View orientation" title="Drag to orbit · Alt to snap" onPointerDown={e => startDrag(e, 'orbit')}>
      <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
        {projected.filter(a => a.positive).map(a => <line key={a.view} x1="56" y1="56" x2={56+a.point.x*37} y2={56+a.point.y*37} stroke={a.color} strokeWidth="2" />)}
      </svg>
      {projected.map(a => <button key={a.view} type="button" data-scene-axis-view={a.view} aria-label={`${a.view[0].toUpperCase()+a.view.slice(1)} view`} title={`${a.view[0].toUpperCase()+a.view.slice(1)} view`} className="scene-axis-end" style={{ left:56+a.point.x*37, top:56+a.point.y*37, color:a.color, background: a.positive ? a.color : 'var(--canvas-chrome-bg)', opacity:a.point.z < -.01 ? .65 : 1, pointerEvents: camera.view === a.view ? 'none' : undefined }} onClick={e => { if (e.detail === 0) setCamera(c => alignSceneView(c, a.view)); }}>
        {a.positive && <span>{a.label}</span>}
      </button>)}
    </div>
    <div className="scene-navigation-tools">
      <button type="button" className={buttonClass} title="Zoom view (drag)" aria-label="Zoom view" onPointerDown={e => startDrag(e, 'zoom')} onKeyDown={e => { if (e.key==='ArrowUp'||e.key==='ArrowDown') { e.preventDefault(); const a=sceneScreenRect(); transformManager.zoomByFactor(a.x,a.y,e.key==='ArrowUp'?1.2:1/1.2); } }}>
        <svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/></svg>
      </button>
      <button type="button" className={buttonClass} title="Pan view (drag)" aria-label="Pan view" onPointerDown={e => startDrag(e, 'pan')} onKeyDown={e => { const d: Record<string,number[]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}; if(d[e.key]) {e.preventDefault();transformManager.pan(d[e.key][0],d[e.key][1]);} }}>
        <svg viewBox="0 0 24 24"><path d="M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 5-3 7-6 7-3 0-5-2-7-5l-3-4c-1-2 1-3 2-2l2 2"/></svg>
      </button>
      <button type="button" className={buttonClass} title={camera.perspective ? 'Switch to orthographic view' : 'Switch to perspective view'} aria-label="Toggle perspective" aria-pressed={camera.perspective} onClick={() => { setCamera(c => ({...c,perspective:!c.perspective,previousPerspective:!c.perspective})); trace.action('scene-composer:perspective', { perspective: !camera.perspective }); }}>
        <svg viewBox="0 0 24 24">{camera.perspective ? <path d="m5 5 15-3v20L5 19ZM5 5l-3 4v6l3 4M2 9l13-2v10L2 15m13-8 5-5m-5 15 5 5"/> : <path d="M3 7h14v14H3ZM3 7l4-4h14v14l-4 4M17 7l4-4"/>}</svg>
      </button>
    </div>
  </div>;
}
