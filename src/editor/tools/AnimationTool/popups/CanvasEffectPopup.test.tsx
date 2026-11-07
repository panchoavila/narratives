import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DEFAULT_CANVAS_EFFECT } from '@/shared/canvas-effects';
import { CanvasEffectPopup } from './CanvasEffectPopup';
import { updateHtmlAttrsInCode } from '@/code/generation/generator-attrs';
import { parse } from '@babel/parser';
import { parseJSXToNodes } from '@/code/parsing/parser';
const { mutation, scaffold } = vi.hoisted(() => ({ mutation: vi.fn(), scaffold: vi.fn(() => true) }));
vi.mock('@/code/mutation/mutation-queue', () => ({ queueMutation: mutation, flushNow: vi.fn() }));
vi.mock('@/canvas/hooks/useStableAtomSync', () => ({ expediteStableAtomSync: vi.fn() }));
vi.mock('@/code/project/glitch-ops', () => ({ ensureGlitchElementRuntime: scaffold }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); mutation.mockClear(); scaffold.mockClear(); vi.unstubAllGlobals(); });

describe('Canvas effect picker', () => {
  it('writes a Ripple config through the existing attribute mutation', () => {
    const ui=render(<CanvasEffectPopup nodeId="image" config={{...DEFAULT_CANVAS_EFFECT, preset:'glitch'}} isParticleTarget />);
    fireEvent.change(ui.getByRole('combobox'), { target: { value: 'ripple-water' } });
    expect(scaffold).toHaveBeenCalledOnce();
    const attrs=mutation.mock.calls[0][0].attrs;
    expect(attrs['data-canvas-effect']).toBe('ripple-water');
    expect(JSON.parse(attrs['data-ripple'])).toMatchObject({version:1,trigger:'click',wavelength:80});
  });
  it('only offers Particle Object for images and SVGs', () => {
    const ui=render(<CanvasEffectPopup nodeId="box" config={{...DEFAULT_CANVAS_EFFECT, preset:'glitch'}} />);
    expect(ui.queryByRole('option',{name:'Particle Object'})).toBeNull();
    ui.rerender(<CanvasEffectPopup nodeId="image" config={{...DEFAULT_CANVAS_EFFECT, preset:'glitch'}} isParticleTarget />);
    expect(ui.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Glitch', 'Glyph Rain', 'Ripple', 'Particle Object',
    ]);
  });
  it('keeps custom glyph characters safe in the generated JSX attribute', () => {
    const ui=render(<CanvasEffectPopup nodeId="label" config={{...DEFAULT_CANVAS_EFFECT, preset:'glyph-rain'}} />);
    const input=ui.getAllByRole('textbox').find(el => (el as HTMLInputElement).value.includes('アイウ'))!;
    fireEvent.focus(input);fireEvent.change(input,{target:{value:"A'&<"}});fireEvent.blur(input);
    const attrs=mutation.mock.calls[0][0].attrs;
    const code=updateHtmlAttrsInCode('export default () => <div data-id="label" />','label',attrs);
    expect(() => parse(code,{sourceType:'module',plugins:['jsx']})).not.toThrow();
    expect(JSON.parse(attrs['data-glyph-rain']).charset).toBe("A'&<");
    const node = parseJSXToNodes(code).get('label');
    expect(JSON.parse(String(node?.attrs?.['data-glyph-rain'])).charset).toBe("A'&<");
  });
});
