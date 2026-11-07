export interface ParticleConfig {
  version: 1;
  count: number;
  size: number;
  sizeVariance: number;
  radius: number;
  strength: number;
  swirl: number;
  spring: number;
  drift: number;
}
export const DEFAULT_PARTICLE: ParticleConfig = {
  version: 1,
  count: 8000,
  size: 2.4,
  sizeVariance: .6,
  radius: 110,
  strength: 1,
  swirl: .6,
  spring: 1,
  drift: .6
};
export function normalizeParticle(input: unknown): ParticleConfig | null {
  if (!input || typeof input !== 'object' || (input as {
    version?: unknown;
  }).version !== 1) return null;
  const v = input as Record<string, unknown>;
  const n = (key: Exclude<keyof ParticleConfig, 'version'>, min: number, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.max(min, Math.min(max, v[key] as number)) : DEFAULT_PARTICLE[key];
  return {
    version: 1,
    count: Math.round(n('count', 100, 20000)),
    size: n('size', .5, 10),
    sizeVariance: n('sizeVariance', 0, 1),
    radius: n('radius', 10, 500),
    strength: n('strength', 0, 3),
    swirl: n('swirl', 0, 2),
    spring: n('spring', .1, 4),
    drift: n('drift', 0, 2)
  };
}
