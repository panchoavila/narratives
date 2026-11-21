'use client';
import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

export interface GalleryTrailProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode; images?: string[] | string; targetId?: string; width?: number; height?: number; frequency?: number;
  visibleFor?: number; radius?: number; fit?: 'fit' | 'fill' | 'stretch'; static?: boolean;
}
/** Adds temporary decorative images to a pointer trail; the source content stays live. */
export function RevymeGalleryTrail({ children, images = [], targetId = '', width = 320, height = 320, frequency = 1, visibleFor = 2, radius = 0, fit = 'fit', static: isStatic = false, style, ...props }: GalleryTrailProps) {
  const root = useRef<HTMLDivElement>(null), pool = useRef<HTMLDivElement>(null);
  const key = Array.isArray(images) ? images.join('\u0000') : images.split('|').join('\u0000');
  useEffect(() => {
    const layer = root.current, source = pool.current; if (!layer || !source || !targetId || isStatic) return;
    const doc = layer.ownerDocument, win = doc.defaultView; if (!win) return;
    const media = win.matchMedia('(prefers-reduced-motion: reduce)');
    let target: Element | undefined;
    let sources = key.split('\u0000').filter(Boolean);
    const refresh = () => {
      const found: string[] = [];
      for (const el of Array.from(source.querySelectorAll<HTMLElement>('img, [style*="background"]'))) {
        const image = el instanceof win.HTMLImageElement ? el.currentSrc || el.getAttribute('src') : null;
        const background = win.getComputedStyle(el).backgroundImage;
        const match = background.match(/^url\(["']?(.*?)["']?\)$/);
        const url = image || match?.[1]; if (url) found.push(url);
      }
      sources = [...key.split('\u0000').filter(Boolean), ...found];
    };
    refresh();
    const mutation = new MutationObserver(refresh);
    mutation.observe(source, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class'] });
    const active = new Set<HTMLElement>();
    const timers = new Set<number>(); let cursor = 0, lastX = 0, lastY = 0, primed = false;
    function clear() { for (const t of timers) win!.clearTimeout(t); timers.clear(); for (const image of active) image.remove(); active.clear(); }
    function onMove(e: Event) {
      const event = e as PointerEvent; if (event.pointerType === 'touch' || media.matches || !sources.length) return;
      if (!primed) { lastX = event.clientX; lastY = event.clientY; primed = true; return; }
      if (Math.hypot(event.clientX - lastX, event.clientY - lastY) < 40 / Math.max(.1, Math.min(10, frequency))) return;
      lastX = event.clientX; lastY = event.clientY;
      const el = doc.createElement('img'); el.src = sources[cursor++ % sources.length]; el.alt = ''; el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, { position: 'fixed', left: event.clientX + 'px', top: event.clientY + 'px', width: Math.max(1, Math.min(width, 2000)) + 'px', height: Math.max(1, Math.min(height, 2000)) + 'px', borderRadius: Math.max(0, radius) + 'px', objectFit: fit === 'fit' ? 'contain' : fit === 'stretch' ? 'fill' : 'cover', pointerEvents: 'none', transform: 'translate(-50%, -50%)', willChange: 'transform, opacity, filter' });
      layer!.appendChild(el); active.add(el);
      el.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      const life = Math.max(.1, Math.min(visibleFor, 20)) * 1000;
      const timer = win!.setTimeout(() => {
        timers.delete(timer);
        const out = el.animate([{ opacity: 1, filter: 'blur(0px)', transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, filter: 'blur(10px)', transform: 'translate(-50%,-50%) scale(.5)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
        out.onfinish = () => { el.remove(); active.delete(el); };
      }, life); timers.add(timer);
      if (active.size > 50) { const oldest = active.values().next().value as HTMLElement | undefined; oldest?.remove(); if (oldest) active.delete(oldest); }
    }
    const onLeave = () => { primed = false; }; const onMotion = () => { if (media.matches) clear(); };
    const attach = () => {
      const next = Array.from(doc.querySelectorAll('[data-id]')).find(el => el.getAttribute('data-id') === targetId);
      if (next === target) return;
      target?.removeEventListener('pointermove', onMove); target?.removeEventListener('pointerleave', onLeave);
      target = next; primed = false;
      target?.addEventListener('pointermove', onMove, { passive: true }); target?.addEventListener('pointerleave', onLeave);
    };
    attach();
    const targetObserver = new MutationObserver(() => { if (!target?.isConnected) attach(); }); targetObserver.observe(doc.body, { childList: true, subtree: true });
    media.addEventListener('change', onMotion);
    return () => { target?.removeEventListener('pointermove', onMove); target?.removeEventListener('pointerleave', onLeave); targetObserver.disconnect(); media.removeEventListener('change', onMotion); mutation.disconnect(); clear(); };
  }, [key, targetId, width, height, frequency, visibleFor, radius, fit, isStatic]);
  return <div {...props} ref={root} data-revyme-gallery-trail="" style={{ position: isStatic ? 'relative' : 'fixed', inset: isStatic ? undefined : 0, pointerEvents: isStatic ? undefined : 'none', zIndex: 10, ...style } as CSSProperties}>
    <div ref={pool} data-gallery-trail-source="" aria-hidden={isStatic ? undefined : true} style={isStatic ? undefined : { display: 'none' }}>{children}</div>
  </div>;
}
