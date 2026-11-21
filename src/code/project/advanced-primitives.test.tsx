import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevymeAdvancedHeading } from '../../../packages/revyme-runtime-scene/src/advanced-heading';
import { RevymeAdvancedFrame } from '../../../packages/revyme-runtime-scene/src/advanced-frame';
import { ADVANCED_FRAME_COMPONENT } from './default-code-components/AdvancedFrame';
import { ADVANCED_HEADING_COMPONENT } from './default-code-components/AdvancedHeading';
import { parseComponentControlsMeta } from '../components/controls-parser';

describe('advanced primitives', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  it('replays appear on viewport re-entry when once is disabled and disconnects on unmount', async () => {
    vi.useFakeTimers();
    let intersection: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { intersection = callback; } observe() {} disconnect = disconnect; });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeAdvancedHeading text="REAL" effect="scramble" trigger="appear" once={false} duration={2} />); });
    const heading = host.querySelector('[data-revyme-advanced-heading]')!;
    const enter = async (value: boolean) => act(async () => { intersection?.([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver); await vi.advanceTimersByTimeAsync(1); });
    await enter(true); expect(heading.getAttribute('data-heading-state')).toBe('running');
    await enter(false); expect(heading.getAttribute('data-heading-state')).toBe('idle');
    await enter(true); expect(heading.getAttribute('data-heading-state')).toBe('running');
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await act(async () => { root.unmount(); });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('provides an editable fill independent of the corner and pattern layers', () => {
    expect(parseComponentControlsMeta(ADVANCED_FRAME_COMPONENT)!.controls.fillColor.type).toBe('color');
    const html = renderToStaticMarkup(<RevymeAdvancedFrame fillColor="#33ff00" cornerStyle="none" patternPreset="none">Contenido</RevymeAdvancedFrame>);
    expect(html).toContain('background-color:#33ff00');
    expect(html).toContain('Contenido');
    expect(html).not.toContain('fillColor=');
  });
  it('keeps one-pixel dots visible at device pixel ratio one and preserves larger radii', () => {
    const small = renderToStaticMarkup(<RevymeAdvancedFrame patternPreset="dots" patternColor="#bcff05" dotSize={1} />);
    expect(small).toContain('radial-gradient(circle, #bcff05 0.1px, transparent 0.9px)');
    const large = renderToStaticMarkup(<RevymeAdvancedFrame patternPreset="dots" patternColor="#bcff05" dotSize={4} />);
    expect(large).toContain('radial-gradient(circle, #bcff05 2px, transparent 2.2px)');
    const zero = renderToStaticMarkup(<RevymeAdvancedFrame patternPreset="dots" dotSize={0} />);
    expect(zero).toContain('background-image:none');
  });
  it('shows the configurable typewriter cursor while typing and after completion', async () => {
    vi.useFakeTimers(); let intersection: IntersectionObserverCallback | undefined;
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { intersection = callback; } observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeAdvancedHeading text="REAL" effect="typewriter" cursor cursorColor="#00ff00" duration={1} />); });
    await act(async () => { intersection?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); await vi.advanceTimersByTimeAsync(400); });
    expect(host.querySelector('[data-heading-cursor]')).not.toBeNull();
    expect((host.querySelector('[data-heading-cursor]') as HTMLElement).style.backgroundColor).toBe('rgb(0, 255, 0)');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(host.querySelector('[data-revyme-advanced-heading]')?.getAttribute('data-heading-state')).toBe('complete');
    expect(host.querySelector('[data-heading-cursor]')).not.toBeNull();
    await act(async () => { root.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
    const controls = parseComponentControlsMeta(ADVANCED_HEADING_COMPONENT)!.controls;
    expect(controls.animation.controls?.cursor?.type).toBe('toggle');
  });
});
