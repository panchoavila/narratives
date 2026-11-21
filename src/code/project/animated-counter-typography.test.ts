import { describe, expect, it } from 'vitest';
import { ANIMATED_COUNTER_COMPONENT } from './default-code-components/AnimatedCounter';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';

describe('animated counter typography', () => {
  it('exposes and applies line height and letter spacing as editable controls', () => {
    const controls = parseComponentControlsMeta(ANIMATED_COUNTER_COMPONENT)!.controls;
    expect(controls.lineHeight?.type).toBe('number');
    expect(controls.letterSpacing?.type).toBe('number');
    expect(ANIMATED_COUNTER_COMPONENT).toContain("lineHeight, letterSpacing: letterSpacing + 'em'");
    expect(checkFile(ANIMATED_COUNTER_COMPONENT, { kind: 'code-component', path: 'components/AnimatedCounter.tsx' })).toEqual([]);
  });
});
