/**
 * canvas-effects.ts — Progressive HTML-in-Canvas (`content="drawable"` +
 * `ctx.drawElementImage`) effects & 100% functional CSS/DOM fallback.
 *
 * Designed for Chrome 157+ WICG `html-in-canvas` (`content="drawable"`,
 * `drawable` attribute, `paint` event, `ctx.drawElementImage`) while
 * guaranteeing zero breakage on SSR and browsers without the feature flag.
 *
 * When `supportsHtmlInCanvas()` is false (default in standard browsers):
 *   - DOM remains in normal document flow (`data-canvas-mode="fallback-dom"`).
 *   - Pointer tracking (`--canvas-px`, `--canvas-py`) and CSS 3D/clip/filter
 *     transitions provide an immediate editorial interactive effect.
 *
 * When `supportsHtmlInCanvas()` is true:
 *   - Elements with `data-canvas-effect` are marked `drawable=""` and paired
 *     with a DPR-sized `<canvas content="drawable">` stage (`data-canvas-mode="html-in-canvas"`).
 *   - `ctx.drawElementImage` snapshots the live DOM element and applies 2D
 *     procedural passes (`ink-flood`, `refraction-lens`, `paper-fold`,
 *     `halftone-dissolve`, `chromatic-shift`, `ripple`).
 */

export type CanvasEffectPreset =
  | 'ink-flood'
  | 'refraction-lens'
  | 'paper-fold'
  | 'halftone-dissolve'
  | 'chromatic-shift'
  | 'ripple';

export interface CanvasEffectConfig {
  preset: CanvasEffectPreset;
  duration: number; // seconds
  delay: number;    // seconds
  intensity?: number; // 0..100
}

export const CANVAS_EFFECT_OPTIONS: {
  value: CanvasEffectPreset;
  label: string;
  description: string;
  defaultDuration: number;
}[] = [
  {
    value: 'ink-flood',
    label: 'Ink Flood',
    description: 'High-contrast editorial ink bloom radiating from the pointer or transition origin.',
    defaultDuration: 0.65,
  },
  {
    value: 'refraction-lens',
    label: 'Refraction Lens',
    description: 'Optical glass displacement and specular magnification across typography and media.',
    defaultDuration: 0.55,
  },
  {
    value: 'paper-fold',
    label: 'Paper Fold',
    description: '3D editorial broadsheet crease with directional shadow and perspective lift.',
    defaultDuration: 0.6,
  },
  {
    value: 'halftone-dissolve',
    label: 'Halftone Dissolve',
    description: 'Newsprint raster dot matrix transition with warm archival contrast.',
    defaultDuration: 0.5,
  },
  {
    value: 'chromatic-shift',
    label: 'Chromatic Shift',
    description: 'Spectral RGB channel separation reactive to cursor velocity.',
    defaultDuration: 0.45,
  },
  {
    value: 'ripple',
    label: 'Surface Ripple',
    description: 'Concentric wave propagation across the element surface.',
    defaultDuration: 0.7,
  },
];

export const DEFAULT_CANVAS_EFFECT: CanvasEffectConfig = {
  preset: 'ink-flood',
  duration: 0.65,
  delay: 0,
  intensity: 75,
};

export function isCanvasEffectPreset(val: unknown): val is CanvasEffectPreset {
  return (
    val === 'ink-flood' ||
    val === 'refraction-lens' ||
    val === 'paper-fold' ||
    val === 'halftone-dissolve' ||
    val === 'chromatic-shift' ||
    val === 'ripple'
  );
}

export function getCanvasEffectLabel(preset: string): string {
  const found = CANVAS_EFFECT_OPTIONS.find((o) => o.value === preset);
  return found ? found.label : preset;
}

/**
 * Feature detection for Chrome 157+ WICG HTML-in-Canvas (`content="drawable"`
 * + `CanvasRenderingContext2D.prototype.drawElementImage`).
 * Safe to call during SSR (returns `false`).
 */
export function supportsHtmlInCanvas(win: Window | typeof globalThis = globalThis): boolean {
  if (typeof document === 'undefined') return false;
  const Ctx = (win as any)?.CanvasRenderingContext2D ?? globalThis.CanvasRenderingContext2D;
  if (!Ctx || !Ctx.prototype || !('drawElementImage' in Ctx.prototype)) return false;
  try {
    const probe = document.createElement('canvas') as HTMLCanvasElement & { content?: string };
    probe.setAttribute('content', 'drawable');
    return probe.content === 'drawable';
  } catch {
    return false;
  }
}

function parseNonNegativeSeconds(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const s = raw.trim();
    if (s.endsWith('ms')) {
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? Math.max(0, n / 1000) : fallback;
    }
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }
  return fallback;
}

/**
 * Extract a normalized `CanvasEffectConfig` from a parsed `CanvasNode` (or raw
 * attribute map). Returns `null` when the node has no `data-canvas-effect`.
 */
export function parseCanvasEffectFromAttrs(
  attrs?: Record<string, any> | null,
): CanvasEffectConfig | null {
  if (!attrs) return null;
  const rawPreset = attrs['data-canvas-effect'];
  if (!isCanvasEffectPreset(rawPreset)) return null;
  const opt = CANVAS_EFFECT_OPTIONS.find((o) => o.value === rawPreset);
  const defaultDur = opt?.defaultDuration ?? DEFAULT_CANVAS_EFFECT.duration;
  const duration = Math.max(
    0.05,
    parseNonNegativeSeconds(attrs['data-canvas-duration'], defaultDur),
  );
  const delay = parseNonNegativeSeconds(attrs['data-canvas-delay'], 0);
  const rawIntensity = Number.parseFloat(String(attrs['data-canvas-intensity'] ?? '75'));
  const intensity = Number.isFinite(rawIntensity)
    ? Math.max(0, Math.min(100, rawIntensity))
    : 75;
  return { preset: rawPreset, duration, delay, intensity };
}

/**
 * Build the progressive CSS stylesheet that powers `fallback-dom` mode (and
 * provides layout/stage positioning when `html-in-canvas` is active).
 */
export function buildCanvasEffectCSS(): string {
  return `
/* Revyme Progressive HTML-in-Canvas & DOM Fallback Styles */
[data-canvas-effect] {
  --canvas-px: 0.5;
  --canvas-py: 0.5;
  --canvas-duration: 0.6s;
  --canvas-delay: 0s;
  position: relative;
  transition-property: transform, filter, box-shadow, background-color, border-color, opacity;
  transition-duration: var(--canvas-duration, 0.6s);
  transition-delay: var(--canvas-delay, 0s);
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, filter;
}

@media (prefers-reduced-motion: reduce) {
  [data-canvas-effect] {
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    transform: none !important;
    filter: none !important;
  }
}

/* 1. Ink Flood (fallback-dom) */
[data-canvas-effect="ink-flood"][data-canvas-mode="fallback-dom"] {
  background-image: radial-gradient(
    circle at calc(var(--canvas-px, 0.5) * 100%) calc(var(--canvas-py, 0.5) * 100%),
    rgba(24, 24, 22, 0.09) 0%,
    rgba(24, 24, 22, 0.03) 38%,
    transparent 72%
  );
}
[data-canvas-effect="ink-flood"][data-canvas-mode="fallback-dom"]:hover,
[data-canvas-effect="ink-flood"][data-canvas-active="true"] {
  transform: translateY(-2px) scale(1.006);
  filter: contrast(1.06);
  box-shadow: 0 14px 34px -18px rgba(18, 18, 16, 0.28);
}

/* 2. Refraction Lens (fallback-dom) */
[data-canvas-effect="refraction-lens"][data-canvas-mode="fallback-dom"]:hover,
[data-canvas-effect="refraction-lens"][data-canvas-active="true"] {
  transform: perspective(900px)
    rotateX(calc((0.5 - var(--canvas-py, 0.5)) * 5deg))
    rotateY(calc((var(--canvas-px, 0.5) - 0.5) * 5deg))
    scale(1.015);
  filter: contrast(1.04) saturate(1.08);
  box-shadow:
    0 18px 38px -18px rgba(15, 23, 42, 0.22),
    inset 0 0 0 1px rgba(255, 255, 255, 0.28);
}

/* 3. Paper Fold (fallback-dom) */
[data-canvas-effect="paper-fold"][data-canvas-mode="fallback-dom"]:hover,
[data-canvas-effect="paper-fold"][data-canvas-active="true"] {
  transform: perspective(800px)
    rotateX(calc((0.5 - var(--canvas-py, 0.5)) * 9deg))
    rotateY(calc((var(--canvas-px, 0.5) - 0.5) * 9deg))
    translateY(-2px);
  box-shadow: -8px 12px 24px -14px rgba(20, 18, 14, 0.26);
}

/* 4. Halftone Dissolve (fallback-dom) */
[data-canvas-effect="halftone-dissolve"][data-canvas-mode="fallback-dom"]:hover,
[data-canvas-effect="halftone-dissolve"][data-canvas-active="true"] {
  filter: contrast(1.12) sepia(0.14);
  transform: scale(1.008);
}

/* 5. Chromatic Shift (fallback-dom) */
[data-canvas-effect="chromatic-shift"][data-canvas-mode="fallback-dom"]:hover,
[data-canvas-effect="chromatic-shift"][data-canvas-active="true"] {
  text-shadow:
    calc((var(--canvas-px, 0.5) - 0.5) * 4px) 0 0 rgba(239, 68, 68, 0.55),
    calc((0.5 - var(--canvas-px, 0.5)) * 4px) 0 0 rgba(59, 130, 246, 0.55);
  transform: translateY(-1px);
}

/* 6. Surface Ripple (fallback-dom) */
[data-canvas-effect="ripple"][data-canvas-mode="fallback-dom"]:hover,
[data-canvas-effect="ripple"][data-canvas-active="true"] {
  background-image: radial-gradient(
    circle at calc(var(--canvas-px, 0.5) * 100%) calc(var(--canvas-py, 0.5) * 100%),
    rgba(99, 102, 241, 0.10) 0%,
    rgba(99, 102, 241, 0.04) 30%,
    transparent 60%
  );
  transform: scale(1.01);
}

/* HTML-in-Canvas overlay stage */
canvas.revyme-canvas-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
  border-radius: inherit;
}
`.trim();
}

/**
 * Render one frame of a progressive HTML-in-Canvas effect onto a 2D context
 * using `ctx.drawElementImage(targetEl, ...)`.
 */
export function renderHtmlInCanvasFrame(
  ctx: CanvasRenderingContext2D & {
    drawElementImage?: (
      el: Element,
      dx: number,
      dy: number,
      dw?: number,
      dh?: number,
    ) => void;
  },
  targetEl: HTMLElement,
  preset: CanvasEffectPreset,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  pointer: { x: number; y: number; active: boolean },
): boolean {
  if (typeof ctx.drawElementImage !== 'function' || cssWidth <= 0 || cssHeight <= 0) {
    return false;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Draw the live DOM element snapshot via HTML-in-Canvas drawElementImage
  try {
    ctx.drawElementImage(targetEl, 0, 0, cssWidth, cssHeight);
  } catch {
    ctx.restore();
    return false;
  }

  const px = pointer.x * cssWidth;
  const py = pointer.y * cssHeight;
  const radius = Math.max(cssWidth, cssHeight) * (pointer.active ? 0.55 : 0.35);

  if (preset === 'ink-flood') {
    const grad = ctx.createRadialGradient(px, py, 2, px, py, radius);
    grad.addColorStop(0, pointer.active ? 'rgba(20, 19, 16, 0.22)' : 'rgba(20, 19, 16, 0.08)');
    grad.addColorStop(0.55, 'rgba(20, 19, 16, 0.04)');
    grad.addColorStop(1, 'rgba(20, 19, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  } else if (preset === 'refraction-lens') {
    const grad = ctx.createRadialGradient(px, py, 4, px, py, radius * 0.7);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
    grad.addColorStop(0.5, 'rgba(148, 163, 184, 0.10)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  } else if (preset === 'paper-fold') {
    const grad = ctx.createLinearGradient(0, 0, cssWidth, cssHeight);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    grad.addColorStop(0.5, 'rgba(15, 14, 12, 0.08)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  } else if (preset === 'halftone-dissolve') {
    ctx.fillStyle = 'rgba(24, 22, 18, 0.08)';
    const step = 10;
    for (let y = step / 2; y < cssHeight; y += step) {
      for (let x = step / 2; x < cssWidth; x += step) {
        const dist = Math.hypot(x - px, y - py);
        if (dist < radius * 0.65) {
          ctx.beginPath();
          ctx.arc(x, y, 1.25, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  } else if (preset === 'chromatic-shift') {
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
    ctx.strokeRect(1.5, 1.5, Math.max(0, cssWidth - 3), Math.max(0, cssHeight - 3));
  } else if (preset === 'ripple') {
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.28)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(12, radius * 0.35), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
  return true;
}

/**
 * Attach the progressive Canvas Effects runtime to a document or root container.
 * Automatically upgrades `[data-canvas-effect]` elements to HTML-in-Canvas when
 * `supportsHtmlInCanvas()` is true, or binds the CSS/DOM fallback when false.
 *
 * Returns a cleanup function.
 */
export function attachCanvasEffectsRuntime(root: Document | HTMLElement = document): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  if (!doc || !win) return () => {};

  // 1. Ensure style element is injected in <head>
  const styleId = 'revyme-canvas-effects-css';
  if (!doc.getElementById(styleId) && doc.head) {
    const styleEl = doc.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = buildCanvasEffectCSS();
    doc.head.appendChild(styleEl);
  }

  const isSupported = supportsHtmlInCanvas(win);
  doc.documentElement.setAttribute(
    'data-html-in-canvas',
    isSupported ? 'supported' : 'fallback-dom',
  );

  const cleanups = new Map<HTMLElement, () => void>();

  const bindElement = (el: HTMLElement) => {
    if (cleanups.has(el)) return;
    const presetAttr = el.getAttribute('data-canvas-effect');
    if (!isCanvasEffectPreset(presetAttr)) return;

    const cfg = parseCanvasEffectFromAttrs({
      'data-canvas-effect': presetAttr,
      'data-canvas-duration': el.getAttribute('data-canvas-duration'),
      'data-canvas-delay': el.getAttribute('data-canvas-delay'),
    });
    if (cfg) {
      el.style.setProperty('--canvas-duration', `${cfg.duration}s`);
      el.style.setProperty('--canvas-delay', `${cfg.delay}s`);
    }

    const pointer = { x: 0.5, y: 0.5, active: false };
    let stageCanvas: (HTMLCanvasElement & { requestPaint?: () => void }) | null = null;
    let ro: ResizeObserver | null = null;
    let drawCount = 0;

    const paintStage = () => {
      if (!stageCanvas) return;
      const ctx = stageCanvas.getContext('2d') as any;
      if (!ctx) return;
      const dpr = win.devicePixelRatio || 1;
      const cssW = stageCanvas.width / dpr;
      const cssH = stageCanvas.height / dpr;
      const currentPreset = (el.getAttribute('data-canvas-effect') || presetAttr) as CanvasEffectPreset;
      const ok = renderHtmlInCanvasFrame(ctx, el, currentPreset, cssW, cssH, dpr, pointer);
      if (ok) {
        drawCount += 1;
        stageCanvas.setAttribute('data-canvas-painted', 'true');
        stageCanvas.setAttribute('data-canvas-draws', String(drawCount));
      }
    };

    if (isSupported) {
      el.setAttribute('data-canvas-mode', 'html-in-canvas');
      el.setAttribute('drawable', '');
      stageCanvas = doc.createElement('canvas') as HTMLCanvasElement & { requestPaint?: () => void };
      stageCanvas.setAttribute('content', 'drawable');
      stageCanvas.setAttribute('data-canvas-stage', presetAttr);
      stageCanvas.setAttribute('aria-hidden', 'true');
      stageCanvas.className = 'revyme-canvas-stage';
      el.appendChild(stageCanvas);

      const syncSize = (w: number, h: number) => {
        if (!stageCanvas) return;
        const dpr = win.devicePixelRatio || 1;
        const nextW = Math.max(1, Math.round(w));
        const nextH = Math.max(1, Math.round(h));
        if (stageCanvas.width !== nextW || stageCanvas.height !== nextH) {
          stageCanvas.width = nextW;
          stageCanvas.height = nextH;
        }
        stageCanvas.style.width = `${Math.round(nextW / dpr)}px`;
        stageCanvas.style.height = `${Math.round(nextH / dpr)}px`;
        paintStage();
      };

      const rect = el.getBoundingClientRect();
      const dpr = win.devicePixelRatio || 1;
      syncSize(Math.max(1, rect.width * dpr), Math.max(1, rect.height * dpr));

      stageCanvas.addEventListener('paint', paintStage);

      if (typeof win.ResizeObserver !== 'undefined') {
        ro = new win.ResizeObserver(([entry]) => {
          if (!entry) return;
          const dprBox = (entry as any).devicePixelContentBoxSize?.[0];
          if (dprBox) {
            syncSize(dprBox.inlineSize, dprBox.blockSize);
          } else {
            const cBox = entry.contentBoxSize?.[0];
            const curDpr = win.devicePixelRatio || 1;
            const w = (cBox ? cBox.inlineSize : entry.contentRect.width) * curDpr;
            const h = (cBox ? cBox.blockSize : entry.contentRect.height) * curDpr;
            syncSize(w, h);
          }
        });
        try {
          ro.observe(el, { box: 'device-pixel-content-box' as ResizeObserverBoxOptions });
        } catch {
          ro.observe(el);
        }
      }
    } else {
      el.setAttribute('data-canvas-mode', 'fallback-dom');
    }

    const onPointerMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        pointer.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        pointer.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        el.style.setProperty('--canvas-px', pointer.x.toFixed(3));
        el.style.setProperty('--canvas-py', pointer.y.toFixed(3));
      }
      if (stageCanvas) {
        if (typeof stageCanvas.requestPaint === 'function') stageCanvas.requestPaint();
        paintStage();
      }
    };

    const onPointerEnter = (e: PointerEvent) => {
      pointer.active = true;
      el.setAttribute('data-canvas-active', 'true');
      onPointerMove(e);
    };

    const onPointerLeave = () => {
      pointer.active = false;
      el.setAttribute('data-canvas-active', 'false');
      el.style.setProperty('--canvas-px', '0.5');
      el.style.setProperty('--canvas-py', '0.5');
      if (stageCanvas) {
        paintStage();
      }
    };

    el.addEventListener('pointerenter', onPointerEnter, { passive: true });
    el.addEventListener('pointermove', onPointerMove, { passive: true });
    el.addEventListener('pointerleave', onPointerLeave, { passive: true });

    cleanups.set(el, () => {
      el.removeEventListener('pointerenter', onPointerEnter);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);
      if (ro) ro.disconnect();
      if (stageCanvas && stageCanvas.parentNode === el) {
        el.removeChild(stageCanvas);
      }
    });
  };

  const scan = () => {
    const scope = root instanceof Document ? root : root;
    const nodes = scope.querySelectorAll<HTMLElement>('[data-canvas-effect]');
    nodes.forEach((node) => bindElement(node));
  };

  scan();

  let mo: MutationObserver | null = null;
  if (typeof win.MutationObserver !== 'undefined') {
    const target = root instanceof Document ? root.body ?? root.documentElement : root;
    if (target) {
      mo = new win.MutationObserver(() => scan());
      mo.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-canvas-effect', 'data-canvas-duration', 'data-canvas-delay'],
      });
    }
  }

  return () => {
    if (mo) mo.disconnect();
    cleanups.forEach((fn) => fn());
    cleanups.clear();
  };
}
