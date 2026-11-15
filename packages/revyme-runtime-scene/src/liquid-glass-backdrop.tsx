'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

type MovableHost = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
type DrawableCanvas = HTMLCanvasElement & MovableHost & { content?: string; requestPaint?: () => void };
type DrawableContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number, width: number, height: number) => void;
};

/** Full-size background for a positioned scene. Keep its lenses as siblings. */
export function RevymeLiquidBackdrop({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = ref.current! as MovableHost;
    const doc = host.ownerDocument;
    const win = doc.defaultView;
    const content = host.firstElementChild!;
    const canvas = doc.createElement('canvas') as DrawableCanvas;
    canvas.setAttribute('content', 'drawable');
    if (!win || canvas.content !== 'drawable' || !canvas.requestPaint ||
        !canvas.moveBefore || !host.moveBefore) return;
    const ctx = canvas.getContext('2d') as DrawableContext | null;
    if (!ctx?.drawElementImage) return;

    canvas.style.cssText = 'display:block;width:100%;height:100%';
    let ready = false;
    let closed = false;
    let timer = 0;
    const observer = new ResizeObserver(() => canvas.requestPaint!());

    function close() {
      if (closed) return;
      closed = true;
      win!.clearTimeout(timer);
      observer.disconnect();
      canvas.removeEventListener('paint', paint);
      canvas.removeEventListener('contextlost', close);
      canvas.removeEventListener('revyme:glass-backdrop-error', close);
      if (content.parentNode === canvas) {
        if (host.isConnected) host.moveBefore!(content, canvas);
        else host.insertBefore(content, canvas);
      }
      content.removeAttribute('drawable');
      canvas.remove();
      canvas.width = canvas.height = 0;
    }

    function paint() {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(win!.devicePixelRatio || 1, 1.5,
        Math.sqrt(1_500_000 / (width * height)), 4096 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * ratio));
      const h = Math.max(1, Math.round(height * ratio));
      try {
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx!.clearRect(0, 0, w, h);
        ctx!.drawElementImage!(content, 0, 0, w, h);
      } catch {
        close();
        return;
      }
      if (!ready) {
        ready = true;
        win!.clearTimeout(timer);
        canvas.dataset.revymeGlassBackdrop = '';
      }
      canvas.dispatchEvent(new Event('revyme:glass-backdrop-frame'));
    }

    host.append(canvas);
    content.setAttribute('drawable', '');
    try {
      canvas.moveBefore(content, null);
    } catch {
      close();
      return;
    }
    canvas.addEventListener('paint', paint);
    canvas.addEventListener('contextlost', close);
    canvas.addEventListener('revyme:glass-backdrop-error', close);
    observer.observe(host);
    timer = win.setTimeout(close, 1000);
    canvas.requestPaint();
    return close;
  }, []);

  return <div ref={ref} data-revyme-glass-backdrop-host="" style={{ position: 'absolute', inset: 0 }}>
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
  </div>;
}
