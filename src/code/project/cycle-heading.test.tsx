import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevymeCycleHeading } from '../../../packages/revyme-runtime-scene/src/cycle-heading';
import { CYCLE_HEADING_COMPONENT } from './default-code-components/CycleHeading';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';

describe('cycle heading', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  it('cycles in view and stops timers and observers after unmount', async () => {
    vi.useFakeTimers();
    const callbacks: IntersectionObserverCallback[] = []; const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); } observe = vi.fn(); disconnect = disconnect; });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeCycleHeading phrases={'Primera\nSegunda'} duration={0} pauseDuration={1} />); });
    expect(host.textContent).toContain('Primera');
    await act(async () => { for (const callback of callbacks) callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(host.textContent).toContain('Segunda');
    await act(async () => { root.unmount(); });
    expect(disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('renders staggered semantic text and respects reduced motion', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeCycleHeading mode="stagger" tag="h2" phrases={'REAL?\nAUTÉNTICO?'} fontSize={48} />); });
    expect(host.querySelector('h2')?.getAttribute('aria-label')).toBe('REAL?');
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(host.querySelector('h2')?.getAttribute('aria-label')).toBe('REAL?');
    await act(async () => { root.unmount(); });
  });
  it('keeps the first phrase for reduced motion and exposes its controls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeCycleHeading phrases={'Primera\nSegunda'} duration={0} pauseDuration={1} />); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(host.textContent).toContain('Primera');
    expect(host.textContent).not.toContain('Segunda');
    await act(async () => { root.unmount(); });
    expect(Object.keys(parseComponentControlsMeta(CYCLE_HEADING_COMPONENT)!.controls)).toEqual(['phrases','mode','staggerDelay','exitStaggerDelay','easing','pauseDuration','duration','tag','fontFamily','fontSize','lineHeight','letterSpacing','color','textAlign']);
    expect(checkFile(CYCLE_HEADING_COMPONENT, { kind: 'code-component', path: 'components/CycleHeading.tsx' })).toEqual([]);
  });
});
