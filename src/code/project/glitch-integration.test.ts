import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_GLITCH, normalizeGlitch } from '../../../packages/revyme-runtime-scene/src/glitch-config';
import { DEFAULT_GLYPH_RAIN, normalizeGlyphRain } from '../../../packages/revyme-runtime-scene/src/glyph-rain';
import { DEFAULT_RIPPLE, normalizeRipple } from '../../../packages/revyme-runtime-scene/src/ripple-config';
import { DEFAULT_PARTICLE, normalizeParticle } from '../../../packages/revyme-runtime-scene/src/particle-config';
import { parseCanvasEffectFromAttrs } from '@/shared/canvas-effects';
import { parsePageEffects, serializePageEffects, upsertEffectInMap } from './page-effects-config';
import { resolvePageEffect } from '../generation/view-transition-css';
import { buildSourceExport } from './source-export';
import controller from '../generation/page-displacement-controller.tsx.txt?raw';
import { liftVhsSurfaces, wrapVhsSurfaces } from '../generation/vhs-gen';
import { updateHtmlAttrsInCode } from '../generation/generator-attrs';
import { parseJSXToNodes } from '@/code/parsing/parser';

describe('Glitch authoring and export', () => {
  it('bounds invalid values without losing zero as a valid continuous interval', () => {
    expect(normalizeGlitch({ ...DEFAULT_GLITCH, intensity: 8, interval: 0, slices: 1, noise: NaN }))
      .toEqual({ ...DEFAULT_GLITCH, intensity: 2, interval: 0, slices: 3 });
    expect(normalizeGlitch({ version: 2 })).toBeNull();
  });
  it('recovers object options from the saved element attributes', () => {
    const result = parseCanvasEffectFromAttrs({ 'data-canvas-effect': 'glitch', 'data-glitch-interval': '0', 'data-glitch-slices': '47', 'data-glitch-rgb-shift': '6' });
    expect(result?.glitch).toEqual({ ...DEFAULT_GLITCH, interval: 0, slices: 47, rgbShift: 6 });
  });
  it('round-trips a page transition and exports its executable runtime', async () => {
    const map = upsertEffectInMap({ pages: {} }, '/', { target: '/about', preset: 'glitch', glitch: { ...DEFAULT_GLITCH, slices: 47 } });
    expect(resolvePageEffect(parsePageEffects(serializePageEffects(map)), '/', '/about')?.glitch?.slices).toBe(47);
    const out = await buildSourceExport({ 'app/page-transitions.tsx': controller }, { name: 'test', runtimeRange: '^0.0.32' });
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('runGlitchNavigation');
  });
  it('exports the runtime for an object-only site', async () => {
    const out = await buildSourceExport({ 'app/revyme-glitch-runtime.tsx': '// @revyme-glitch-runtime-v1' }, { name: 'test', runtimeRange: '^0.0.32' });
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('attachGlitchElements');
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('attachGlyphRainElements');
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('attachRippleElements');
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('attachParticleElements');
  });
  it('restores Glyph Rain options from an element and bounds invalid values', () => {
    const glyph = normalizeGlyphRain({ ...DEFAULT_GLYPH_RAIN, cell: 200, color: '#cc3311' })!;
    const parsed = parseCanvasEffectFromAttrs({ 'data-canvas-effect': 'glyph-rain', 'data-glyph-rain': JSON.stringify(glyph) });
    expect(parsed?.glyphRain?.cell).toBe(64);
    expect(parsed?.glyphRain?.color).toBe('#cc3311');
    expect(normalizeGlyphRain({ version: 2 })).toBeNull();
  });
  it('restores Ripple and Particle Object options and clamps unsafe counts', () => {
    const ripple = normalizeRipple({ ...DEFAULT_RIPPLE, trigger: 'hover', rings: 20 })!;
    const particle = normalizeParticle({ ...DEFAULT_PARTICLE, count: 100000 })!;
    expect(parseCanvasEffectFromAttrs({ 'data-canvas-effect': 'ripple-water', 'data-ripple': JSON.stringify(ripple) })?.ripple)
      .toMatchObject({ trigger: 'hover', rings: 8 });
    expect(parseCanvasEffectFromAttrs({ 'data-canvas-effect': 'particle-object', 'data-particle-object': JSON.stringify(particle) })?.particle?.count).toBe(20000);
  });
  it('round-trips Ripple page effects', () => {
    const map = upsertEffectInMap({ pages: {} }, '/', { target: '/about', preset: 'ripple-water', ripple: { ...DEFAULT_RIPPLE, wavelength: 120 } });
    expect(resolvePageEffect(parsePageEffects(serializePageEffects(map)), '/', '/about')?.ripple?.wavelength).toBe(120);
  });
  it('keeps a VHS object editable and includes its WebGL runtime in an object-only export', async () => {
    const plain = 'export default () => <main data-id="root"><button data-id="tape" data-canvas-effect="vhs" data-vhs=\'{"version":1,"duration":1.7}\'>Play</button></main>;';
    const wrapped = wrapVhsSurfaces(plain);
    expect(wrapped).toContain('<RevymeVhs><button');
    expect(wrapVhsSurfaces(wrapped)).toBe(wrapped);
    const node = parseJSXToNodes(wrapped).get('tape');
    expect(node?.parentId).toBe('root');
    expect(parseCanvasEffectFromAttrs(node?.attrs)?.vhs?.duration).toBe(1.7);
    const removed = wrapVhsSurfaces(updateHtmlAttrsInCode(liftVhsSurfaces(wrapped), 'tape', { 'data-canvas-effect': '' }));
    expect(removed).not.toContain('RevymeVhs');
    const out = await buildSourceExport({ 'app/page.client.tsx': wrapped }, { name: 'test', runtimeRange: '^0.0.32' });
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('texElementSubImage2D');
  });
});

describe('Glitch navigation fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });
  it('navigates once without a snapshot for reduced motion', async () => {
    const { runGlitchNavigation } = await import('../../../packages/revyme-runtime-scene/src/glitch-navigation');
    const navigate = vi.fn(async () => {});
    const result = await runGlitchNavigation({ config: DEFAULT_GLITCH, navigate });
    expect(navigate).toHaveBeenCalledOnce();
    expect(result).toEqual({ mode: 'fallback', reason: 'reduced-motion' });
  });
  it('lets Ripple navigate once when reduced motion is enabled', async () => {
    const { runRippleNavigation } = await import('../../../packages/revyme-runtime-scene/src/ripple-navigation');
    const navigate = vi.fn(async () => {});
    expect(await runRippleNavigation({ config: DEFAULT_RIPPLE, navigate })).toEqual({ mode: 'fallback', reason: 'reduced-motion' });
    expect(navigate).toHaveBeenCalledOnce();
  });
  it('falls back to normal navigation if WebGL cannot initialize', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { runRippleNavigation } = await import('../../../packages/revyme-runtime-scene/src/ripple-navigation');
    const navigate = vi.fn(async () => {});
    expect(await runRippleNavigation({ config: DEFAULT_RIPPLE, navigate })).toEqual({ mode: 'fallback', reason: 'WebGL2 unavailable' });
    expect(navigate).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-revyme-displacement-overlay]')).toBeNull();
    context.mockRestore();
  });
  it('keeps the original image visible when Particle Object respects reduced motion', async () => {
    const { attachParticleElements } = await import('../../../packages/revyme-runtime-scene/src/particle-elements');
    const image = document.createElement('img');
    image.setAttribute('data-canvas-effect', 'particle-object');
    document.body.append(image);
    const cleanup = attachParticleElements(document);
    expect(image.hasAttribute('data-revyme-particle-active')).toBe(false);
    expect(document.querySelector('[data-revyme-effect-overlay]')).toBeNull();
    cleanup(); image.remove();
  });
});
