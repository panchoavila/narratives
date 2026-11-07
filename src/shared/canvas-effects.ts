export type CanvasEffectPreset =
  | 'glitch'
  | 'glyph-rain'
  | 'ripple-water'
  | 'particle-object';

export interface CanvasEffectConfig {
  preset: CanvasEffectPreset;
  duration: number; // seconds
  delay: number;    // seconds
  intensity?: number; // 0..100
  glitch?: import('../../packages/revyme-runtime-scene/src/glitch-config').GlitchConfig;
  glyphRain?: import('../../packages/revyme-runtime-scene/src/glyph-rain').GlyphRainConfig;
  ripple?: import('../../packages/revyme-runtime-scene/src/ripple-config').RippleConfig;
  particle?: import('../../packages/revyme-runtime-scene/src/particle-config').ParticleConfig;
}
import { DEFAULT_GLITCH, normalizeGlitch } from '../../packages/revyme-runtime-scene/src/glitch-config';
import { DEFAULT_GLYPH_RAIN, normalizeGlyphRain } from '../../packages/revyme-runtime-scene/src/glyph-rain';
import { DEFAULT_RIPPLE, normalizeRipple } from '../../packages/revyme-runtime-scene/src/ripple-config';
import { DEFAULT_PARTICLE, normalizeParticle } from '../../packages/revyme-runtime-scene/src/particle-config';

export const CANVAS_EFFECT_OPTIONS: {
  value: CanvasEffectPreset;
  label: string;
  description: string;
  defaultDuration: number;
}[] = [
  { value: 'glitch', label: 'Glitch', description: 'Broadcast tears, RGB separation and corrupted blocks.', defaultDuration: 0.4 },
  { value: 'glyph-rain', label: 'Glyph Rain', description: 'Falling glyphs illuminate the content beneath.', defaultDuration: 1 },
  { value: 'ripple-water', label: 'Ripple', description: 'Expanding ripples refract the selected content.', defaultDuration: 1.8 },
  { value: 'particle-object', label: 'Particle Object', description: 'Reconstruct an image or SVG as interactive particles.', defaultDuration: 1 },
];

export const DEFAULT_CANVAS_EFFECT: CanvasEffectConfig = {
  preset: 'glitch',
  duration: DEFAULT_GLITCH.duration,
  delay: 0,
  intensity: 75,
};

export function isCanvasEffectPreset(val: unknown): val is CanvasEffectPreset {
  return CANVAS_EFFECT_OPTIONS.some(option => option.value === val);
}

export function getCanvasEffectLabel(preset: string): string {
  const found = CANVAS_EFFECT_OPTIONS.find((o) => o.value === preset);
  return found ? found.label : preset;
}

/**
 * Feature detection for Chrome 157+ WICG HTML-in-Canvas (`content="drawable"`
 * + `CanvasRenderingContext2D.prototype.drawElementImage`).
 * Safe to call during SSR (returns `false`).
 */
export function supportsHtmlInCanvas(win: Window | typeof globalThis = globalThis): boolean {
  if (typeof document === 'undefined') return false;
  const Ctx = (win as any)?.CanvasRenderingContext2D ?? globalThis.CanvasRenderingContext2D;
  if (!Ctx || !Ctx.prototype || !('drawElementImage' in Ctx.prototype)) return false;
  try {
    const probe = document.createElement('canvas') as HTMLCanvasElement & { content?: string };
    probe.setAttribute('content', 'drawable');
    return probe.content === 'drawable';
  } catch {
    return false;
  }
}

function parseNonNegativeSeconds(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const s = raw.trim();
    if (s.endsWith('ms')) {
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? Math.max(0, n / 1000) : fallback;
    }
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }
  return fallback;
}

/**
 * Extract a normalized `CanvasEffectConfig` from a parsed `CanvasNode` (or raw
 * attribute map). Returns `null` for absent or retired presets.
 */
export function parseCanvasEffectFromAttrs(
  attrs?: Record<string, any> | null,
): CanvasEffectConfig | null {
  if (!attrs) return null;
  const rawPreset = attrs['data-canvas-effect'];
  if (!isCanvasEffectPreset(rawPreset)) return null;
  const opt = CANVAS_EFFECT_OPTIONS.find((o) => o.value === rawPreset);
  const defaultDur = opt?.defaultDuration ?? DEFAULT_CANVAS_EFFECT.duration;
  const duration = Math.max(
    0.05,
    parseNonNegativeSeconds(attrs['data-canvas-duration'], defaultDur),
  );
  const delay = parseNonNegativeSeconds(attrs['data-canvas-delay'], 0);
  const rawIntensity = Number.parseFloat(String(attrs['data-canvas-intensity'] ?? '75'));
  const intensity = Number.isFinite(rawIntensity)
    ? Math.max(0, Math.min(100, rawIntensity))
    : 75;
  if (rawPreset === 'glitch') {
    const values = Object.fromEntries(Object.entries(DEFAULT_GLITCH).map(([key, fallback]) => {
      if (key === 'version') return [key, 1];
      const attr = attrs[`data-glitch-${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`];
      const value = attr == null || String(attr).trim() === '' ? fallback : Number(attr);
      return [key, value];
    }));
    return { preset: rawPreset, duration, delay, intensity, glitch: normalizeGlitch(values) ?? { ...DEFAULT_GLITCH } };
  }
  if (rawPreset === 'glyph-rain') {
    let glyphRain = DEFAULT_GLYPH_RAIN;
    try { glyphRain = normalizeGlyphRain(JSON.parse(String(attrs['data-glyph-rain'] ?? ''))) ?? DEFAULT_GLYPH_RAIN; } catch { /* defaults */ }
    return { preset: rawPreset, duration, delay, intensity, glyphRain };
  }
  if (rawPreset === 'ripple-water') {
    let ripple = DEFAULT_RIPPLE;
    try { ripple = normalizeRipple(JSON.parse(String(attrs['data-ripple'] ?? ''))) ?? DEFAULT_RIPPLE; } catch { /* defaults */ }
    return { preset: rawPreset, duration, delay, intensity, ripple };
  }
  if (rawPreset === 'particle-object') {
    let particle = DEFAULT_PARTICLE;
    try { particle = normalizeParticle(JSON.parse(String(attrs['data-particle-object'] ?? ''))) ?? DEFAULT_PARTICLE; } catch { /* defaults */ }
    return { preset: rawPreset, duration, delay, intensity, particle };
  }
  return { preset: rawPreset, duration, delay, intensity };
}
