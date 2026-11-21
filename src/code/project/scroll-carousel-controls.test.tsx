/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevymeScrollCarouselControls } from '../../../packages/revyme-runtime-scene/src/scroll-carousel-controls';
import { SCROLL_CAROUSEL_CONTROLS_COMPONENT } from './default-code-components/ScrollCarouselControls';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';

describe('scroll carousel controls', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  it('navigates the native slides and reflects a manual scroll', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<div><div data-id="track"><a>Agency</a><a>Framework</a><a>Todo</a></div><RevymeScrollCarouselControls targetId="track" labels={'Agency\nFramework\nTodo'} /></div>); });
    const track = host.querySelector('[data-id="track"]') as HTMLElement;
    Array.from(track.children).forEach((el, i) => Object.defineProperty(el, 'offsetLeft', { value: 46 + 262 * i }));
    const scrollTo = vi.fn(); track.scrollTo = scrollTo;
    const buttons = host.querySelectorAll('button'); expect(buttons).toHaveLength(3);
    await act(async () => { buttons[1].click(); });
    expect(scrollTo).toHaveBeenCalledWith({ left: 262, behavior: 'instant' });
    Object.defineProperty(track, 'scrollLeft', { value: 524, configurable: true });
    await act(async () => { track.dispatchEvent(new Event('scroll')); });
    expect(buttons[2].getAttribute('aria-current')).toBe('true');
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    await act(async () => { root.unmount(); });
  });
  it('exposes editable controls and keeps the static canvas inert', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<div><div data-id="track"><div>One</div><div>Two</div></div><RevymeScrollCarouselControls targetId="track" static /></div>); });
    const track = host.querySelector('[data-id="track"]') as HTMLElement; track.scrollTo = vi.fn();
    await act(async () => { host.querySelectorAll('button')[1].click(); }); expect(track.scrollTo).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    expect(Object.keys(parseComponentControlsMeta(SCROLL_CAROUSEL_CONTROLS_COMPONENT)!.controls)).toEqual(['targetId', 'labels', 'size', 'gap', 'color', 'activeColor']);
    expect(checkFile(SCROLL_CAROUSEL_CONTROLS_COMPONENT, { kind: 'code-component', path: 'components/ScrollCarouselControls.tsx' })).toEqual([]);
  });
});
