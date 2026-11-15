import { parseLiquidGlassAttribute, type LiquidGlassConfig } from './liquid-glass-config';
import { attachGlassInteraction } from './liquid-glass-interaction';
import type { LiquidEngine, LiquidLens } from './vendor/liquid-gl';

interface Entry {
  el: HTMLElement;
  id: string;
  config: LiquidGlassConfig;
  signature: string;
  visible: boolean;
  generation: number;
  position: { x: number; y: number };
  scene?: HTMLElement;
  backdrop?: HTMLCanvasElement;
  lens?: LiquidLens;
  stopInteraction?: () => void;
  stopContext?: () => void;
  timeout?: number;
}

const managers = new WeakMap<Document, { references: number; stop: () => void }>();
let nextId = 0;

/** One observer/engine per document, shared by the preview and generated client entry. */
export function attachLiquidGlassElements(doc: Document, options: { editing?: boolean } = {}): () => void {
  const win = doc.defaultView;
  if (!win || !doc.body) return () => {};
  const previous = managers.get(doc);
  if (previous) {
    previous.references++;
    return () => { if (--previous.references === 0) previous.stop(); };
  }
  const entries = new Map<HTMLElement, Entry>();
  const roots = new Map<HTMLElement, string>();
  const registeredDynamics = new WeakSet<Element>();
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false, scanFrame = 0, dynamicFrame = 0, animationDiscovery = 0;
  let engine: LiquidEngine | undefined;
  let loading: Promise<LiquidEngine | undefined> | undefined;
  const dynamicCandidates = new Set<Element>();
  const style = doc.createElement('style');
  style.dataset.revymeLiquidStyles = '';
  style.textContent = `
    [data-revyme-liquid-state="fallback"] { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); background-color: var(--revyme-glass-tint, #ffffff22); }
    [data-revyme-liquid-drag] { touch-action: none; cursor: grab; }
    [data-revyme-liquid-drag]:active { cursor: grabbing; }
  `;
  doc.head.append(style);

  const emit = (entry: Entry, state: string, reason?: string) => {
    entry.el.dataset.revymeLiquidState = state;
    entry.el.dispatchEvent(new CustomEvent('revyme:glass-state', {
      bubbles: true, detail: { nodeId: entry.el.getAttribute('data-id') ?? entry.el.getAttribute('data-node-id'), state, reason },
    }));
  };
  function release(entry: Entry) {
    entry.generation++;
    win!.clearTimeout(entry.timeout);
    entry.stopInteraction?.(); entry.stopInteraction = undefined;
    entry.stopContext?.(); entry.stopContext = undefined;
    entry.lens?.destroy(); entry.lens = undefined;
    delete entry.el.dataset.revymeLiquidSource;
    if (![...entries.values()].some(other => other.lens)) { win!.clearInterval(animationDiscovery); animationDiscovery = 0; }
  }
  function fallback(entry: Entry, reason: string) {
    release(entry);
    entry.el.style.setProperty('--revyme-glass-tint', entry.config.tint);
    emit(entry, 'fallback', reason);
  }
  function scopedRoot(entry: Entry) {
    if (entry.backdrop) return { liveBackdrop: entry.backdrop, anchor: entry.scene };
    const root = entry.scene ?? (options.editing ? entry.el.closest<HTMLElement>('[data-viewport]') : null);
    if (!root) return { snapshot: 'body' };
    let id = roots.get(root);
    if (!id) { id = `root-${++nextId}`; roots.set(root, id); root.dataset.revymeGlassRoot = id; }
    return { snapshot: `[data-revyme-glass-root="${id}"]`, anchor: root };
  }
  function effective(entry: Entry): LiquidGlassConfig {
    return options.editing || reduced.matches
      ? { ...entry.config, reveal: 'none', specular: false, tilt: false, draggable: false, interaction: 'none', audioReactive: false }
      : entry.config;
  }
  function measureEditorElement(element: Element): DOMRect {
    const rect = element.getBoundingClientRect();
    const root = element.closest<HTMLElement>('[data-viewport]');
    if (!root) return rect;
    const viewport = root.getBoundingClientRect();
    const sx = viewport.width / Math.max(1, root.offsetWidth);
    const sy = viewport.height / Math.max(1, root.offsetHeight);
    if (!sx || !sy) return rect;
    // The editor camera scales both HTML and its child canvas. Render in the
    // viewport's own CSS coordinates so that camera zoom is applied only once.
    return new DOMRect((rect.left - viewport.left) / sx, (rect.top - viewport.top) / sy, rect.width / sx, rect.height / sy);
  }
  function interaction(entry: Entry) {
    entry.stopInteraction?.();
    if (entry.lens) entry.stopInteraction = attachGlassInteraction(entry.el, entry.lens, { ...effective(entry), tilt: false }, entry.position);
  }
  function scheduleDynamics() {
    if (dynamicFrame || disposed || !engine || options.editing) return;
    dynamicFrame = win!.requestAnimationFrame(() => {
      dynamicFrame = 0;
      // WAAPI-backed Motion/CSS animations do not mutate inline style each frame.
      for (const animation of doc.getAnimations?.() ?? []) {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (target instanceof Element && !target.closest('[data-liquid-ignore]')) dynamicCandidates.add(target);
      }
      const fresh = [...dynamicCandidates].filter(el => el.isConnected && !registeredDynamics.has(el) && !entries.has(el as HTMLElement));
      dynamicCandidates.clear();
      if (fresh.length) { fresh.forEach(el => registeredDynamics.add(el)); engine!.registerDynamic(fresh); }
    });
  }
  async function start(entry: Entry) {
    if (disposed || !entry.visible || doc.hidden || entry.lens) return;
    const generation = ++entry.generation;
    emit(entry, 'loading');
    try {
      loading ??= import('./vendor/liquid-gl.js').then(module => module.default(options.editing ? { measureElement: measureEditorElement } : undefined));
      engine = await loading;
      if (disposed || entry.generation !== generation || !entry.visible || doc.hidden || !entry.el.isConnected) return;
      if (!engine) { fallback(entry, 'engine-unavailable'); return; }
      const config = effective(entry);
      let initialized = false;
      const result = engine({
        ...config, ...scopedRoot(entry), target: `[data-revyme-liquid-id="${entry.id}"]`,
        // These channels are composed additively by Revyme, independently of Motion.
        tilt: config.tilt && !config.draggable, draggable: false, preserveMotion: true,
        on: { init(lens) {
          initialized = true;
          if (disposed || entry.generation !== generation) return;
          entry.lens = lens;
          win!.clearTimeout(entry.timeout);
          entry.el.dataset.revymeLiquidBackend = lens.renderer?.backend?.gl ? 'webgl' : 'webgpu';
          entry.el.dataset.revymeLiquidSource = entry.backdrop ? 'native' : 'rasterized';
          emit(entry, 'ready'); interaction(entry); scheduleDynamics();
        } },
      });
      const lens = Array.isArray(result) ? result[0] : result;
      if (!lens) { fallback(entry, 'target-unavailable'); return; }
      entry.lens = lens;
      if (!options.editing && !animationDiscovery) animationDiscovery = win!.setInterval(scheduleDynamics, 250);
      if (!lens.renderer) { fallback(entry, 'gpu-unavailable'); return; }
      const canvas = lens.renderer.canvas;
      canvas.dataset.revymeEffectOverlay = '';
      canvas.dataset.revymeLiquidCanvas = '';
      const lost = () => { if (!disposed && entry.lens === lens) fallback(entry, 'context-lost'); };
      canvas.addEventListener('webglcontextlost', lost);
      entry.stopContext = () => canvas.removeEventListener('webglcontextlost', lost);
      void lens.renderer._backendReady.then(() => {
        if (entry.lens === lens && lens.renderer?._backendFailed) fallback(entry, 'gpu-unavailable');
        void lens.renderer?.backend?.device?.lost.then(() => {
          if (!disposed && entry.lens === lens) fallback(entry, 'device-lost');
        });
      }).catch(() => { if (entry.lens === lens) fallback(entry, 'initialization-failed'); });
      if (!initialized) entry.timeout = win!.setTimeout(() => {
        if (entry.lens === lens) fallback(entry, 'capture-timeout');
      }, 12_000);
    } catch {
      if (!disposed && entry.generation === generation) fallback(entry, 'initialization-failed');
    }
  }
  const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(changes => {
    for (const change of changes) {
      const entry = entries.get(change.target as HTMLElement);
      if (!entry || entry.visible === change.isIntersecting) continue;
      entry.visible = change.isIntersecting;
      if (entry.visible) void start(entry);
      else { release(entry); emit(entry, 'paused'); }
    }
  }, { rootMargin: '64px' });

  function scan() {
    scanFrame = 0;
    if (disposed) return;
    const current = new Set(doc.querySelectorAll<HTMLElement>('[data-liquid-glass]'));
    for (const [el, entry] of entries) {
      if (current.has(el) && el.isConnected && parseLiquidGlassAttribute(el.getAttribute('data-liquid-glass'))) continue;
      intersection?.unobserve(el); release(entry); entries.delete(el);
      delete el.dataset.revymeLiquidId; delete el.dataset.revymeLiquidState; delete el.dataset.revymeLiquidBackend;
      el.style.removeProperty('--revyme-glass-tint');
    }
    for (const el of current) {
      // Replaced elements cannot host a glass surface; their container can.
      if (['IMG', 'VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'SVG'].includes(el.tagName)) continue;
      const config = parseLiquidGlassAttribute(el.getAttribute('data-liquid-glass'));
      if (!config) continue;
      const host = options.editing ? null : el.parentElement?.querySelector(':scope > [data-revyme-glass-backdrop-host]');
      const scene = host ? el.parentElement ?? undefined : undefined;
      const backdrop = host?.querySelector<HTMLCanvasElement>(':scope > canvas[data-revyme-glass-backdrop]') ?? undefined;
      const signature = JSON.stringify(config);
      let entry = entries.get(el);
      if (entry) {
        if (entry.scene !== scene || entry.backdrop !== backdrop) {
          release(entry);
          entry.scene = scene;
          entry.backdrop = backdrop;
          entry.config = config;
          entry.signature = signature;
          void start(entry);
          continue;
        }
        if (entry.signature === signature) continue;
        const qualityChanged = entry.config.resolution !== config.resolution;
        entry.config = config; entry.signature = signature;
        if (entry.lens?.renderer) {
          const { tint, tilt, draggable, ...settings } = effective(entry);
          Object.assign(entry.lens.options, settings, { draggable: false });
          entry.lens.setTint(tint); entry.lens.setTilt(tilt && !draggable);
          entry.lens.setShadow(settings.shadow); interaction(entry);
          if (qualityChanged) engine?.refresh();
          entry.lens.renderer.render();
        } else { release(entry); void start(entry); }
      } else {
        entry = { el, id: `glass-${++nextId}`, config, signature, scene, backdrop, visible: !intersection, generation: 0, position: { x: 0, y: 0 } };
        entries.set(el, entry); el.dataset.revymeLiquidId = entry.id;
        if (intersection) intersection.observe(el);
        else void start(entry);
      }
    }
  }
  const scheduleScan = () => { if (!scanFrame && !disposed) scanFrame = win!.requestAnimationFrame(scan); };
  const targetSelector = '[data-liquid-glass],[data-revyme-glass-backdrop-host],[data-revyme-glass-backdrop]';
  const targets = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && (node.matches(targetSelector) || node.querySelector(targetSelector))))) scheduleScan();
  });
  targets.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-liquid-glass', 'data-revyme-glass-backdrop'] });
  const dynamic = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest('[data-liquid-ignore],[data-revyme-liquid-styles]')) continue;
      const node = target.closest('[data-id],[data-node-id]');
      if (node && !entries.has(node as HTMLElement)) dynamicCandidates.add(node);
    }
    if (dynamicCandidates.size) scheduleDynamics();
  });
  if (!options.editing) dynamic.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'src'] });
  const restart = () => {
    for (const entry of entries.values()) { release(entry); if (doc.hidden) emit(entry, 'paused'); else void start(entry); }
  };
  doc.addEventListener('visibilitychange', restart);
  reduced.addEventListener('change', restart);
  doc.addEventListener('animationstart', scheduleDynamics, true);
  const manager = { references: 1, stop() {
    disposed = true;
    targets.disconnect(); dynamic.disconnect(); intersection?.disconnect();
    win!.cancelAnimationFrame(scanFrame); win!.cancelAnimationFrame(dynamicFrame);
    win!.clearInterval(animationDiscovery);
    doc.removeEventListener('visibilitychange', restart); reduced.removeEventListener('change', restart);
    doc.removeEventListener('animationstart', scheduleDynamics, true);
    for (const entry of entries.values()) {
      release(entry); delete entry.el.dataset.revymeLiquidId; delete entry.el.dataset.revymeLiquidState; delete entry.el.dataset.revymeLiquidBackend;
      entry.el.style.removeProperty('--revyme-glass-tint');
    }
    for (const root of roots.keys()) delete root.dataset.revymeGlassRoot;
    entries.clear(); style.remove(); managers.delete(doc);
  } };
  managers.set(doc, manager); scan();
  return () => { if (--manager.references === 0) manager.stop(); };
}
