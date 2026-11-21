'use client';
import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';

export interface ConfettiProps extends HTMLAttributes<HTMLDivElement> {
  colors?: string[] | string; density?: number; size?: number; speed?: number; delay?: number;
  sizeVariance?: number; speedVariance?: number; flip?: number; flipVariance?: number;
  swayIntensity?: number; dragIntensity?: number; lengthFactor?: number; explode?: boolean;
  explodeDistance?: number; static?: boolean;
}
const palette = ['#f92147', '#4ce893', '#bcff05', '#ff2a12', '#33ff00', '#350adb', '#ffd65b', '#ff0099'];
const clamp = (v: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v!)) : fallback;

/** Decorative, finite particle burst; no work in static/reduced-motion modes. */
export function RevymeConfetti({ colors = palette, density = 128, size = 10, speed = 6.6, delay = 1, sizeVariance = .5, speedVariance = .5, flip = 10, flipVariance = 2, swayIntensity = 3.3, dragIntensity = .4, lengthFactor = 2, explode = true, explodeDistance = 10, static: isStatic = false, style, ...props }: ConfettiProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = Array.isArray(colors) ? colors.join('|') : colors;
  useEffect(() => {
    const host = root.current, surface = canvas.current;
    if (!host || !surface || isStatic) return;
    const doc = host.ownerDocument, win = doc.defaultView;
    if (!win) return;
    const media = win.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    const colorsList = key.split('|').flatMap(s => s.split(/\s*;\s*/)).filter(Boolean);
    const chosen = colorsList.length ? colorsList : palette;
    let frame = 0, timer = 0, started = 0;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (width * height)));
    surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(clamp(density, 128, 0, 500));
    const pieces = Array.from({ length: count }, (_, index) => {
      const angle = Math.random() * Math.PI * 2, velocity = clamp(speed, 6.6, 0, 50) * (1 + (Math.random() - .5) * clamp(speedVariance, .5, 0, 2));
      return { x: explode ? width / 2 : Math.random() * width, y: explode ? height / 2 : -Math.random() * height,
        vx: explode ? Math.cos(angle) * velocity * clamp(explodeDistance, 10, 0, 30) / 10 : 0,
        vy: explode ? Math.sin(angle) * velocity - velocity : velocity,
        size: clamp(size, 10, 1, 100) * (1 + (Math.random() - .5) * clamp(sizeVariance, .5, 0, 2)),
        phase: Math.random() * 6.28, spin: (Math.random() - .5) * clamp(flipVariance, 2, 0, 20) + clamp(flip, 10, 0, 50),
        color: chosen[index % chosen.length] };
    });
    function draw(now: number) {
      if (!ctx || !surface || !win) return;
      if (!started) started = now;
      const elapsed = (now - started) / 1000;
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        p.x += p.vx + Math.sin(elapsed * 2 + p.phase) * clamp(swayIntensity, 3.3, 0, 20) * .15;
        p.y += p.vy; p.vy += .11; p.vx *= 1 - clamp(dragIntensity, .4, 0, 1) * .01;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.phase + elapsed * p.spin * .1); ctx.scale(1, Math.max(.1, Math.abs(Math.cos(elapsed * p.spin * .15))));
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size * lengthFactor / 2, p.size, p.size * lengthFactor); ctx.restore();
      }
      if (elapsed < 12 && pieces.some(p => p.y < height + 100)) frame = win.requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, width, height);
    }
    const stop = () => { win.clearTimeout(timer); win.cancelAnimationFrame(frame); ctx.clearRect(0, 0, width, height); };
    const onMotion = () => { if (media.matches) stop(); };
    media.addEventListener('change', onMotion);
    timer = win.setTimeout(() => { frame = win.requestAnimationFrame(draw); }, clamp(delay, 1, 0, 60) * 1000);
    return () => { stop(); media.removeEventListener('change', onMotion); };
  }, [key, density, size, speed, delay, sizeVariance, speedVariance, flip, flipVariance, swayIntensity, dragIntensity, lengthFactor, explode, explodeDistance, isStatic]);
  return <div {...props} ref={root} aria-hidden="true" style={{ position: 'relative', pointerEvents: 'none', overflow: 'hidden', ...style } as CSSProperties}><canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} /></div>;
}
