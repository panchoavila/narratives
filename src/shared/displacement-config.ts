/** Versioned authoring data, shared by the editor and the published runtime. */
export interface DisplacementConfig {
  version: 1;
  duration: number;
  strength: number;
  seed: number;
  columns: number;
}
export const DEFAULT_DISPLACEMENT: DisplacementConfig = { version: 1, duration: 1.4, strength: .035, seed: 17, columns: 18 };
export function normalizeDisplacement(value: unknown): DisplacementConfig | null {
  if (!value || typeof value !== 'object' || (value as {version?:unknown}).version !== 1) return null;
  const input = value as Record<string, unknown>;
  const number = (key: keyof DisplacementConfig, min: number, max: number) => {
    const v = input[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : DEFAULT_DISPLACEMENT[key];
  };
  return { version: 1, duration: number('duration', .1, 4), strength: number('strength', 0, .15), seed: Math.round(number('seed', 0, 65535)), columns: Math.round(number('columns', 2, 64)) };
}
