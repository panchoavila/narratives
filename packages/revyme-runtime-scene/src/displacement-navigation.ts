import { toCanvas } from 'html-to-image';
import { stopVhsObjects } from './vhs-stage';
import { createDisplacement } from './displacement-renderer';
import { normalizeDisplacement, type DisplacementConfig } from './displacement-config';

export interface DisplacementNavigationOptions {
  config: DisplacementConfig;
  /** Resolves after the destination DOM has committed. Called at most once. */
  navigate: () => Promise<void>;
  signal?: AbortSignal;
  /** Optional renderer lets other snapshot effects reuse the same safe navigation lifecycle. */
  renderer?: (canvas: HTMLCanvasElement, onLost: () => void) => ReturnType<typeof createDisplacement>;
}
export interface DisplacementNavigationResult { mode: 'gpu' | 'fallback' | 'cancelled'; reason?: string }

/** Snapshot enhancement for route navigation. Does not depend on HTML-in-Canvas.
 * Unsupported surfaces retain normal navigation. No global DOM transforms. */
export async function runDisplacementNavigation(options: DisplacementNavigationOptions): Promise<DisplacementNavigationResult> {
  const config = normalizeDisplacement(options.config);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const signal = controller.signal;
  let navigated = false, disposed = false;
  let overlay: HTMLDivElement | null = null;
  let renderer: ReturnType<typeof createDisplacement> | null = null;
  const inert = new Map<HTMLElement, boolean>();
  const previousFocus = document.activeElement as HTMLElement | null;
  const emit = (phase: string, extra: Record<string, unknown> = {}) => document.dispatchEvent(new CustomEvent('revyme:page-transition', { detail: { phase, ...extra } }));
  const abort = (reason: string) => controller.abort(reason);
  const externalAbort = () => abort('cancelled');
  const resized = () => abort('resize');
  const reduced = () => { if (motion.matches) abort('reduced-motion'); };
  const hidden = () => { if (document.hidden) abort('hidden'); };
  const check = () => { if (signal.aborted) throw Error(String(signal.reason || 'cancelled')); };
  function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let ended = false;
      const finish = (value: T | Error, failed = false) => { if (ended) return; ended = true;clearTimeout(timer);signal.removeEventListener('abort', cancelled);failed ? reject(value) : resolve(value as T); };
      const cancelled = () => finish(Error(String(signal.reason || 'cancelled')), true);
      const timer = setTimeout(() => finish(Error('timeout'), true), ms);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled();
      promise.then(v => finish(v), e => finish(e instanceof Error ? e : Error('capture-failed'), true));
    });
  }
  async function navigateOnce() {
    if (navigated || options.signal?.aborted) return;
    navigated = true;emit('navigating');
    // The router adapter owns its own timeout; never start a second navigation.
    await options.navigate();
  }
  function blockUnderlying() {
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child === overlay) continue;
      if (!inert.has(child)) inert.set(child, child.inert);
      child.inert = true;
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
  async function capture() {
    check();
    // Canvas/video/iframe snapshots cannot be promised by this adapter. A future
    // compositor may instead supply its already-owned textures to the renderer.
    const unsupported = [...document.body.querySelectorAll('canvas,video,iframe')].some(el => !overlay?.contains(el) &&
      (!el.hasAttribute('data-revyme-effect-overlay') || el.hasAttribute('data-revyme-liquid-canvas')));
    if (unsupported) throw Error('unsupported-surface');
    if (document.body.querySelectorAll('*').length > 1600) throw Error('capture-budget');
    const width = innerWidth, height = innerHeight;
    const pixelRatio = Math.min(1, Math.sqrt(2_000_000 / Math.max(1, width * height)));
    const particles = [...document.querySelectorAll<HTMLElement>('[data-revyme-particle-active="true"]')];
    particles.forEach(el => el.removeAttribute('data-revyme-particle-active'));
    try {
      return await bounded(toCanvas(document.body, {
        width, height, pixelRatio, cacheBust: false,
        filter: node => !(node instanceof Element && (node.hasAttribute('data-revyme-displacement-overlay') || node.hasAttribute('data-revyme-effect-overlay'))),
        style: { margin: '0', transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: '0 0' },
        backgroundColor: getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)' ? '#ffffff' : getComputedStyle(document.body).backgroundColor,
      }), 1800);
    } finally {
      particles.forEach(el => { if (el.isConnected && el.getAttribute('data-revyme-particle-ready') === 'true') el.setAttribute('data-revyme-particle-active', 'true'); });
    }
  }
  const cleanup = () => {
    if (disposed) return;disposed = true;
    renderer?.destroy();overlay?.remove();
    for (const [node, value] of inert) if (node.isConnected) node.inert = value;
    window.removeEventListener('resize', resized);motion.removeEventListener('change', reduced);
    document.removeEventListener('visibilitychange', hidden);options.signal?.removeEventListener('abort', externalAbort);
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    else if (navigated && !options.signal?.aborted) {
      const heading = document.querySelector<HTMLElement>('main h1,h1,main');
      if (heading && !heading.closest('[inert]')) { const old = heading.getAttribute('tabindex');heading.tabIndex = -1;heading.focus({ preventScroll: true });if (old === null) heading.removeAttribute('tabindex');else heading.setAttribute('tabindex', old); }
    }
  };
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  window.addEventListener('resize', resized);motion.addEventListener('change', reduced);document.addEventListener('visibilitychange', hidden);
  try {
    check();
    stopVhsObjects();
    if (!config) throw Error('invalid-config');
    if (motion.matches) throw Error('reduced-motion');
    const canvas = document.createElement('canvas');canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    renderer = (options.renderer ?? createDisplacement)(canvas, () => abort('context-lost'));
    emit('capturing-old');const old = await capture();check();
    overlay = document.createElement('div');overlay.setAttribute('data-revyme-displacement-overlay', '');overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:auto;overflow:hidden;background:#fff';
    old.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    overlay.append(old);document.body.append(overlay);blockUnderlying();
    await bounded(navigateOnce(), 6000);check();blockUnderlying();
    await bounded(new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), 1000);
    emit('capturing-new');const next = await capture();check();
    renderer.setImages([old, next]);overlay.append(canvas);renderer.render(0, config.seed, config.strength, config.columns);old.remove();
    emit('playing', { duration: config.duration });
    await bounded(new Promise<void>(resolve => {
      const start = performance.now();
      const frame = (time: number) => {
        if (signal.aborted || disposed) { resolve();return; }
        const progress = Math.min(1, (time - start) / (config.duration * 1000));
        renderer!.render(progress, config.seed, config.strength, config.columns);
        overlay!.dataset.progress = String(progress);
        if (progress < 1) requestAnimationFrame(frame);else resolve();
      };
      requestAnimationFrame(frame);
    }), config.duration * 1000 + 1000);
    check();emit('finished');return { mode: 'gpu' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'capture-failed';
    cleanup();
    if (options.signal?.aborted) { emit('cancelled');return { mode: 'cancelled', reason }; }
    emit('fallback', { reason });
    try { await navigateOnce(); } catch { emit('navigation-error'); }
    return { mode: 'fallback', reason };
  } finally { cleanup(); }
}
