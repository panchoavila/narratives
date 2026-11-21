// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { RevymeSmartSpacer } from '../../../../packages/revyme-runtime-scene/src/smart-spacer';

let notify: ResizeObserverCallback;
const observe=vi.fn(), disconnect=vi.fn();
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) { notify=callback; }
  observe=observe;
  disconnect=disconnect;
  unobserve=vi.fn();
}
afterEach(() => { cleanup(); document.body.innerHTML=''; vi.unstubAllGlobals(); observe.mockClear(); disconnect.mockClear(); });

describe('SmartSpacer', () => {
  it('uses deterministic fallback in static canvas without observing', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { container }=render(<RevymeSmartSpacer static targetId="left" fallbackWidth={17} fallbackHeight={23}/>);
    expect((container.firstElementChild as HTMLElement).style.width).toBe('17px');
    expect((container.firstElementChild as HTMLElement).style.height).toBe('23px');
    expect(observe).not.toHaveBeenCalled();
  });
  it('measures the target, updates on resize and disconnects on unmount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const target=document.createElement('div'); target.id='left'; document.body.appendChild(target);
    let height=64;
    vi.spyOn(target,'getBoundingClientRect').mockImplementation(() => ({width:120,height,x:0,y:0,top:0,left:0,right:120,bottom:height,toJSON:()=>({})}));
    const {container,unmount}=render(<RevymeSmartSpacer targetId="#left" widthFrom="targetHeight" heightFrom="targetHeight" wScale={2} wOffset={4} hMax={80}/>);
    const spacer=container.firstElementChild as HTMLElement;
    expect(spacer.style.width).toBe('132px'); expect(spacer.style.height).toBe('64px');
    expect(observe).toHaveBeenCalledWith(target);
    height=100; act(()=>notify([],{} as ResizeObserver));
    expect(spacer.style.width).toBe('204px'); expect(spacer.style.height).toBe('80px');
    unmount(); expect(disconnect).toHaveBeenCalled();
  });
  it('uses fallback when the selector is invalid or no target exists', () => {
    const {container}=render(<RevymeSmartSpacer sourceMode="selector" targetSelector="[" fallbackWidth={11} fallbackHeight={12}/>);
    expect((container.firstElementChild as HTMLElement).style.width).toBe('11px');
    expect((container.firstElementChild as HTMLElement).style.height).toBe('12px');
  });
  it('connects to a target added after mount and releases a removed target', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const {container}=render(<RevymeSmartSpacer targetId="later" fallbackWidth={9}/>);
    const spacer=container.firstElementChild as HTMLElement;
    expect(spacer.style.width).toBe('9px');
    const target=document.createElement('div'); target.id='later';
    vi.spyOn(target,'getBoundingClientRect').mockReturnValue({width:40,height:50,x:0,y:0,top:0,left:0,right:40,bottom:50,toJSON:()=>({})});
    await act(async () => { document.body.appendChild(target); await Promise.resolve(); });
    expect(spacer.style.width).toBe('50px');
    await act(async () => { target.remove(); await Promise.resolve(); });
    expect(spacer.style.width).toBe('9px');
    expect(disconnect).toHaveBeenCalled();
  });
});
