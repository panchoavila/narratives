import { describe, expect, it } from 'vitest';
import { parseCanvasEffectFromAttrs } from '@/shared/canvas-effects';
import { parseLiquidGlassAttribute } from '../../../packages/revyme-runtime-scene/src/liquid-glass-config';
import { updateHtmlAttrsInCode } from '../generation/generator-attrs';
import { parseJSXToNodes } from '../parsing/parser';
import { buildSourceExport } from './source-export';

describe('Liquid Glass authoring and export', () => {
  it('keeps persistent glass independent of the element animation', () => {
    const attrs = { 'data-canvas-effect': 'vhs', 'data-liquid-glass': '{"version":1,"frost":2}' };
    expect(parseCanvasEffectFromAttrs(attrs)?.preset).toBe('vhs');
    expect(parseLiquidGlassAttribute(attrs['data-liquid-glass'])?.frost).toBe(2);
  });

  it('round-trips optical and interaction settings without replacing editable children', () => {
    const config = { version: 1, refraction: 0.08, aberration: 0.6, frost: 2, tint: '#3366ff55',
      interaction: 'fluid', interactionViscosity: 0.8, magnify: 1.4, draggable: true, specular: false };
    const code = updateHtmlAttrsInCode(
      'export default () => <main data-id="root"><section data-id="glass"><button data-id="action">Open</button></section></main>;',
      'glass', { 'data-liquid-glass': JSON.stringify(config) },
    );
    const nodes = parseJSXToNodes(code);
    expect(nodes.get('action')?.parentId).toBe('glass');
    expect(parseLiquidGlassAttribute(nodes.get('glass')?.attrs['data-liquid-glass'])).toMatchObject(config);
    const removed = updateHtmlAttrsInCode(code, 'glass', { 'data-liquid-glass': '' });
    expect(parseLiquidGlassAttribute(parseJSXToNodes(removed).get('glass')?.attrs['data-liquid-glass'])).toBeNull();
    expect(parseJSXToNodes(removed).get('action')?.parentId).toBe('glass');
  });

  it('recovers malformed settings and bounds resource and interaction costs', () => {
    const read = parseLiquidGlassAttribute;
    expect(read('{broken')).toMatchObject({ version: 1, magnify: 1 });
    expect(read(JSON.stringify({ version: 1, resolution: 100, interactionStrength: 100, tiltFactor: 999, frost: -8 })))
      .toMatchObject({ resolution: 2, interactionStrength: 5, tiltFactor: 25, frost: 0 });
  });

  it('exports the executable engine, its licence and all lazy chunks for an object-only site', async () => {
    const out = await buildSourceExport({
      'app/revyme-glitch-runtime.tsx': '// @revyme-glitch-runtime-v4',
    }, { name: 'glass-test', runtimeRange: '^0.0.32' });
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('attachLiquidGlassElements');
    expect(out.files['vendor/revyme-runtime/LIQUIDGL-LICENSE']).toContain('Copyright (c) NaughtyDuk');
    expect(Object.keys(out.files).some(path => /vendor\/revyme-runtime\/dist\/.*liquid.*\.js$/.test(path))).toBe(true);
  });

  it('keeps a native backdrop editable and ships its runtime from JSX alone', async () => {
    const code = `import { RevymeLiquidBackdrop } from '@revyme/runtime';
      export default () => <main data-id="root">
        <RevymeLiquidBackdrop><div data-id="art">Background</div></RevymeLiquidBackdrop>
        <section data-id="glass" data-liquid-glass='{"version":1}' />
      </main>;`;
    const nodes = parseJSXToNodes(code);
    expect(nodes.get('art')?.parentId).toBe('root');
    expect(nodes.get('glass')?.parentId).toBe('root');
    const out = await buildSourceExport({ 'app/page.tsx': code }, { name: 'native-glass', runtimeRange: '^0.0.32' });
    expect(out.files['app/page.tsx']).toBe(code);
    expect(out.files['vendor/revyme-runtime/dist/index.js']).toContain('RevymeLiquidBackdrop');
  });
});
