import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevymeViewportVideo } from '../../../packages/revyme-runtime-scene/src/viewport-video';
import { VIEWPORT_VIDEO_COMPONENT } from './default-code-components/ViewportVideo';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';
import { buildSourceExport } from './source-export';

describe('viewport video', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  it('plays on entry, pauses on exit and disconnects on unmount', async () => {
    let onIntersection: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn(), observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { onIntersection = callback; } observe = observe; disconnect = disconnect; });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('autoplay denied'));
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeViewportVideo src="/reel.mp4" poster="/poster.jpg" />); });
    expect(observe).toHaveBeenCalledOnce();
    await act(async () => { onIntersection?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(play).toHaveBeenCalledOnce();
    await act(async () => { onIntersection?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(pause).toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it('does not autoplay in the static canvas or under reduced motion', async () => {
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect = vi.fn(); });
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<RevymeViewportVideo static src="/reel.mp4" />); });
    expect(play).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled();
    await act(async () => { root.render(<RevymeViewportVideo src="/reel.mp4" />); });
    expect(play).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
  it('exports the adapter and shared runtime as part of a portable site', async () => {
    const result = await buildSourceExport({ 'components/ViewportVideo.tsx': VIEWPORT_VIDEO_COMPONENT }, { name: 'video-test', runtimeRange: '^0.0.32' });
    expect(result.files['components/ViewportVideo.tsx']).toContain('RevymeViewportVideo');
    expect(result.files['vendor/revyme-runtime/dist/index.js']).toContain('RevymeViewportVideo');
    expect(JSON.parse(result.files['package.json']).dependencies['@revyme/runtime']).toBe('file:./vendor/revyme-runtime');
  });
  it('exposes video source, poster, controls and playback settings to the editor', () => {
    const controls = parseComponentControlsMeta(VIEWPORT_VIDEO_COMPONENT)!.controls;
    expect(Object.keys(controls)).toEqual(['src','poster','fit','playInView','controls','muted','loop']);
    expect(checkFile(VIEWPORT_VIDEO_COMPONENT, { kind: 'code-component', path: 'components/ViewportVideo.tsx' })).toEqual([]);
  });
});
