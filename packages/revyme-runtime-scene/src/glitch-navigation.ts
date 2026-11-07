import { runDisplacementNavigation, type DisplacementNavigationResult } from './displacement-navigation';
import { normalizeGlitch, type GlitchConfig } from './glitch-config';
import { createGlitchRenderer } from './glitch-renderer';

/** A single Glitch burst spanning a route change. */
export async function runGlitchNavigation(options: {
  config: GlitchConfig;
  navigate: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<DisplacementNavigationResult> {
  const config = normalizeGlitch(options.config);
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
      duration: config.duration,
      seed: 0,
      columns: 18,
      strength: 0
    },
    navigate: options.navigate,
    signal: options.signal,
    renderer: (canvas, onLost) => createGlitchRenderer(canvas, config, onLost)
  });
}
