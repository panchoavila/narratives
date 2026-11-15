/** Configurable glyph rain overlay. CSS dimensions and seconds match Revyme controls. */
export interface GlyphRainConfig {
  version: 1;
  cell: number;
  speed: number;
  density: number;
  trail: number;
  glow: number;
  dim: number;
  light: number;
  lightRadius: number;
  stir: number;
  color: string;
  headColor: string;
  charset: string;
}
export const DEFAULT_GLYPH_RAIN: GlyphRainConfig = {
  version: 1,
  cell: 15,
  speed: .2,
  density: .15,
  trail: .65,
  glow: 1.75,
  dim: .5,
  light: 2.8,
  lightRadius: 240,
  stir: .7,
  color: '#4474ff',
  headColor: '#87beff',
  charset: 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789'
};
export function normalizeGlyphRain(input: unknown): GlyphRainConfig | null {
  if (!input || typeof input !== 'object' || (input as {
    version?: unknown;
  }).version !== 1) return null;
  const v = input as Record<string, unknown>;
  const n = (key: Exclude<keyof GlyphRainConfig, 'version' | 'color' | 'headColor' | 'charset'>, min: number, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.min(max, Math.max(min, v[key] as number)) : DEFAULT_GLYPH_RAIN[key];
  const color = (key: 'color' | 'headColor') => typeof v[key] === 'string' && /^#[0-9a-f]{6}$/i.test(v[key] as string) ? v[key] as string : DEFAULT_GLYPH_RAIN[key];
  return {
    version: 1,
    cell: Math.round(n('cell', 8, 64)),
    speed: n('speed', .05, 3),
    density: n('density', 0, 1),
    trail: n('trail', .2, 3),
    glow: n('glow', 0, 3),
    dim: n('dim', 0, 1),
    light: n('light', 0, 3),
    lightRadius: n('lightRadius', 20, 600),
    stir: n('stir', 0, 1),
    color: color('color'),
    headColor: color('headColor'),
    charset: typeof v.charset === 'string' && v.charset.length ? Array.from(v.charset).slice(0, 128).join('') : DEFAULT_GLYPH_RAIN.charset
  };
}

/** Mount an independent overlay only on marked elements; the original DOM keeps input and focus. */
export function attachGlyphRainElements(root: Document | HTMLElement = document): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc.defaultView) return () => {};
  const win: Window = doc.defaultView,
    media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const mounted = new Map<HTMLElement, () => void>();
  let disposed = false;
  function mount(el: HTMLElement) {
    if (mounted.has(el)) return;
    let raf = 0,
      active = true,
      visible = true,
      last = 0;
    const pointer = {
      x: -10000,
      y: -10000,
      time: 0
    };
    const read = () => {
      try {
        return normalizeGlyphRain(JSON.parse(el.getAttribute('data-glyph-rain') || '')) ?? DEFAULT_GLYPH_RAIN;
      } catch {
        return DEFAULT_GLYPH_RAIN;
      }
    };
    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-revyme-effect-overlay', '');
    canvas.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    doc.body.append(canvas);
    let config = read();
    type StreamSprite = { canvas: HTMLCanvasElement; headY: number; count: number };
    let sprites: StreamSprite[] = [];
    let spritesKey = '';
    let lightSprite: HTMLCanvasElement | null = null;
    let lightKey = '';
    const streams: {
      x: number;
      y: number;
      velocity: number;
      sprite: number;
    }[] = [];
    let sizeKey = '';
    let bounds = el.getBoundingClientRect();
    const updateBounds = () => {
      bounds = el.getBoundingClientRect();
      canvas.style.left = bounds.left + 'px';
      canvas.style.top = bounds.top + 'px';
      canvas.style.width = bounds.width + 'px';
      canvas.style.height = bounds.height + 'px';
      wake();
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateBounds) : null;
    resizeObserver?.observe(el);
    function prepareSprites(cfg: GlyphRainConfig) {
      const key = [cfg.cell, cfg.trail, cfg.glow, cfg.color, cfg.headColor, cfg.charset].join('|');
      if (key === spritesKey) return;
      spritesKey = key;
      const glyphs = Array.from(cfg.charset);
      const padding = Math.ceil(cfg.glow * 6 + 2);
      sprites = Array.from({ length: 16 }, (_, variant) => {
        const count = Math.max(1, Math.floor((4 + (variant % 12)) * cfg.trail));
        const sprite = doc.createElement('canvas');
        sprite.width = cfg.cell + padding * 2;
        sprite.height = count * cfg.cell + padding * 2;
        const pen = sprite.getContext('2d')!;
        pen.font = `600 ${Math.max(8, cfg.cell * .8)}px monospace`;
        pen.textAlign = 'center'; pen.textBaseline = 'middle';
        const headY = padding + (count - .5) * cfg.cell;
        for (let i = count - 1; i >= 0; i--) {
          pen.globalAlpha = (1 - i / (count + 1)) * Math.min(1, .28 + cfg.glow * .22);
          pen.fillStyle = i === 0 ? cfg.headColor : cfg.color;
          pen.shadowColor = cfg.color; pen.shadowBlur = i === 0 ? cfg.glow * 6 : 0;
          pen.fillText(glyphs[(variant * 7 + i) % glyphs.length], sprite.width / 2, headY - i * cfg.cell);
        }
        return { canvas: sprite, headY, count };
      });
    }
    function prepareLight(cfg: GlyphRainConfig) {
      const key = String(cfg.light);
      if (key === lightKey && lightSprite) return;
      lightKey = key;
      // A small cached mask scales smoothly to the selected light radius.
      const sprite = doc.createElement('canvas');
      sprite.width = sprite.height = 256;
      const pen = sprite.getContext('2d')!;
      const grad = pen.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, `rgba(0,0,0,${Math.min(.95, cfg.light / 3)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      pen.fillStyle = grad; pen.fillRect(0, 0, 256, 256);
      lightSprite = sprite;
    }
    function resize(config: GlyphRainConfig) {
      const rect = bounds;
      const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4000000 / Math.max(1, rect.width * rect.height)));
      const w = Math.max(1, Math.round(rect.width * dpr)),
        h = Math.max(1, Math.round(rect.height * dpr));
      const key = [w, h, config.cell, config.density].join(':');
      if (key !== sizeKey) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        sizeKey = key;
        streams.length = 0;
        const columns = Math.min(300, Math.ceil(rect.width / config.cell));
        for (let i = 0; i < columns; i++) if (Math.random() < config.density) streams.push({
          x: (i + .5) * config.cell,
          y: Math.random() * rect.height,
          velocity: .65 + Math.random() * .7,
          sprite: Math.floor(Math.random() * 16)
        });
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return rect;
    }
    function frame(now: number) {
      raf = 0;
      if (!active || !visible || media.matches || doc.hidden || !el.isConnected) {
        canvas.style.display = 'none';
        last = 0;
        return;
      }
      if (last && now - last < 32) {
        raf = win.requestAnimationFrame(frame);
        return;
      }
      canvas.style.display = 'block';
      const cfg = config,
        rect = resize(cfg),
        dt = last ? Math.min((now - last) / 1000, .05) : 0;
      last = now;
      prepareSprites(cfg);
      prepareLight(cfg);
      ctx!.clearRect(0, 0, rect.width, rect.height);
      ctx!.fillStyle = `rgba(0,0,8,${cfg.dim})`;
      ctx!.fillRect(0, 0, rect.width, rect.height);
      // Each head opens a soft pool through the dim layer to illuminate live content.
      ctx!.globalCompositeOperation = 'destination-out';
      for (const s of streams) {
        const radius = cfg.lightRadius;
        ctx!.drawImage(lightSprite!, s.x - radius, s.y - radius, radius * 2, radius * 2);
      }
      ctx!.globalCompositeOperation = 'source-over';
      for (const s of streams) {
        const stirred = Math.abs(s.x - pointer.x) < 130 && now - pointer.time < 900 ? cfg.stir * 2 : 0;
        s.y += dt * rect.height * cfg.speed * s.velocity * (1 + stirred);
        const sprite = sprites[s.sprite];
        if (s.y > rect.height + sprite.count * cfg.cell) s.y = -cfg.cell;
        ctx!.drawImage(sprite.canvas, s.x - sprite.canvas.width / 2, s.y - sprite.headY);
      }
      if (streams.length) raf = win.requestAnimationFrame(frame);
    }
    const wake = () => {
      if (active && visible && !media.matches && !doc.hidden && !raf) raf = win.requestAnimationFrame(frame);else if (media.matches || doc.hidden) {
        canvas.style.display = 'none';
      }
    };
    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.time = performance.now();
      wake();
    };
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      wake();
    }) : null;
    io?.observe(el);
    const configObserver = new MutationObserver(() => { config = read(); wake(); });
    configObserver.observe(el, {
      attributes: true,
      attributeFilter: ['data-glyph-rain']
    });
    el.addEventListener('pointermove', onPointer, {
      passive: true
    });
    media.addEventListener('change', wake);
    doc.addEventListener('visibilitychange', wake);
    win.addEventListener('resize', updateBounds);
    win.addEventListener('scroll', updateBounds, true);
    updateBounds();
    mounted.set(el, () => {
      active = false;
      win.cancelAnimationFrame(raf);
      io?.disconnect();
      configObserver.disconnect();
      resizeObserver?.disconnect();
      el.removeEventListener('pointermove', onPointer);
      media.removeEventListener('change', wake);
      doc.removeEventListener('visibilitychange', wake);
      win.removeEventListener('resize', updateBounds);
      win.removeEventListener('scroll', updateBounds, true);
      canvas.remove();
    });
  }
  const scan = () => {
    if (disposed) return;
    const nodes = new Set(root.querySelectorAll<HTMLElement>('[data-canvas-effect="glyph-rain"]'));
    for (const [el, cleanup] of mounted) if (!nodes.has(el)) {
      cleanup();
      mounted.delete(el);
    }
    nodes.forEach(mount);
  };
  scan();
  const observer = new MutationObserver(records => { if (effectTargetsChanged(records)) scan(); });
  observer.observe(root instanceof Document ? root.documentElement : root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-canvas-effect']
  });
  return () => {
    disposed = true;
    observer.disconnect();
    mounted.forEach(cleanup => cleanup());
    mounted.clear();
  };
}
import { effectTargetsChanged } from './effect-observer';
