import { runDisplacementNavigation, type DisplacementNavigationResult } from './displacement-navigation';
import { normalizeRipple, type RippleConfig } from './ripple-config';
import { createRippleRenderer } from './ripple-renderer';
export async function runRippleNavigation(options: {
  config: RippleConfig;
  navigate: () => Promise<void>;
  signal?: AbortSignal;
  origin?: { x: number; y: number };
}): Promise<DisplacementNavigationResult> {
  const config = normalizeRipple(options.config);
  if (!config) {
    await options.navigate();
    return {
      mode: 'fallback',
      reason: 'invalid-config'
    };
  }
  return runDisplacementNavigation({
    config: {
      version: 1,
      duration: Math.min(4, Math.max(.3, 1.2 / config.speed)),
      seed: 0,
      strength: 0,
      columns: 2
    },
    navigate: options.navigate,
    signal: options.signal,
    renderer: (canvas, onLost) => createRippleRenderer(canvas, config, {
      x: Number.isFinite(options.origin?.x) ? Math.max(0, Math.min(1, options.origin!.x)) : .5,
      y: Number.isFinite(options.origin?.y) ? Math.max(0, Math.min(1, options.origin!.y)) : .5,
    }, onLost)
  });
}
