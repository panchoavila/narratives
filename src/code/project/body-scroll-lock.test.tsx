/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevymeBodyScrollLock } from '../../../packages/revyme-runtime-scene/src/body-scroll-lock';
import { BODY_SCROLL_LOCK_COMPONENT } from './default-code-components/BodyScrollLock';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';
describe('body scroll lock', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow=''; document.body.innerHTML=''; });
  it('reference counts locks, restores the prior value and responds to reduced motion', async () => {
    let listener: (() => void) | undefined; const query = { matches: false, addEventListener: vi.fn((_name, cb) => { listener=cb; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => query); document.body.style.overflow='auto';
    const a=document.createElement('div'), b=document.createElement('div'); document.body.append(a,b); const ra=createRoot(a), rb=createRoot(b);
    await act(async()=>{ra.render(<RevymeBodyScrollLock />);rb.render(<RevymeBodyScrollLock />)}); expect(document.body.style.overflow).toBe('hidden');
    await act(async()=>{ra.unmount()}); expect(document.body.style.overflow).toBe('hidden');
    await act(async()=>{query.matches=true;listener?.()}); expect(document.body.style.overflow).toBe('auto');
    await act(async()=>{query.matches=false;listener?.()}); expect(document.body.style.overflow).toBe('hidden');
    await act(async()=>{rb.unmount()}); expect(document.body.style.overflow).toBe('auto'); expect(query.removeEventListener).toHaveBeenCalledTimes(2);
  });
  it('does not lock the static canvas and exposes an active toggle', async () => {
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    await act(async()=>{root.render(<RevymeBodyScrollLock static />)});expect(document.body.style.overflow).toBe('');
    await act(async()=>{root.unmount()});
    expect(parseComponentControlsMeta(BODY_SCROLL_LOCK_COMPONENT)!.controls.active.type).toBe('toggle');
    expect(checkFile(BODY_SCROLL_LOCK_COMPONENT,{kind:'code-component',path:'components/BodyScrollLock.tsx'})).toEqual([]);
  });
});
