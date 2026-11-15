/** Shared authoring data for Revyme's Glitch effect. Values are CSS pixels and seconds. */
export interface GlitchConfig {
  version: 1;
  intensity: number;
  interval: number;
  duration: number;
  slices: number;
  shift: number;
  rgbShift: number;
  blocks: number;
  noise: number;
}
export const DEFAULT_GLITCH: GlitchConfig = {
  version: 1,
  intensity: 1,
  interval: 3,
  duration: 0.4,
  slices: 24,
  shift: 30,
  rgbShift: 4,
  blocks: 0.5,
  noise: 0.35
};
export function normalizeGlitch(value: unknown): GlitchConfig | null {
  if (!value || typeof value !== 'object' || (value as {
    version?: unknown;
  }).version !== 1) return null;
  const input = value as Record<string, unknown>;
  const bound = (key: keyof GlitchConfig, min: number, max: number) => {
    const v = input[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : DEFAULT_GLITCH[key];
  };
  return {
    version: 1,
    intensity: bound('intensity', 0, 2),
    interval: bound('interval', 0, 30),
    duration: bound('duration', 0.05, 4),
    slices: Math.round(bound('slices', 3, 100)),
    shift: bound('shift', 0, 200),
    rgbShift: bound('rgbShift', 0, 40),
    blocks: bound('blocks', 0, 1),
    noise: bound('noise', 0, 1)
  };
}
