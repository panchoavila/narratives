import { toCanvas } from 'html-to-image';
import { DEFAULT_GLITCH, normalizeGlitch, type GlitchConfig } from './glitch-config';
import { createGlitchRenderer } from './glitch-renderer';

function configFor(el: HTMLElement): GlitchConfig {
  const read = (name: keyof GlitchConfig) => {
    const raw = el.getAttribute(`data-glitch-${name.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`);
    return raw === null || raw.trim() === '' ? DEFAULT_GLITCH[name] : Number(raw);
  };
  return normalizeGlitch({ version: 1, intensity: read('intensity'), interval: read('interval'),
    duration: read('duration'), slices: read('slices'), shift: read('shift'),
    rgbShift: read('rgbShift'), blocks: read('blocks'), noise: read('noise') })!;
}

/** Enhance marked elements while retaining their live, interactive DOM. */
export function attachGlitchElements(root: Document | HTMLElement = document): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc.defaultView) return () => {};
  const win: Window = doc.defaultView;
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const items = new Map<HTMLElement, () => void>();
  let stopped = false;

  function bind(el: HTMLElement) {
    if (items.has(el)) return;
    let timer = 0, raf = 0, disposed = false, visible = true, generation = 0;
    let canvas: HTMLCanvasElement | null = null;
    let renderer: ReturnType<typeof createGlitchRenderer> | null = null;
    let cachedImage: HTMLCanvasElement | null = null;
    let contentVersion = 0, capturedVersion = -1, capturePending: Promise<HTMLCanvasElement> | null = null, lastCapture = 0;
    let animated = false, lastAnimationCheck = 0;
    let config = configFor(el);
    const initialDelay = () => {
      const value = Number(el.getAttribute('data-canvas-delay') || 0);
      return Number.isFinite(value) ? Math.max(0, value) * 1000 : 0;
    };
    const stop = (release: boolean) => {
      generation++;
      win.clearTimeout(timer);
      win.cancelAnimationFrame(raf);
      timer = 0; raf = 0;
      if (canvas) canvas.style.display = 'none';
      if (release) {
        renderer?.destroy(); renderer = null;
        canvas?.remove(); canvas = null;
        cachedImage = null; capturedVersion = -1;
      }
    };
    const schedule = (delay: number) => {
      win.clearTimeout(timer);
      if (!disposed && !motion.matches && visible && !doc.hidden) {
        timer = win.setTimeout(() => { timer = 0; void play(); }, delay);
      }
    };
    const capture = async (): Promise<HTMLCanvasElement | null> => {
      if (capturePending) return capturePending;
      if (cachedImage && capturedVersion === contentVersion) return cachedImage;
      if (el.querySelector('canvas,video,iframe') || el.querySelectorAll('*').length > 500) throw Error('unsupported-surface');
      const bounds = el.getBoundingClientRect();
      if (!bounds.width || !bounds.height || bounds.width * bounds.height > 4_000_000) throw Error('capture-budget');
      const version = contentVersion;
      lastCapture = performance.now();
      const pending = toCanvas(el, {
        pixelRatio: Math.min(1, Math.sqrt(1_000_000 / (bounds.width * bounds.height))),
        cacheBust: false,
      });
      capturePending = pending;
      try {
        const image = await pending;
        if (!disposed && visible && !motion.matches && !doc.hidden) { cachedImage = image; capturedVersion = version; }
        return image;
      } finally { if (capturePending === pending) capturePending = null; }
    };
    const updateBounds = () => {
      if (!canvas) return;
      const bounds = el.getBoundingClientRect();
      canvas.style.left = `${bounds.left}px`; canvas.style.top = `${bounds.top}px`;
      canvas.style.width = `${bounds.width}px`; canvas.style.height = `${bounds.height}px`;
      renderer?.setSize(bounds.width, bounds.height);
    };
    const checkAnimations = () => {
      try { animated = typeof el.getAnimations === 'function' && el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'); }
      catch { animated = false; }
    };
    async function refreshImage(token: number) {
      try {
        const image = await capture();
        if (image && token === generation && renderer && !disposed && visible && !motion.matches && !doc.hidden) {
          renderer.setImages([image, image]);
        }
      } catch { /* Keep the last valid image until the next successful capture. */ }
    }
    async function play() {
      if (disposed || motion.matches || !visible || !el.isConnected || doc.hidden) return;
      const token = ++generation;
      try {
        const image = await capture();
        if (!image || disposed || token !== generation || motion.matches || !visible || doc.hidden || !el.isConnected) return;
        if (!canvas) {
          canvas = doc.createElement('canvas');
          canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('data-revyme-effect-overlay', '');
          canvas.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645';
          renderer = createGlitchRenderer(canvas, config, () => { stop(true); });
          doc.body.append(canvas);
        }
        updateBounds();
        renderer!.setConfig(config);
        renderer!.setImages([image, image]);
        canvas.style.display = 'block';
        const start = performance.now();
        let lastPaint = 0;
        const frame = (now: number) => {
          if (disposed || token !== generation || !renderer || !visible || doc.hidden || motion.matches) return;
          const progress = Math.min(1, (now - start) / (config.duration * 1000));
          if (now - lastPaint >= 32 || (config.interval > 0 && progress === 1)) {
            renderer.render(config.interval === 0 ? 0.5 : progress);
            lastPaint = now;
            if (now - lastAnimationCheck >= 1000) {
              checkAnimations(); lastAnimationCheck = now;
            }
            if (animated && now - lastCapture >= 1000 && contentVersion === capturedVersion) contentVersion++;
            if (contentVersion !== capturedVersion && !capturePending && now - lastCapture >= 1000) void refreshImage(token);
          }
          if (config.interval === 0 || progress < 1) {
            raf = win.requestAnimationFrame(frame);
          } else {
            raf = 0;
            if (canvas) canvas.style.display = 'none';
            schedule(config.interval * 1000);
          }
        };
        raf = win.requestAnimationFrame(frame);
      } catch {
        if (token === generation) stop(true);
      }
    }
    const configKeys = new Set(['data-canvas-effect', 'data-canvas-delay', 'data-glitch-intensity', 'data-glitch-interval', 'data-glitch-duration', 'data-glitch-slices', 'data-glitch-shift', 'data-glitch-rgb-shift', 'data-glitch-blocks', 'data-glitch-noise']);
    const observer = new MutationObserver(records => {
      const settingsChanged = records.some(r => r.target === el && r.type === 'attributes' && configKeys.has(r.attributeName ?? ''));
      const contentChanged = records.some(r => !(r.target === el && r.type === 'attributes' && configKeys.has(r.attributeName ?? '')));
      if (contentChanged) contentVersion++;
      if (settingsChanged) { config = configFor(el); stop(false); schedule(initialDelay() + 100); }
    });
    observer.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    const contentChanged = () => { contentVersion++; };
    const onMovement = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && (event.target === el || el.contains(event.target))) contentVersion++;
      updateBounds();
    };
    const onMotion = () => { stop(true); if (!motion.matches) schedule(initialDelay() + 100); };
    const onVisibility = () => { stop(true); if (!doc.hidden) schedule(initialDelay() + 100); };
    const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      stop(true);
      if (visible) schedule(initialDelay() + 100);
    }) : null;
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { contentVersion++; updateBounds(); }) : null;
    intersection?.observe(el); resize?.observe(el);
    el.addEventListener('input', contentChanged, true); el.addEventListener('change', contentChanged, true); el.addEventListener('load', contentChanged, true);
    win.addEventListener('scroll', onMovement, true); win.addEventListener('resize', onMovement);
    motion.addEventListener('change', onMotion); doc.addEventListener('visibilitychange', onVisibility);
    schedule(initialDelay() + 600);
    items.set(el, () => {
      disposed = true; stop(true); observer.disconnect(); intersection?.disconnect(); resize?.disconnect();
      el.removeEventListener('input', contentChanged, true); el.removeEventListener('change', contentChanged, true); el.removeEventListener('load', contentChanged, true);
      win.removeEventListener('scroll', onMovement, true); win.removeEventListener('resize', onMovement);
      motion.removeEventListener('change', onMotion); doc.removeEventListener('visibilitychange', onVisibility);
    });
  }
  const scan = () => {
    if (stopped) return;
    const present = new Set(root.querySelectorAll<HTMLElement>('[data-canvas-effect="glitch"]'));
    for (const [el, cleanup] of items) if (!present.has(el)) { cleanup(); items.delete(el); }
    present.forEach(bind);
  };
  scan();
  const observer = new MutationObserver(records => { if (effectTargetsChanged(records)) scan(); });
  observer.observe(root instanceof Document ? root.documentElement : root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-canvas-effect'] });
  return () => { stopped = true; observer.disconnect(); items.forEach(cleanup => cleanup()); items.clear(); };
}
import { effectTargetsChanged } from './effect-observer';
