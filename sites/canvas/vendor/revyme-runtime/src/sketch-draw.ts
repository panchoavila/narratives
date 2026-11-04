// sketch-draw.ts — Runtime player for Revyme sketch draw animations.
//
// Replays a brush-stroke sketch over time by feeding the original
// pointer samples (persisted on each `<path>` as a `data-points`
// attribute) back through perfect-freehand's `getStroke` at
// progressively-increasing slice lengths. The result is the visible
// equivalent of watching the user draw the sketch.
//
// Why a runtime function instead of an inline useEffect block in the
// generated source: the orchestrator is ~80 LOC of imperative timing
// + easing + RAF logic. Inlining it in every page that has a sketch
// animation buries the page's actual logic. Living in
// `@revyme/runtime` means the generated source is just one line:
//
//   useEffect(() => playSketchDraw(el, opts), []);
//
// which reads the same way as `withResponsiveProps` / `withCursor`
// already do for other generated patterns.

import { getStroke } from 'perfect-freehand';

export type SketchAnimMode = 'sequential' | 'staggered' | 'simultaneous';
export type SketchAnimTrigger = 'mount' | 'inView' | 'hover' | 'tap';

export interface SketchAnimTransition {
  type: 'tween' | 'spring';
  duration?: number;
  ease?: string;
  stiffness?: number;
  damping?: number;
  mass?: number;
}

export interface SketchAnimOpts {
  trigger?: SketchAnimTrigger;
  mode?: SketchAnimMode;
  /** Multiplier on per-stroke duration. Per-stroke duration scales
   *  with point count so a long stroke takes longer than a flick;
   *  this dials the overall pace. */
  durationScale?: number;
  /** 0–1, only meaningful in staggered mode. 0 = fully sequential,
   *  1 = fully simultaneous. */
  stagger?: number;
  transition?: SketchAnimTransition;
  /** Brush size used for the intermediate-frame outline replay. The
   *  final-frame `d` is restored from source so the end state is
   *  pixel-exact regardless of this value. */
  brushSize?: number;
}

const DEFAULT_OPTS: Required<Omit<SketchAnimOpts, 'transition'>> & { transition: SketchAnimTransition } = {
  trigger: 'inView',
  mode: 'sequential',
  durationScale: 1,
  stagger: 0.5,
  transition: { type: 'tween', duration: 1, ease: 'easeOut' },
  brushSize: 8,
};

function applyEase(t: number, transition: SketchAnimTransition): number {
  if (transition.type === 'spring') {
    const damping = transition.damping ?? 10;
    const stiffness = transition.stiffness ?? 100;
    const dampedT = 1 - Math.exp(-damping * t * 0.1);
    const oscillation = Math.cos(t * Math.sqrt(stiffness) * 0.3);
    return Math.min(1, dampedT * (1 - 0.1 * oscillation * (1 - t)));
  }
  switch (transition.ease ?? 'easeOut') {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'circIn': return 1 - Math.sqrt(1 - t * t);
    case 'circOut': return Math.sqrt(1 - Math.pow(t - 1, 2));
    case 'backOut': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    default: return 1 - (1 - t) * (1 - t);
  }
}

function parsePoints(raw: string): number[][] {
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean).map(s => {
    const [x, y, p] = s.split(',');
    return [parseFloat(x) || 0, parseFloat(y) || 0, p != null ? parseFloat(p) : 0.5];
  });
}

function outlineToD(outline: number[][]): string {
  if (outline.length === 0) return '';
  let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)}`;
  for (let i = 1; i < outline.length; i++) {
    d += ` L ${outline[i][0].toFixed(2)} ${outline[i][1].toFixed(2)}`;
  }
  return d + ' Z';
}

/**
 * Play a sketch draw animation on the given wrapper SVG. Pass the
 * options the generator emitted in source.
 *
 * Returns a cleanup function — wire as your useEffect's return value
 * so re-mounts cancel an in-flight animation cleanly:
 *
 *   useEffect(() => playSketchDraw(svgEl, opts), []);
 *
 * If `wrapperEl` is null or the wrapper has no path children with
 * `data-points`, this is a no-op and returns a noop cleanup.
 */
export function playSketchDraw(
  wrapperEl: SVGSVGElement | null,
  userOpts: SketchAnimOpts = {},
): () => void {
  const noop = () => {};
  if (!wrapperEl) return noop;
  const opts = { ...DEFAULT_OPTS, ...userOpts, transition: { ...DEFAULT_OPTS.transition, ...userOpts.transition } };

  const paths = Array.from(wrapperEl.querySelectorAll('path[data-points]')) as SVGPathElement[];
  if (paths.length === 0) return noop;

  // Snapshot the final d so the last frame is pixel-exact regardless
  // of the replay-with-default-brush approximation we use during
  // intermediate frames.
  const finalDs = paths.map(p => p.getAttribute('d') || '');
  const pointsList = paths.map(p => parsePoints(p.getAttribute('data-points') || ''));

  // Hide everything up front so the first frame doesn't flash.
  paths.forEach(p => p.setAttribute('d', ''));

  // Per-stroke duration — point count drives length so a long stroke
  // takes longer than a flick.
  const baseDur = (opts.transition.duration ?? 1) * 1000 * opts.durationScale;
  const maxPoints = pointsList.reduce((m, p) => Math.max(m, p.length), 1);
  const perStrokeDur = pointsList.map(p => baseDur * (p.length / maxPoints));
  const startMs: number[] = [];
  let cursor = 0;
  for (let i = 0; i < paths.length; i++) {
    if (opts.mode === 'simultaneous') {
      startMs.push(0);
    } else if (opts.mode === 'staggered') {
      const overlap = Math.max(0, Math.min(1, opts.stagger));
      const start = i === 0 ? 0 : startMs[i - 1] + perStrokeDur[i - 1] * (1 - overlap);
      startMs.push(start);
    } else {
      // sequential
      startMs.push(cursor);
      cursor += perStrokeDur[i];
    }
  }

  let cancelled = false;
  let rafId = 0;
  let started = false;
  let cleanupTrigger: (() => void) | null = null;
  let startTs = 0;

  const tick = (now: number) => {
    if (cancelled) return;
    const elapsed = now - startTs;
    let allDone = true;
    for (let i = 0; i < paths.length; i++) {
      const local = elapsed - startMs[i];
      if (local < 0) { allDone = false; continue; }
      const t = Math.min(1, local / Math.max(1, perStrokeDur[i]));
      if (t < 1) allDone = false;
      let d: string;
      if (t >= 1) {
        d = finalDs[i];
      } else {
        const eased = applyEase(t, opts.transition);
        const sliceCount = Math.max(2, Math.floor(pointsList[i].length * eased));
        const subset = pointsList[i].slice(0, sliceCount);
        if (subset.length < 2) {
          d = '';
        } else {
          const outline = getStroke(subset, {
            size: opts.brushSize, thinning: 0.5, smoothing: 0.5, streamline: 0.5,
          });
          d = outlineToD(outline);
        }
      }
      paths[i].setAttribute('d', d);
    }
    if (!allDone) rafId = requestAnimationFrame(tick);
  };

  const start = () => {
    if (started) return;
    started = true;
    startTs = performance.now();
    rafId = requestAnimationFrame(tick);
  };

  if (opts.trigger === 'inView') {
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        start();
        obs.disconnect();
      }
    }, { threshold: 0.2 });
    obs.observe(wrapperEl);
    cleanupTrigger = () => obs.disconnect();
  } else if (opts.trigger === 'hover') {
    const onEnter = () => start();
    wrapperEl.addEventListener('mouseenter', onEnter);
    cleanupTrigger = () => wrapperEl.removeEventListener('mouseenter', onEnter);
  } else if (opts.trigger === 'tap') {
    const onTap = () => start();
    wrapperEl.addEventListener('click', onTap);
    cleanupTrigger = () => wrapperEl.removeEventListener('click', onTap);
  } else {
    // mount
    start();
  }

  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
    cleanupTrigger?.();
  };
}
