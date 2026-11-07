import { toCanvas } from 'html-to-image';
import { DEFAULT_RIPPLE, normalizeRipple } from './ripple-config';
import { createRippleRenderer } from './ripple-renderer';

/** Apply pointer- or timer-driven ripples without taking ownership of the DOM. */
export function attachRippleElements(root: Document | HTMLElement = document): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc.defaultView) return () => {};
  const win: Window = doc.defaultView;
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const mounted = new Map<HTMLElement, () => void>();
  let stopped = false;

  function mount(el: HTMLElement) {
    if (mounted.has(el)) return;
    let active = true, visible = true, raf = 0, timer = 0, generation = 0, lastHover = 0;
    let renderer: ReturnType<typeof createRippleRenderer> | null = null;
    let canvas: HTMLCanvasElement | null = null, cached: HTMLCanvasElement | null = null;
    let contentVersion = 0, capturedVersion = -1, pending: Promise<HTMLCanvasElement> | null = null;
    const read = () => {
      try { return normalizeRipple(JSON.parse(el.getAttribute('data-ripple') || '')) ?? DEFAULT_RIPPLE; }
      catch { return DEFAULT_RIPPLE; }
    };
    const clear = (release: boolean) => {
      generation++;
      win.clearTimeout(timer); win.cancelAnimationFrame(raf); timer = 0; raf = 0;
      if (canvas) canvas.style.display = 'none';
      if (release) { renderer?.destroy(); renderer = null; canvas?.remove(); canvas = null; cached = null; capturedVersion = -1; }
    };
    const schedule = () => {
      win.clearTimeout(timer);
      const cfg = read();
      if (active && visible && !media.matches && !doc.hidden && cfg.interval > 0) {
        timer = win.setTimeout(() => { timer = 0; void play(Math.random(), Math.random()); }, cfg.interval * 1000);
      }
    };
    const capture = async () => {
      if (pending) return pending;
      let animated = false;
      try { animated = typeof el.getAnimations === 'function' && el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'); } catch { /* retain the normal cache */ }
      if (cached && capturedVersion === contentVersion && !animated) return cached;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.width * box.height > 4_000_000 || el.querySelector('canvas,video,iframe') || el.querySelectorAll('*').length > 500) throw Error('unsupported-surface');
      const version = contentVersion;
      const promise = toCanvas(el, { pixelRatio: Math.min(1, Math.sqrt(1_000_000 / (box.width * box.height))), cacheBust: false });
      pending = promise;
      try {
        const image = await promise;
        if (active && visible && !media.matches && !doc.hidden) { cached = image; capturedVersion = version; }
        return image;
      } finally { if (pending === promise) pending = null; }
    };
    const updateBounds = () => {
      if (!canvas) return;
      const box = el.getBoundingClientRect();
      canvas.style.left = `${box.left}px`; canvas.style.top = `${box.top}px`;
      canvas.style.width = `${box.width}px`; canvas.style.height = `${box.height}px`;
      renderer?.setSize(box.width, box.height);
    };
    async function play(x: number, y: number) {
      if (!active || !visible || media.matches || doc.hidden || !el.isConnected) return;
      clear(false);
      const id = generation, cfg = read();
      try {
        const image = await capture();
        if (!active || id !== generation || !visible || doc.hidden || !el.isConnected || media.matches) return;
        if (!canvas) {
          canvas = doc.createElement('canvas');
          canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('data-revyme-effect-overlay', '');
          canvas.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645';
          renderer = createRippleRenderer(canvas, cfg, { x, y }, () => { clear(true); });
          doc.body.append(canvas);
        }
        updateBounds();
        renderer!.setConfig(cfg, { x, y }); renderer!.setImages([image, image]);
        canvas.style.display = 'block';
        const start = performance.now(), duration = Math.min(4, Math.max(.3, 1.2 / cfg.speed)) * 1000;
        let last = 0;
        const frame = (now: number) => {
          if (!active || id !== generation || !renderer || !visible || doc.hidden || media.matches) return;
          const progress = Math.min(1, (now - start) / duration);
          if (now - last >= 32 || progress === 1) { renderer.render(progress); last = now; }
          if (progress < 1) raf = win.requestAnimationFrame(frame);
          else { raf = 0; if (canvas) canvas.style.display = 'none'; schedule(); }
        };
        raf = win.requestAnimationFrame(frame);
      } catch { if (id === generation) clear(true); }
    }
    const point = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(box.width, 1))),
        y: Math.max(0, Math.min(1, (event.clientY - box.top) / Math.max(box.height, 1))) };
    };
    const down = (event: PointerEvent) => { if (read().trigger === 'click') { const p = point(event); void play(p.x, p.y); } };
    const move = (event: PointerEvent) => {
      if (read().trigger === 'hover' && performance.now() - lastHover > 400) { lastHover = performance.now(); const p = point(event); void play(p.x, p.y); }
    };
    const contentChanged = () => { contentVersion++; };
    const observer = new MutationObserver(records => {
      const settingsChanged = records.some(r => r.target === el && r.type === 'attributes' && r.attributeName === 'data-ripple');
      if (records.some(r => !(r.target === el && r.type === 'attributes' && r.attributeName === 'data-ripple'))) contentChanged();
      if (settingsChanged) { clear(false); schedule(); }
    });
    observer.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true; clear(true); if (visible) schedule();
    }) : null;
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { contentChanged(); updateBounds(); }) : null;
    const movement = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && (event.target === el || el.contains(event.target))) contentChanged();
      updateBounds();
    };
    const onMedia = () => { clear(true); if (!media.matches) schedule(); };
    const onVisibility = () => { clear(true); if (!doc.hidden) schedule(); };
    intersection?.observe(el); resize?.observe(el);
    el.addEventListener('pointerdown', down, { passive: true }); el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('input', contentChanged, true); el.addEventListener('change', contentChanged, true); el.addEventListener('load', contentChanged, true);
    win.addEventListener('scroll', movement, true); win.addEventListener('resize', movement);
    media.addEventListener('change', onMedia); doc.addEventListener('visibilitychange', onVisibility);
    schedule();
    mounted.set(el, () => {
      active = false; clear(true); observer.disconnect(); intersection?.disconnect(); resize?.disconnect();
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('input', contentChanged, true); el.removeEventListener('change', contentChanged, true); el.removeEventListener('load', contentChanged, true);
      win.removeEventListener('scroll', movement, true); win.removeEventListener('resize', movement);
      media.removeEventListener('change', onMedia); doc.removeEventListener('visibilitychange', onVisibility);
    });
  }
  const scan = () => {
    if (stopped) return;
    const nodes = new Set(root.querySelectorAll<HTMLElement>('[data-canvas-effect="ripple-water"]'));
    for (const [el, cleanup] of mounted) if (!nodes.has(el)) { cleanup(); mounted.delete(el); }
    nodes.forEach(mount);
  };
  scan();
  const observer = new MutationObserver(records => { if (effectTargetsChanged(records)) scan(); });
  observer.observe(root instanceof Document ? root.documentElement : root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-canvas-effect'] });
  return () => { stopped = true; observer.disconnect(); mounted.forEach(cleanup => cleanup()); mounted.clear(); };
}
import { effectTargetsChanged } from './effect-observer';
