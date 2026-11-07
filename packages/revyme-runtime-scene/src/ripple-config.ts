export interface RippleConfig {
  version: 1;
  amplitude: number;
  speed: number;
  wavelength: number;
  rings: number;
  decay: number;
  refraction: number;
  dispersion: number;
  shine: number;
  trigger: 'click' | 'hover' | 'none';
  interval: number;
}
export const DEFAULT_RIPPLE: RippleConfig = {
  version: 1,
  amplitude: .5,
  speed: .65,
  wavelength: 80,
  rings: 2,
  decay: 1,
  refraction: 100,
  dispersion: .5,
  shine: .5,
  trigger: 'click',
  interval: 0
};
export function normalizeRipple(input: unknown): RippleConfig | null {
  if (!input || typeof input !== 'object' || (input as {
    version?: unknown;
  }).version !== 1) return null;
  const v = input as Record<string, unknown>;
  const n = (key: Exclude<keyof RippleConfig, 'version' | 'trigger'>, min: number, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.min(max, Math.max(min, v[key] as number)) : DEFAULT_RIPPLE[key];
  return {
    version: 1,
    amplitude: n('amplitude', 0, 3),
    speed: n('speed', .1, 3),
    wavelength: n('wavelength', 10, 300),
    rings: Math.round(n('rings', 1, 8)),
    decay: n('decay', .1, 4),
    refraction: n('refraction', 0, 200),
    dispersion: n('dispersion', 0, 1),
    shine: n('shine', 0, 2),
    trigger: v.trigger === 'hover' || v.trigger === 'none' || v.trigger === 'click' ? v.trigger : 'click',
    interval: n('interval', 0, 30)
  };
}
