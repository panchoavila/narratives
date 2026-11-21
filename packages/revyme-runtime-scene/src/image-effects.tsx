'use client';
import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';

export interface PixelRevelationProps extends HTMLAttributes<HTMLDivElement> {
  image?: string; alt?: string; imageFit?: 'cover' | 'contain' | 'fill'; duration?: number; steps?: number;
  startPixelSize?: number; delay?: number; replay?: boolean; static?: boolean;
}
export interface DitherProps extends HTMLAttributes<HTMLDivElement> {
  image?: string; alt?: string; imageFit?: 'cover' | 'contain' | 'fill'; threshold?: number; brightness?: number;
  midtones?: number; pixelSize?: number; backgroundColor?: string; dotColor?: string; enabled?: boolean; static?: boolean;
}
const limit = (v: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v!)) : fallback;
const imageStyle = (fit: 'cover' | 'contain' | 'fill'): CSSProperties => ({ display: 'block', width: '100%', height: '100%', objectFit: fit });

/** A real nearest-neighbor pixel reveal over the semantic image; CORS failure leaves the image intact. */
export function RevymePixelRevelation({ image = '', alt = '', imageFit = 'cover', duration = 1, steps = 4, startPixelSize = 50, delay = 0, replay = false, static: isStatic = false, style, ...props }: PixelRevelationProps) {
  const root = useRef<HTMLDivElement>(null), img = useRef<HTMLImageElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const host = root.current, source = img.current, target = canvas.current;
    if (!host || !source || !target || !image || isStatic) return;
    const win = host.ownerDocument.defaultView; if (!win) return;
    const media = win.matchMedia('(prefers-reduced-motion: reduce)'); if (media.matches) return;
    const ctx = target.getContext('2d'); if (!ctx) return;
    let frame = 0, started = 0, timer = 0, played = false, cancelled = false, visible = typeof IntersectionObserver !== 'function';
    const scratch = host.ownerDocument.createElement('canvas'), sc = scratch.getContext('2d'); if (!sc) return;
    function render(now: number) {
      if (!ctx || !sc || !target || !source || !win || cancelled) return;
      if (!started) started = now;
      const progress = Math.min(1, (now - started) / (limit(duration, 1, .05, 30) * 1000));
      const count = Math.round(limit(steps, 4, 1, 20)), step = Math.floor(progress * count) / count;
      const pixel = Math.max(1, Math.round(limit(startPixelSize, 50, 1, 200) * (1 - step)));
      const width = Math.max(1, host!.clientWidth), height = Math.max(1, host!.clientHeight);
      const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (width * height)));
      target.width = Math.round(width * dpr); target.height = Math.round(height * dpr);
      scratch.width = Math.max(1, Math.round(width / pixel)); scratch.height = Math.max(1, Math.round(height / pixel));
      const iw = source.naturalWidth, ih = source.naturalHeight;
      if (!iw || !ih) { target.style.opacity = '0'; return; }
      const scale = imageFit === 'contain' ? Math.min(scratch.width / iw, scratch.height / ih) : Math.max(scratch.width / iw, scratch.height / ih);
      const dw = imageFit === 'fill' ? scratch.width : iw * scale, dh = imageFit === 'fill' ? scratch.height : ih * scale;
      sc.clearRect(0, 0, scratch.width, scratch.height); sc.drawImage(source, (scratch.width - dw) / 2, (scratch.height - dh) / 2, dw, dh);
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, target.width, target.height); ctx.drawImage(scratch, 0, 0, target.width, target.height); target.style.opacity = progress < 1 ? '1' : '0';
      if (progress < 1) frame = win.requestAnimationFrame(render); else played = true;
    }
    function begin() { if (!visible || media.matches || !source!.complete || !source!.naturalWidth || (played && !replay)) return; win!.clearTimeout(timer); win!.cancelAnimationFrame(frame); started = 0; timer = win!.setTimeout(() => { frame = win!.requestAnimationFrame(render); }, limit(delay, 0, 0, 60) * 1000); }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) begin(); }) : undefined;
    const onMotion = () => { if (media.matches) { win.clearTimeout(timer); win.cancelAnimationFrame(frame); target.style.opacity = '0'; } else begin(); };
    observer?.observe(host); source.addEventListener('load', begin); media.addEventListener('change', onMotion); if (!observer) begin();
    return () => { cancelled = true; observer?.disconnect(); source.removeEventListener('load', begin); media.removeEventListener('change', onMotion); win.clearTimeout(timer); win.cancelAnimationFrame(frame); };
  }, [image, imageFit, duration, steps, startPixelSize, delay, replay, isStatic]);
  return <div {...props} ref={root} style={{ position: 'relative', overflow: 'hidden', ...style }}><img ref={img} src={image || undefined} alt={alt} style={imageStyle(imageFit)} /><canvas ref={canvas} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }} /></div>;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered 4×4 Bayer dither. The original image stays available on image/CORS/canvas failure. */
export function RevymeDither({ image = '', alt = '', imageFit = 'cover', threshold = 100, brightness = 0, midtones = 50, pixelSize = 6, backgroundColor = '#000000', dotColor = '#ffffff', enabled = true, static: _isStatic = false, style, ...props }: DitherProps) {
  const root = useRef<HTMLDivElement>(null), img = useRef<HTMLImageElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const host = root.current, source = img.current, target = canvas.current;
    if (!host || !source || !target || !image || !enabled) return;
    const doc = host.ownerDocument, win = doc.defaultView, ctx = target.getContext('2d'); if (!win || !ctx) return;
    const scratch = doc.createElement('canvas'), sc = scratch.getContext('2d', { willReadFrequently: true }); if (!sc) return;
    let frame = 0, visible = typeof IntersectionObserver === 'undefined';
    const color = (value: string) => { const el = doc.createElement('span'); el.style.color = value; el.style.display = 'none'; host.appendChild(el); const result = win.getComputedStyle(el).color; el.remove(); return result; };
    function draw() {
      if (!source || !target || !host || !ctx || !sc || !source.naturalWidth) return;
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), px = Math.max(1, Math.round(limit(pixelSize, 6, 1, 100) / 4));
      scratch.width = Math.max(1, Math.ceil(width / px)); scratch.height = Math.max(1, Math.ceil(height / px));
      const iw = source.naturalWidth, ih = source.naturalHeight;
      const scale = imageFit === 'contain' ? Math.min(scratch.width / iw, scratch.height / ih) : Math.max(scratch.width / iw, scratch.height / ih);
      const dw = imageFit === 'fill' ? scratch.width : iw * scale, dh = imageFit === 'fill' ? scratch.height : ih * scale;
      sc.clearRect(0, 0, scratch.width, scratch.height); sc.drawImage(source, (scratch.width - dw) / 2, (scratch.height - dh) / 2, dw, dh);
      let pixels: ImageData; try { pixels = sc.getImageData(0, 0, scratch.width, scratch.height); } catch { target.style.opacity = '0'; return; }
      const dpr = Math.min(win!.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (width * height)));
      target.width = Math.round(width * dpr); target.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = color(backgroundColor); ctx.fillRect(0, 0, width, height); ctx.fillStyle = color(dotColor);
      const adjust = (50 - limit(midtones, 50, 0, 100)) * 1.8;
      for (let y = 0; y < scratch.height; y++) for (let x = 0; x < scratch.width; x++) {
        const i = (y * scratch.width + x) * 4, value = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722 + brightness + adjust;
        if (pixels.data[i + 3] && value + (BAYER[(y % 4) * 4 + x % 4] - 7.5) * 8 > threshold) ctx.fillRect(x * px, y * px, px, px);
      }
      target.style.opacity = '1';
    }
    const schedule = () => { win.cancelAnimationFrame(frame); if (visible) frame = win.requestAnimationFrame(draw); };
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; schedule(); }) : undefined;
    source.addEventListener('load', schedule); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    observer?.observe(host); intersection?.observe(host); schedule();
    return () => { source.removeEventListener('load', schedule); observer?.disconnect(); intersection?.disconnect(); win.cancelAnimationFrame(frame); };
  }, [image, imageFit, threshold, brightness, midtones, pixelSize, backgroundColor, dotColor, enabled]);
  return <div {...props} ref={root} style={{ position: 'relative', overflow: 'hidden', ...style }}><img ref={img} src={image || undefined} alt={alt} style={imageStyle(imageFit)} /><canvas ref={canvas} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }} /></div>;
}
