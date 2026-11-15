/** Serializable optical settings shared by the editor and the published runtime. */
export interface LiquidGlassConfig {
  version: 1;
  refraction: number;
  aberration: number;
  bevelDepth: number;
  bevelWidth: number;
  frost: number;
  magnify: number;
  tint: string;
  shadow: boolean;
  specular: boolean;
  reveal: 'none' | 'fade';
  tilt: boolean;
  tiltFactor: number;
  tiltEase: number;
  draggable: boolean;
  interaction: 'none' | 'fluid';
  interactionStrength: number;
  interactionRadius: number;
  interactionViscosity: number;
  resolution: number;
  audioReactive: boolean;
  audioSourceId: string;
  audioGain: number;
}

export const DEFAULT_LIQUID_GLASS: LiquidGlassConfig = {
  version: 1, refraction: 0.01, aberration: 0, bevelDepth: 0.08, bevelWidth: 0.15,
  frost: 0, magnify: 1, tint: '#ffffff00', shadow: true, specular: true,
  reveal: 'none', tilt: false, tiltFactor: 5, tiltEase: 400, draggable: false,
  interaction: 'none', interactionStrength: 0.5, interactionRadius: 0.35,
  interactionViscosity: 0.65, resolution: 1, audioReactive: false, audioSourceId: '', audioGain: 1,
};

export const LIQUID_GLASS_CONTROLS = [
  ['refraction', 'Refraction', 0, 1, 0.005, ''],
  ['aberration', 'Dispersion', 0, 1, 0.01, ''],
  ['bevelDepth', 'Bevel depth', 0, 1, 0.005, ''],
  ['bevelWidth', 'Bevel width', 0.005, 1, 0.005, ''],
  ['frost', 'Frost', 0, 10, 0.1, 'px'],
  ['magnify', 'Magnify', 0.1, 3, 0.05, '×'],
] as const;

export const LIQUID_GLASS_PRESETS: { value: string; label: string; settings: Partial<LiquidGlassConfig> }[] = [
  { value: 'clear', label: 'Clear', settings: {} },
  { value: 'frost', label: 'Frosted', settings: { refraction: 0, bevelDepth: 0.035, bevelWidth: 0.12, frost: 3 } },
  { value: 'chromatic', label: 'Chromatic', settings: { refraction: 0.04, aberration: 0.45, bevelDepth: 0.12 } },
  { value: 'tinted', label: 'Tinted', settings: { tint: '#3466c955', frost: 0.7 } },
  { value: 'fluid', label: 'Fluid', settings: { interaction: 'fluid', interactionStrength: 1.1, interactionViscosity: 0.75 } },
  { value: 'magnifier', label: 'Magnifier', settings: { magnify: 1.8, bevelWidth: 0.08 } },
  { value: 'draggable', label: 'Draggable', settings: { draggable: true, interaction: 'fluid' } },
  { value: 'tilt', label: 'Tilt', settings: { tilt: true, tiltFactor: 12 } },
  { value: 'audio', label: 'Audio reactive', settings: { audioReactive: true, aberration: 0.15 } },
];

const bounds = {
  refraction: [0, 1], aberration: [0, 1], bevelDepth: [0, 1], bevelWidth: [0.005, 1],
  frost: [0, 10], magnify: [0.1, 3], tiltFactor: [0, 25], tiltEase: [0, 2000],
  interactionStrength: [0, 5], interactionRadius: [0.01, 5], interactionViscosity: [0, 1],
  resolution: [0.25, 2], audioGain: [0, 5],
} as const;

export function normalizeLiquidGlass(value: unknown): LiquidGlassConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== undefined && input.version !== 1) return null;
  const result = { ...DEFAULT_LIQUID_GLASS };
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const number = input[key];
    if (typeof number === 'number' && Number.isFinite(number)) {
      result[key] = Math.min(bounds[key][1], Math.max(bounds[key][0], number));
    }
  }
  for (const key of ['shadow', 'specular', 'tilt', 'draggable', 'audioReactive'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  if (input.reveal === 'fade') result.reveal = 'fade';
  if (input.interaction === 'fluid') result.interaction = 'fluid';
  if (typeof input.tint === 'string' && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgba?|hsla?)\([\d.,%\s/+-]+\))$/i.test(input.tint.trim())) {
    result.tint = input.tint.trim();
  }
  if (typeof input.audioSourceId === 'string') result.audioSourceId = input.audioSourceId.trim().slice(0, 128);
  return result;
}

export function parseLiquidGlassAttribute(value: unknown): LiquidGlassConfig | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return normalizeLiquidGlass(JSON.parse(value)) ?? { ...DEFAULT_LIQUID_GLASS }; }
  catch { return { ...DEFAULT_LIQUID_GLASS }; }
}
