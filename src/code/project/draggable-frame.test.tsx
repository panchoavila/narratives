import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevymeDraggableFrame } from '../../../packages/revyme-runtime-scene/src/draggable-frame';
import { DRAGGABLE_FRAME_COMPONENT } from './default-code-components/DraggableFrame';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';

describe('draggable frame', () => {
 it('keeps semantic content and keyboard entry, and disables interaction in static canvas', () => {
  const live=renderToStaticMarkup(<RevymeDraggableFrame moveLabel="Mover imagen"><p>Content</p></RevymeDraggableFrame>);
  expect(live).toContain('aria-label="Mover imagen"'); expect(live).toContain('tabindex="0"'); expect(live).toContain('<p>Content</p>');
  const fixed=renderToStaticMarkup(<RevymeDraggableFrame static><p>Content</p></RevymeDraggableFrame>);
  expect(fixed).not.toContain('tabindex="0"'); expect(fixed).toContain('<p>Content</p>');
 });
 it('exposes the native slot, axis, inertia, return and limits', () => {
  const controls=parseComponentControlsMeta(DRAGGABLE_FRAME_COMPONENT)!.controls;
  expect(Object.keys(controls)).toEqual(['children','enabled','axis','momentum','snapBack','constrained','minX','maxX','minY','maxY','moveLabel']);
  expect(checkFile(DRAGGABLE_FRAME_COMPONENT,{kind:'code-component',path:'components/DraggableFrame.tsx'})).toEqual([]);
 });
});

it('resets translation when a live item re-enters static canvas', async () => {
 const { act } = await import('react');
 const { createRoot } = await import('react-dom/client');
 const container=document.createElement('div'); document.body.appendChild(container);
 const root=createRoot(container);
 await act(async()=>{root.render(<RevymeDraggableFrame><span>Item</span></RevymeDraggableFrame>);});
 const frame=container.querySelector<HTMLElement>('[data-revyme-draggable]')!;
 await act(async()=>{frame.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); await new Promise(resolve=>setTimeout(resolve,35));});
 expect(frame.style.transform).toContain('10px');
 await act(async()=>{root.render(<RevymeDraggableFrame static><span>Item</span></RevymeDraggableFrame>); await new Promise(resolve=>setTimeout(resolve,35));});
 expect(frame.style.transform).not.toContain('10px');
 await act(async()=>root.unmount()); container.remove();
});
