export const VHS_CONTROLS = [
  ['duration', 'Duration', 0.25, 4, 0.05, 's', 1.2],
  ['speed', 'Tape speed', 0.1, 3, 0.05, '', 0.65],
  ['wave', 'Tape wave', 0, 3, 0.05, '', 1.1],
  ['jitter', 'Line jitter', 0, 3, 0.05, '', 0.35],
  ['crease', 'Tracking crease', 0, 3, 0.05, '', 0.35],
  ['switching', 'Head noise', 0, 3, 0.05, '', 0.5],
  ['chroma', 'Chroma bleed', 0, 12, 0.25, 'px', 3],
  ['grain', 'Grain', 0, 1, 0.05, '', 0.2],
  ['scanlines', 'Scanlines', 0, 1, 0.05, '', 0.22],
  ['vignette', 'Vignette', 0, 1, 0.05, '', 0.15],
] as const;

export type VhsConfig = Record<(typeof VHS_CONTROLS)[number][0], number> & {
  version: 1;
  trigger: 'hover' | 'click';
};

export function normalizeVhs(value: unknown): VhsConfig | null {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null;
  const input = value as Record<string, unknown>;
  const controls = Object.fromEntries(VHS_CONTROLS.map(([key, , min, max, , , fallback]) => {
    const v = input[key];
    return [key, typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback];
  })) as Omit<VhsConfig, 'version' | 'trigger'>;
  return { ...controls, version: 1, trigger: input.trigger === 'hover' ? 'hover' : 'click' };
}

export const DEFAULT_VHS = normalizeVhs({ version: 1 })!;
