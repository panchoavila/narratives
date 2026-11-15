'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { DEFAULT_VHS, normalizeVhs } from './vhs-config';
import { openVhsStage } from './vhs-stage';

const contents = { display: 'contents' } as const;

/** Stable presentation hosts keep child state and focus across each playback. */
export function RevymeVhs({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const anchor = ref.current!;
    const doc = anchor.ownerDocument;
    const win = doc.defaultView!;
    const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
    let stage: ReturnType<typeof openVhsStage> = null;
    let frame = 0;
    let timer = 0;
    let intersection: IntersectionObserver | undefined;
    let unsupported = false;
    const stop = () => {
      win.cancelAnimationFrame(frame);
      win.clearTimeout(timer);
      timer = 0;
      intersection?.disconnect();
      intersection = undefined;
      stage?.destroy();
      stage = null;
    };
    async function play(trigger: 'hover' | 'click', afterDelay = false) {
      if (unsupported || stage || timer || motion.matches || doc.hidden) return;
      const target = anchor.querySelector(':scope > [data-revyme-vhs-content] > :first-child');
      if (target?.getAttribute('data-canvas-effect') !== 'vhs') return;
      let config = DEFAULT_VHS;
      try { config = normalizeVhs(JSON.parse(target.getAttribute('data-vhs') ?? 'null')) ?? DEFAULT_VHS; }
      catch { /* A partially edited preset uses its defaults. */ }
      if (config.trigger !== trigger) return;
      const delay = Number(target.getAttribute('data-canvas-delay'));
      if (!afterDelay && Number.isFinite(delay) && delay > 0) {
        timer = win.setTimeout(() => { timer = 0; void play(trigger, true); }, delay * 1000);
        return;
      }
      const active = openVhsStage(anchor, 'object');
      if (!active) return;
      stage = active;
      if (typeof IntersectionObserver !== 'undefined') {
        intersection = new IntersectionObserver(entries => {
          if (entries[0] && !entries[0].isIntersecting) stop();
        });
        intersection.observe(active.canvas);
      }
      if (!await active.nextPaint() || stage !== active) {
        if (stage === active) stop();
        return;
      }
      const started = win.performance.now();
      let paintedAt = -Infinity;
      const tick = (now: number) => {
        if (stage !== active) return;
        const elapsed = (now - started) / 1000;
        if (active.closed || elapsed >= config.duration) { stop(); return; }
        if (now - paintedAt >= 32) {
          const envelope = Math.min(1, elapsed * 15, (config.duration - elapsed) * 8);
          try { active.draw(config, elapsed, envelope); }
          catch { unsupported = true; stop(); return; }
          paintedAt = now;
        }
        frame = win.requestAnimationFrame(tick);
      };
      tick(started);
    }
    const owns = (event: Event) => event.target instanceof Element &&
      event.target.closest('[data-revyme-vhs-object]') === anchor;
    const click = (event: MouseEvent) => { if (owns(event)) void play('click'); };
    const hover = (event: PointerEvent) => {
      if (owns(event) && (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget))) void play('hover');
    };
    const focus = (event: FocusEvent) => { if (owns(event)) void play('hover'); };
    anchor.addEventListener('click', click);
    anchor.addEventListener('pointerover', hover);
    anchor.addEventListener('focusin', focus);
    motion.addEventListener('change', stop);
    return () => {
      stop();
      anchor.removeEventListener('click', click);
      anchor.removeEventListener('pointerover', hover);
      anchor.removeEventListener('focusin', focus);
      motion.removeEventListener('change', stop);
    };
  }, []);

  return <div ref={ref} data-revyme-vhs-object="" style={contents}><div data-revyme-vhs-content="" style={contents}>{children}</div></div>;
}

export function RevymeVhsPage({ children }: { children: ReactNode }) {
  return <div data-revyme-vhs-page="" style={contents}><div data-revyme-vhs-content="" style={contents}>{children}</div></div>;
}
