/** Shared defaults for the editable REAL primitives. No editor imports in the runtime. */
export const DEFAULT_ADVANCED_HEADING = {
  text: 'Hacemos real el mundo que queremos',
  prefix: '', suffix: '',
  tag: 'h2', effect: 'scramble', trigger: 'appear', duration: 0.8, delay: 0,
  once: true, scrambledColor: '#888888', characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!<>-_[]{}', cursor: false, cursorColor: 'currentColor',
  fontFamily: 'inherit', fontSize: 32, fontWeight: '400', lineHeight: 1.2, letterSpacing: 0,
  color: 'inherit', textAlign: 'left', textTransform: 'none', textWrap: 'wrap',
} as const;

export const DEFAULT_ADVANCED_FRAME = {
  fillColor: 'transparent',
  cornerStyle: 'crossSquare', cornerSize: 15, cornerStroke: 1, cornerColor: 'currentColor',
  cornerFill: '#edf2ed', cornerOffsetX: 0, cornerOffsetY: 0,
  patternPreset: 'none', patternColor: 'rgba(38,38,38,0.12)', tileSize: 7, lineWidth: 1, dotSize: 2,
  flip: false, customPatternImage: '', customPatternSizing: 'tile', customPatternPosition: 'center',
  customPatternMode: 'alpha', patternMotion: 'none', patternDuration: 3,
  compositionMaskImage: '', compositionMaskMode: 'luminance', compositionMaskSizing: 'fill', compositionMaskPosition: 'center', compositionMaskTileSize: 64,
} as const;

export const PATTERN_PRESETS = ['none', 'grid', 'checkerboard', 'horizontalLines', 'verticalLines', 'diagonalLines', 'dots', 'triangles', 'custom'] as const;
export const CORNER_STYLES = ['none', 'cross', 'square', 'crossSquare', 'bracket', 'dot'] as const;
export const HEADING_EFFECTS = ['none', 'scramble', 'reveal', 'typewriter'] as const;
export const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'label', 'blockquote'] as const;

export function finiteSetting(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
