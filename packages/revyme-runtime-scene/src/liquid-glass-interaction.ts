import type { LiquidGlassConfig } from './liquid-glass-config';
import type { LiquidLens } from './vendor/liquid-gl';
import { observeGlassAudio } from './liquid-glass-audio';

/** Additive presentation motion leaves the authored/Motion transform untouched. */
export function attachGlassInteraction(el: HTMLElement, lens: LiquidLens, config: LiquidGlassConfig, position = { x: 0, y: 0 }) {
  const doc = el.ownerDocument, win = doc.defaultView!;
  let x = position.x, y = position.y, tiltX = 0, tiltY = 0, targetX = 0, targetY = 0;
  let drag: { pointer: number; x: number; y: number; originX: number; originY: number } | undefined;
  let frame = 0, previousTime = 0, closed = false;
  let presentation: Animation | undefined;
  const originalTabIndex = el.getAttribute('tabindex');
  const audio = config.audioReactive ? observeGlassAudio(doc, config.audioSourceId) : undefined;
  const emit = (phase: 'start' | 'move' | 'end') => el.dispatchEvent(new CustomEvent('revyme:glass-drag', {
    bubbles: true, detail: { nodeId: el.getAttribute('data-id'), phase, x, y },
  }));
  function update(now: number) {
    frame = 0;
    if (closed) return;
    const dt = previousTime ? Math.min(64, now - previousTime) : 16;
    previousTime = now;
    const follow = config.tiltEase === 0 ? 1 : 1 - Math.exp(-dt / Math.max(1, config.tiltEase / 4));
    tiltX += (targetX - tiltX) * follow; tiltY += (targetY - tiltY) * follow;
    if (config.tilt || config.draggable) {
      position.x = x; position.y = y;
      const transform = `translate3d(${x}px,${y}px,0) perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
      const keyframes = [{ transform }, { transform }];
      if (presentation) (presentation.effect as KeyframeEffect | null)?.setKeyframes(keyframes);
      else if (el.animate) presentation = el.animate(keyframes, { duration: 1, fill: 'both', composite: 'add' });
      lens.tiltX = tiltX; lens.tiltY = tiltY;
    }
    if (audio) {
      const amount = audio.read() * config.audioGain;
      lens.options.refraction = Math.min(1, config.refraction + amount * 0.08);
      lens.options.bevelDepth = Math.min(1, config.bevelDepth * (1 + amount));
      el.dataset.revymeLiquidAudio = audio.state;
    }
    if (Math.abs(targetX - tiltX) + Math.abs(targetY - tiltY) > 0.01 || audio?.playing) schedule();
  }
  function schedule() { if (!frame && !closed) frame = win.requestAnimationFrame(update); }
  const move = (event: PointerEvent) => {
    if (drag?.pointer === event.pointerId) {
      x = drag.originX + event.clientX - drag.x; y = drag.originY + event.clientY - drag.y;
      emit('move'); schedule(); return;
    }
    if (!config.tilt) return;
    const rect = el.getBoundingClientRect();
    targetX = -(Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5))) * config.tiltFactor * 2;
    targetY = (Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5))) * config.tiltFactor * 2;
    schedule();
  };
  const leave = () => { if (!drag) { targetX = targetY = 0; schedule(); } };
  const down = (event: PointerEvent) => {
    if (!config.draggable || !event.isPrimary || event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('a,button,input,textarea,select,summary,[contenteditable="true"]'))) return;
    event.preventDefault();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, originX: x, originY: y };
    el.setPointerCapture(event.pointerId); emit('start');
  };
  const up = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    drag = undefined; emit('end'); leave();
  };
  const key = (event: KeyboardEvent) => {
    if (!config.draggable || event.target !== el || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    if (event.key === 'ArrowLeft') x -= step; if (event.key === 'ArrowRight') x += step;
    if (event.key === 'ArrowUp') y -= step; if (event.key === 'ArrowDown') y += step;
    emit('move'); schedule();
  };
  if (config.draggable) { el.dataset.revymeLiquidDrag = ''; if (originalTabIndex === null) el.tabIndex = 0; }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', key);
  doc.addEventListener('playing', schedule, true);
  schedule();
  return () => {
    closed = true; win.cancelAnimationFrame(frame); presentation?.cancel(); audio?.destroy();
    if (drag && el.hasPointerCapture(drag.pointer)) el.releasePointerCapture(drag.pointer);
    el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave); el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up); el.removeEventListener('keydown', key);
    doc.removeEventListener('playing', schedule, true);
    if (config.draggable && originalTabIndex === null) el.removeAttribute('tabindex');
    delete el.dataset.revymeLiquidDrag; delete el.dataset.revymeLiquidAudio;
  };
}
