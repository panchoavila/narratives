import { normalizeVhs, type VhsConfig } from './vhs-config';
import { openVhsStage, stopVhsObjects } from './vhs-stage';
import type { DisplacementNavigationResult } from './displacement-navigation';

export async function runVhsNavigation(options: {
  config: VhsConfig;
  navigate: () => Promise<void>;
  signal?: AbortSignal;
  surface?: HTMLElement | null;
}): Promise<DisplacementNavigationResult> {
  const { signal, surface } = options;
  const config = normalizeVhs(options.config);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const emit = (phase: string, reason?: string) => {
    document.dispatchEvent(new CustomEvent('revyme:page-transition', { detail: { phase, reason } }));
  };
  let navigated = false;
  async function navigate() {
    if (navigated || signal?.aborted) return;
    navigated = true;
    emit('navigating');
    await options.navigate();
  }
  const fallback = async (reason: string): Promise<DisplacementNavigationResult> => {
    if (signal?.aborted) return { mode: 'cancelled', reason };
    emit('fallback', reason);
    try { await navigate(); } catch { emit('navigation-error'); }
    return { mode: 'fallback', reason };
  };
  if (!config || !surface || signal?.aborted || motion.matches) {
    return fallback(motion.matches ? 'reduced-motion' : 'unavailable');
  }

  stopVhsObjects();
  const stage = openVhsStage(surface, 'page');
  if (!stage) return fallback('HTML in WebGL unavailable');
  const cancel = () => stage.destroy();
  signal?.addEventListener('abort', cancel, { once: true });
  motion.addEventListener('change', cancel);
  const play = (length: number, incoming: boolean) => new Promise<void>((resolve, reject) => {
    const started = performance.now();
    let paintedAt = -Infinity;
    const tick = (now: number) => {
      if (stage.closed) { reject(Error('VHS interrupted')); return; }
      const t = Math.min(1, (now - started) / length);
      if (now - paintedAt >= 32 || t === 1) {
        const amount = incoming ? Math.pow(1 - t, 1.5) : Math.pow(t, 1.5);
        try { stage.draw(config, now / 1000, amount); }
        catch (error) { reject(error); return; }
        paintedAt = now;
      }
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    tick(started);
  });

  try {
    emit('capturing-old');
    if (!await stage.nextPaint()) throw Error('VHS did not receive the first paint');
    emit('playing');
    await play(config.duration * 430, false);
    await navigate();
    emit('capturing-new');
    if (!await stage.nextPaint()) throw Error('VHS did not receive the destination paint');
    await play(config.duration * 570, true);
    emit('finished');
    return { mode: 'gpu' };
  } catch (error) {
    stage.destroy();
    return fallback(error instanceof Error ? error.message : 'VHS failed');
  } finally {
    stage.destroy();
    signal?.removeEventListener('abort', cancel);
    motion.removeEventListener('change', cancel);
  }
}
