'use client';

import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { DEFAULT_NOVA_WARP, normalizeNovaWarp, type NovaWarpConfig } from './nova-warp-config';
import type { createNovaWarpRenderer, WarpFrame } from './nova-warp-renderer';

export interface NovaWarpProps extends Partial<NovaWarpConfig>, HTMLAttributes<HTMLDivElement> {
  static?: boolean;
}
type Renderer = ReturnType<typeof createNovaWarpRenderer>;
const dimension = (value: CSSProperties['width']) =>
  typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value ?? '100%';

/** Decorative GPU background. HTML stays live and retains ownership of clicks, focus and scroll. */
export function RevymeNovaWarp(props: NovaWarpProps) {
  const { static: isStatic = false, style, children } = props;
  const config = normalizeNovaWarp(props);
  // Pausing changes scheduling, not the scene: keep the current frame and GPU resources.
  const signature = JSON.stringify({ ...config, paused: false });
  const paused = useRef(config.paused);
  const reschedule = useRef<() => void>(() => {});
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const attributes = { ...props } as Record<string, unknown>;
  for (const key of [...Object.keys(DEFAULT_NOVA_WARP), 'static', 'style', 'children']) delete attributes[key];

  useEffect(() => { paused.current = config.paused; reschedule.current(); }, [config.paused]);

  useEffect(() => {
    const host = root.current!, surface = canvas.current!;
    const doc = host.ownerDocument, win = doc.defaultView!;
    const settings = JSON.parse(signature) as NovaWarpConfig;
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    const pose: WarpFrame = { travel: 12, time: 18, rotation: 0.3, intensity: 0,
      centerX: settings.centerX / 100, centerY: settings.centerY / 100, pointerX: 0, pointerY: 0 };
    let engine: Renderer | undefined;
    let frame = 0, lastTime = 0, disposed = false, contextLost = false, failed = false;
    let visible = true, hovered = false, pressing = false, pointerX = 0, pointerY = 0;
    let target: Element | null = null;
    let bounds = host.getBoundingClientRect();
    let width = host.clientWidth, height = host.clientHeight;
    let lastPointer: { x: number; y: number; touch: boolean } | null = null;
    let state = '';

    function emit(next: string, reason?: string) {
      if (state === next && !reason) return;
      state = next;
      host.dataset.warpState = next;
      // Same diagnostic boundary as the other GPU effects: no editor dependency in the runtime.
      host.dispatchEvent(new CustomEvent('revyme:warp-state', { bubbles: true,
        detail: { nodeId: host.getAttribute('data-id'), state: next, reason } }));
    }
    function showGPU(show: boolean) {
      surface.style.visibility = show ? '' : 'hidden';
      if (fallback.current) fallback.current.style.visibility = show ? 'hidden' : '';
    }
    function resolveTarget() {
      if (!settings.triggerId) return host;
      if (target?.isConnected) return target;
      target = doc.getElementById(settings.triggerId) ??
        doc.querySelector('[data-id="' + CSS.escape(settings.triggerId) + '"]');
      return target;
    }
    function interaction() {
      host.dataset.warpBoost = String(!isStatic && !reduced.matches && !paused.current && (hovered || pressing));
    }
    function measure() {
      bounds = host.getBoundingClientRect();
      width = host.clientWidth; height = host.clientHeight;
      engine?.resize(width, height, win.devicePixelRatio || 1);
    }
    function anchor() {
      if (!settings.followTarget || !settings.triggerId) return;
      const linked = resolveTarget();
      if (!linked || !linked.getClientRects().length) {
        pose.centerX = settings.centerX / 100; pose.centerY = settings.centerY / 100;
        return;
      }
      // A linked Motion/CSS-animated button may move without a resize. Only this optional
      // path reads its live geometry each frame; GPU animation otherwise has no layout reads.
      bounds = host.getBoundingClientRect();
      const rect = linked.getBoundingClientRect();
      pose.centerX = Math.max(0, Math.min(1, (rect.x + rect.width / 2 - bounds.x) / Math.max(1, bounds.width)));
      pose.centerY = Math.max(0, Math.min(1, (rect.y + rect.height / 2 - bounds.y) / Math.max(1, bounds.height)));
    }
    function paint() {
      if (!engine || contextLost || failed || disposed) return;
      try { anchor(); engine.render(pose); }
      catch (error) {
        failed = true; showGPU(false);
        win.cancelAnimationFrame(frame); frame = 0;
        engine?.dispose(); engine = undefined;
        emit('fallback', String(error));
      }
    }
    function inactive() {
      if (contextLost) return 'context-lost';
      if (failed) return 'fallback';
      if (isStatic) return 'static';
      if (reduced.matches) return 'reduced-motion';
      if (paused.current) return 'paused';
      if (doc.hidden) return 'hidden';
      if (!visible || !width || !height) return 'offscreen';
      if (settings.idleSpeed === 0 && settings.cloudRotation === 0 && !(hovered || pressing) && pose.intensity < 0.001) return 'paused';
      return '';
    }
    function tick(now: number) {
      frame = 0;
      if (disposed || inactive()) { schedule(); return; }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
      lastTime = now;
      const desired = hovered || pressing ? settings.boost : 0;
      const easing = 1 - Math.exp(-dt * 3 / settings.response);
      pose.intensity += (desired - pose.intensity) * easing;
      pose.pointerX += (pointerX - pose.pointerX) * (1 - Math.exp(-dt * 5));
      pose.pointerY += (pointerY - pose.pointerY) * (1 - Math.exp(-dt * 5));
      pose.travel += dt * (settings.idleSpeed + pose.intensity * 28);
      pose.time += dt * (settings.idleSpeed + pose.intensity * 12);
      pose.rotation += dt * settings.cloudRotation * Math.PI / 180 * (0.15 + pose.intensity);
      paint();
      if (!failed) frame = win.requestAnimationFrame(tick);
    }
    function schedule() {
      win.cancelAnimationFrame(frame); frame = 0; lastTime = 0;
      interaction();
      if (!engine || disposed) return;
      const reason = inactive();
      emit(reason || 'running');
      if (!reason) frame = win.requestAnimationFrame(tick);
    }
    reschedule.current = schedule;
    const contains = (rect: DOMRect, x: number, y: number) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    function updatePointer(x: number, y: number, touch = false) {
      bounds = host.getBoundingClientRect();
      lastPointer = { x, y, touch };
      const inside = contains(bounds, x, y);
      pointerX = inside ? (x - bounds.left) / Math.max(1, bounds.width) * 2 - 1 : 0;
      pointerY = inside ? (y - bounds.top) / Math.max(1, bounds.height) * 2 - 1 : 0;
      const trigger = resolveTarget();
      const hitNode = settings.triggerId ? doc.elementFromPoint(x, y) : null;
      const reachable = trigger === host || (!!hitNode && !!trigger?.contains(hitNode));
      const hit = inside && reachable && !!trigger && trigger.getClientRects().length > 0 && contains(trigger.getBoundingClientRect(), x, y);
      const nextHover = !touch && hit;
      if (nextHover !== hovered) { hovered = nextHover; schedule(); }
      return hit;
    }
    const move = (event: PointerEvent) => { updatePointer(event.clientX, event.clientY, event.pointerType === 'touch'); };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== 'touch') return;
      pressing = updatePointer(event.clientX, event.clientY, true); schedule();
    };
    const up = (event: PointerEvent) => {
      pressing = false;
      if (event.pointerType === 'touch') { lastPointer = null; hovered = false; }
      schedule();
    };
    const leave = () => { hovered = false; pressing = false; pointerX = 0; pointerY = 0; lastPointer = null; schedule(); };
    const resize = () => { measure(); paint(); schedule(); };
    const scroll = () => {
      bounds = host.getBoundingClientRect();
      if (lastPointer) updatePointer(lastPointer.x, lastPointer.y, lastPointer.touch);
      if (visible && inactive()) paint();
    };
    const visibility = () => { if (doc.hidden) leave(); else schedule(); };
    const motionPreference = () => { leave(); paint(); };
    const lost = (event: Event) => {
      event.preventDefault(); contextLost = true; showGPU(false); schedule();
    };
    const restored = () => { queueMicrotask(() => {
      if (disposed) return;
      // Three restores its resources in its listener on the same event.
      contextLost = false; showGPU(true); measure(); paint(); schedule();
    }); };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver(entries => {
      const entry = entries[0];
      visible = !!entry?.isIntersecting && entry.intersectionRatio > 0;
      schedule();
    }, { threshold: [0, 0.001] });
    io.observe(host);
    surface.addEventListener('webglcontextlost', lost);
    surface.addEventListener('webglcontextrestored', restored);
    if (!isStatic) {
      doc.addEventListener('pointermove', move, { passive: true });
      doc.addEventListener('pointerdown', down, { passive: true });
      doc.addEventListener('pointerup', up, { passive: true });
      doc.addEventListener('pointercancel', leave, { passive: true });
      doc.addEventListener('pointerleave', leave);
      doc.addEventListener('scroll', scroll, { passive: true, capture: true });
      doc.addEventListener('visibilitychange', visibility);
      win.addEventListener('blur', leave);
      win.addEventListener('resize', resize);
      reduced.addEventListener('change', motionPreference);
    }
    emit('loading');
    host.dataset.warpBoost = 'false';
    void import('./nova-warp-renderer').then(({ createNovaWarpRenderer: create }) => {
      if (disposed) return;
      engine = create(surface, settings);
      showGPU(true);
      measure(); paint(); schedule();
    }).catch(error => {
      if (disposed) return;
      failed = true; showGPU(false); emit('fallback', String(error));
    });
    return () => {
      disposed = true;
      reschedule.current = () => {};
      win.cancelAnimationFrame(frame);
      ro.disconnect(); io.disconnect();
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerdown', down);
      doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', leave);
      doc.removeEventListener('pointerleave', leave); doc.removeEventListener('scroll', scroll, true);
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('blur', leave); win.removeEventListener('resize', resize);
      reduced.removeEventListener('change', motionPreference);
      surface.removeEventListener('webglcontextlost', lost); surface.removeEventListener('webglcontextrestored', restored);
      engine?.dispose(); emit('disposed');
    };
  }, [signature, isStatic]);

  return <div {...attributes} ref={root} data-revyme-nova-warp="" style={{
    position: 'relative', overflow: 'hidden', backgroundColor: config.bgColor,
    ...style, width: dimension(style?.width), height: dimension(style?.height),
  }}>
    <div ref={fallback} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.25,
      background: `radial-gradient(ellipse at 20% 20%, ${config.cloudTint}, transparent 60%), radial-gradient(ellipse at 80% 80%, ${config.cloudColor}, transparent 60%)` }} />
    <canvas ref={canvas} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
    {children}
  </div>;
}
