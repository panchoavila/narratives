import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotionValue } from '../../../packages/revyme-runtime-scene/src/use-reduced-motion-value';
import { updateScrollAnimInCode } from './generator-motion-scroll';
import { clearNodeScrollFx, dormantizeScrollFx, removeScrollAnimFromCode, removeScrollSpeedFromCode, updateScrollSpeedInCode, setScrollFxInCode, getScrollFx, getSpeedResponsive } from './generator-motion-scroll-fx';
import { getScrollDataForNode, parseScrollHooks } from '../parsing/scroll-parser';
import { parseJSX } from '../parsing/ast-utils';
import { syncImports, validateGeneratedCode } from '../mutation/mutation-queue';
import { checkFile } from '../oracle/check-file';

const PAGE = `import { motion } from 'framer-motion';
export default function Page() {
  return <motion.div data-id="root" style={{ position: 'relative', rotate: 15 }} />;
}`;
const config = { nodeId: 'root', trigger: 'layerInView' as const, stops: [{ progress: 0, props: { rotate: '50', opacity: '0' } }, { progress: 1, props: { rotate: '0', opacity: '1' } }] };

describe('reduced-motion scroll values', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  it('freezes only the output while preserving the source and responds to preference changes', async () => {
    let listener: (() => void) | undefined; const query = { matches: false, addEventListener: vi.fn((_event, cb) => { listener = cb; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => query);
    const source = motionValue(22); let output: MotionValue<number> | undefined;
    function Probe() { const value = useReducedMotionValue(source, 15); useEffect(() => { output = value; }, [value]); return null; }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<Probe />); }); expect(output!.get()).toBe(22);
    await act(async () => { source.set(30); }); expect(output!.get()).toBe(30);
    await act(async () => { query.matches = true; listener?.(); }); expect(output!.get()).toBe(15);
    await act(async () => { source.set(45); }); expect(source.get()).toBe(45); expect(output!.get()).toBe(15);
    await act(async () => { query.matches = false; listener?.(); }); expect(output!.get()).toBe(45);
    await act(async () => { root.unmount(); }); expect(query.removeEventListener).toHaveBeenCalledOnce();
  });
  it('preserves the authored base and scroll controls through re-edit and removal', () => {
    const first = updateScrollAnimInCode(PAGE, config);
    expect(first).toContain('useReducedMotionValue(rootRotate, 15, true)');
    expect(first).toContain('useReducedMotionValue(rootOpacity, 1)');
    const parsed = getScrollDataForNode(parseScrollHooks(first), 'root');
    expect(parsed.bindings.find(b => b.property === 'rotate')).toMatchObject({ transformVar: 'rootRotate', styleVar: 'rootRotateReduced' });
    expect(parsed.transforms.find(t => t.varName === 'rootRotate')?.outputRange).toBe('[50, 0]');
    const second = updateScrollAnimInCode(first, config);
    expect(second.match(/const rootRotateReduced/g)).toHaveLength(1);
    expect(second).toContain('useReducedMotionValue(rootRotate, 15, true)');
    expect(parseJSX(second)).not.toBeNull();
    expect(validateGeneratedCode(syncImports(second))).toBeNull();
    expect(checkFile(second, { kind: 'page' }).map(v => v.code)).not.toContain('PAGE_HOOK_UNRESOLVED');
    const removed = removeScrollAnimFromCode(second, 'root');
    expect(removed).not.toMatch(/useReducedMotionValue\(/);
    expect(removed).toMatch(/rotate:\s*15/);
    expect(parseJSX(removed)).not.toBeNull();
  });
  it('rejects hand-written reduced-motion wrappers outside the generated dialect', () => {
    const code = PAGE.replace('return <motion', 'const arbitrary = useReducedMotionValue(someValue, dynamicFallback); return <motion');
    expect(checkFile(code, { kind: 'page' }).map(v => v.code)).toContain('PAGE_HOOK_UNRESOLVED');
  });
  it('preserves the reduced alias across multi-section regeneration and removal', () => {
    const multi = { nodeId: 'root', trigger: 'sectionInView' as const, sectionId: '', sectionViewport: 'middle' as const,
      fromProps: { rotate: '0' }, sections: [{ sectionId: 'about', props: { rotate: '45' } }, { sectionId: 'contact', props: { rotate: '90' } }], stops: [] };
    const first = updateScrollAnimInCode(PAGE, multi);
    expect(first).toContain('useReducedMotionValue(rootRotate, 15, true)');
    const edited = updateScrollAnimInCode(first, multi);
    expect(edited.match(/const rootRotateReduced/g)).toHaveLength(1);
    expect(edited).toContain('useReducedMotionValue(rootRotate, 15, true)');
    expect(validateGeneratedCode(syncImports(edited))).toBeNull();
    const removed = removeScrollAnimFromCode(edited, 'root');
    expect(removed).toMatch(/rotate:\s*15/);
    expect(removed).not.toContain('useReducedMotionValue');
  });
  it('keeps the reduced alias when a hover shares its channel', () => {
    const code = setScrollFxInCode(PAGE, 'root', { transform: { trigger: 'layerInView', from: { scale: '0.7' }, to: { scale: '1' } }, hover: { props: { scale: '1.1' } } });
    expect(code).toContain('useReducedMotionValue(rootScale, 1)');
    expect(code).toMatch(/useTransform\(\[[^\]]*rootScaleReduced/);
    expect(getScrollFx(code, 'root')?.transform?.to.scale).toBe('1');
    expect(validateGeneratedCode(syncImports(code))).toBeNull();
  });
  it('retains speed and its authored base through edits and independent removal', () => {
    const page = PAGE.replace('rotate: 15', 'rotate: 15, y: 24');
    const speed = updateScrollSpeedInCode(page, { nodeId: 'root', speed: 70 });
    expect(speed).toContain('useReducedMotionValue(rootSpeedY, 24, true)');
    const both = updateScrollAnimInCode(speed, config);
    expect(both).toContain('const rootSpeedYReduced = useReducedMotionValue(rootSpeedY, 24, true)');
    expect(getSpeedResponsive(both, 'root')?.base).toBe(70);
    expect(validateGeneratedCode(syncImports(both))).toBeNull();
    const edited = updateScrollSpeedInCode(both, { nodeId: 'root', speed: 80 });
    expect(edited).toContain('useReducedMotionValue(rootSpeedY, 24, true)');
    expect(getSpeedResponsive(edited, 'root')?.base).toBe(80);
    const withoutSpeed = removeScrollSpeedFromCode(edited, 'root');
    expect(withoutSpeed).toMatch(/y:\s*24/);
    expect(withoutSpeed).toContain('useReducedMotionValue(rootRotate, 15, true)');
    const clean = removeScrollAnimFromCode(withoutSpeed, 'root');
    expect(clean).not.toContain('useReducedMotionValue');
    expect(validateGeneratedCode(syncImports(clean))).toBeNull();
  });
  it('removes an unused runtime import when clearing or dormantizing effects', () => {
    const code = setScrollFxInCode(PAGE, 'root', { transform: { trigger: 'layerInView', from: { scale: '0.7' }, to: { scale: '1' } }, speed: 80 });
    expect(code).toContain('useReducedMotionValue(');
    expect(clearNodeScrollFx(code, 'root')).not.toContain('useReducedMotionValue');
    const dormant = dormantizeScrollFx(code, 'root');
    expect(dormant).not.toContain('useReducedMotionValue');
    expect(dormant).toContain('data-scroll-fx');
  });
});
