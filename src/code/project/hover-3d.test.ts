import { describe, expect, it } from 'vitest';
import { hover3DAngles, hover3DTransition } from '../../../packages/revyme-runtime-scene/src/hover-3d';
import { HOVER_3D_COMPONENT } from './default-code-components/Hover3D';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';

describe('3D hover authoring and pointer geometry', () => {
  it('maps the pointer in the local rectangle to both axes and honors directional constraints', () => {
    const rect = { left: 20, top: 50, width: 200, height: 100 };
    expect(hover3DAngles(120, 100, rect, 12, 'all')[0]).toBeCloseTo(0);
    expect(hover3DAngles(120, 100, rect, 12, 'all')[1]).toBeCloseTo(0);
    expect(hover3DAngles(220, 50, rect, 12, 'all')).toEqual([12, 12]);
    expect(hover3DAngles(220, 50, rect, 12, 'vertical')).toEqual([12, 0]);
    expect(hover3DAngles(220, 50, rect, 12, 'horizontal')).toEqual([0, 12]);
    expect(hover3DAngles(220, 50, { ...rect, width: 0 }, 12, 'all')).toEqual([0, 0]);
  });
  it('preserves transition values and falls back safely for invalid settings', () => {
    expect(hover3DTransition('{"type":"spring","stiffness":"300","damping":"25","mass":"1"}')).toMatchObject({ type: 'spring', stiffness: 300, damping: 25, mass: 1 });
    expect(hover3DTransition('{"type":"tween","duration":"0.8","ease":"[0.2,0,0.8,1]"}')).toMatchObject({ type: 'tween', duration: 0.8, ease: [0.2, 0, 0.8, 1] });
    expect(hover3DTransition('bad')).toMatchObject({ type: 'spring', stiffness: 200 });
  });
  it('exposes editable content and settings through the standard code component dialect', () => {
    const meta = parseComponentControlsMeta(HOVER_3D_COMPONENT)!;
    expect(Object.keys(meta.controls)).toEqual(['children', 'angle', 'directions', 'perspective', 'transitionConfig']);
    expect(checkFile(HOVER_3D_COMPONENT, { kind: 'code-component', path: 'components/Hover3D.tsx' })).toEqual([]);
  });
});
