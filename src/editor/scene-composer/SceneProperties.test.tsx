import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import PropertiesPanel from '@/editor/PropertiesPanel';
import { resetProjectFS, projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { selectedIdsAtom, codeAtom } from '@/code/stores/store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { getEffectsForPage, getInheritedPageEffectForPage } from '@/code/project/page-effects-ops';
import { serializePageEffects } from '@/code/project/page-effects-config';
import { DEFAULT_DISPLACEMENT } from '@/shared/displacement-config';
import { sceneActiveAtom, sceneCameraAtom, sceneSeparationAtom, DEFAULT_SCENE_CAMERA } from './scene-state';

const store = getDefaultStore();
const paths = ['app/page.client.tsx','app/page.tsx','app/espacio/page.client.tsx','app/espacio/page.tsx','app/layout.tsx','app/page-effects-runtime.ts','app/page-transitions.tsx'];
const files = new Map(paths.map(path => [path, readFileSync(`sites/canvas/${path}`, 'utf8')]));
// The Canvas project's saved transition can change independently of this test.
files.set('app/page-effects.ts', serializePageEffects({
  pages: {},
  __default: { preset: 'displacement', target: 'all', displacement: DEFAULT_DISPLACEMENT },
}));
const page = 'app/page.client.tsx';

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c.codePointAt(0)!.toString(16)} `) });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = ((q: string) => ({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})) as any;
  resetProjectFS(new Map(files));
  store.set(activeFilePathAtom, page); store.set(codeAtom, files.get(page)!);
  store.set(selectedIdsAtom, ['root']); store.set(interactingViewportIdAtom, 'desktop');
  store.set(sceneActiveAtom, false); store.set(sceneCameraAtom, {...DEFAULT_SCENE_CAMERA}); store.set(sceneSeparationAtom, 24);
  store.set(projectVersionAtom, v => v + 1);
});
afterEach(() => { cleanup(); store.set(sceneActiveAtom, false); vi.unstubAllGlobals(); });

function edit(input: HTMLElement, value: string) {
  fireEvent.focus(input); fireEvent.change(input, {target:{value}}); fireEvent.blur(input);
}
function openSettings() {
  const section = document.querySelector('[data-scene-page-transitions]')! as HTMLElement;
  fireEvent.click(within(section).getByRole('button', {name:/Displacement/}));
  return document.querySelector<HTMLElement>('[data-tool-popup]')!;
}

describe('3D settings in the native right sidebar', () => {
  it('persists Glitch and Ripple transition controls through the native popup', () => {
    store.set(sceneActiveAtom, true);
    const ui = render(<PropertiesPanel />);
    openSettings();
    fireEvent.change(ui.getByLabelText('Transition preset'), { target: { value: 'glitch' } });
    edit(ui.getByLabelText('Slices'), '47');
    expect(getEffectsForPage(page)[0]).toMatchObject({ preset: 'glitch', glitch: { slices: 47 } });
    fireEvent.change(ui.getByLabelText('Transition preset'), { target: { value: 'ripple-water' } });
    edit(ui.getByLabelText('Wavelength (px)'), '120');
    expect(getEffectsForPage(page)[0]).toMatchObject({ preset: 'ripple-water', ripple: { wavelength: 120 } });
  });
  it('shows grouped 3D controls once in PropertiesPanel while keeping element tools', async () => {
    const ui = render(<PropertiesPanel />);
    expect(ui.queryByLabelText('3D viewport')).toBeNull();
    act(() => store.set(sceneActiveAtom, true));
    const selector = ui.getByLabelText('3D viewport');
    expect(selector.closest('[data-properties-panel]')).not.toBeNull();
    expect(ui.getByText('3D view')).toBeTruthy();
    expect(ui.getByText('Page transitions')).toBeTruthy();
    expect(ui.getAllByRole('button', {name:/Displacement/})).toHaveLength(1);
    // A responsive choice is the real editor write target, not an isolated preview.
    fireEvent.change(selector, {target:{value:'mobile'}});
    expect(store.get(interactingViewportIdAtom)).toBe('mobile');
    fireEvent.change(ui.getByLabelText('3D projection'), {target:{value:'perspective'}});
    expect(store.get(sceneCameraAtom).perspective).toBe(true);
    edit(ui.getByLabelText(/Layer separation/), '48');
    expect(store.get(sceneSeparationAtom)).toBe(48);
    act(() => store.set(sceneActiveAtom, false));
    expect(ui.queryByLabelText('3D viewport')).toBeNull();
    expect(ui.getAllByRole('button', {name:/Displacement/})).toHaveLength(1);
  });

  it('keeps the responsive selector and existing transition accessible with no element selected', () => {
    store.set(selectedIdsAtom, []); store.set(sceneActiveAtom, true);
    const ui = render(<PropertiesPanel />);
    expect(ui.getByLabelText('3D viewport').closest('[data-properties-panel]')).toBeTruthy();
    expect(openSettings()).toBeTruthy();
    expect(ui.getByLabelText('Duration (s)')).toBeTruthy();
  });

  it('opens Canvas’s existing Displacement settings and persists successive edits without replacing the effect', async () => {
    store.set(sceneActiveAtom, true);
    const original = getEffectsForPage(page)[0];
    const ui = render(<PropertiesPanel />);
    const popup = openSettings(); expect(popup).toBeTruthy();
    expect((ui.getByLabelText('Duration (s)') as HTMLInputElement).value).toBe(String(original.displacement!.duration));
    expect((ui.getByLabelText('Seed') as HTMLInputElement).value).toBe(String(original.displacement!.seed));
    edit(ui.getByLabelText('Duration (s)'), '1.8');
    edit(ui.getByLabelText('Seed'), '31');
    const saved = getEffectsForPage(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({...original,displacement:{...original.displacement!,duration:1.8,seed:31}});
    expect(projectFS.readFile(page)).toBe(files.get(page));
    expect(projectFS.readFile('app/espacio/page.client.tsx')).toBe(files.get('app/espacio/page.client.tsx'));
    fireEvent.keyDown(window, {key:'Escape'});
    await waitFor(() => expect(document.querySelector('[data-tool-popup]')).toBeNull());
    openSettings();
    expect((ui.getByLabelText('Duration (s)') as HTMLInputElement).value).toBe('1.8');
    expect((ui.getByLabelText('Seed') as HTMLInputElement).value).toBe('31');
  });

  it('exposes and updates the inherited site transition on Canvas’s second page', () => {
    const second = 'app/espacio/page.client.tsx';
    store.set(activeFilePathAtom, second); store.set(codeAtom, files.get(second)!); store.set(sceneActiveAtom, true);
    const ui = render(<PropertiesPanel />);
    expect(getEffectsForPage(second)).toHaveLength(0);
    openSettings();
    expect(ui.getByText('Applies to all pages.')).toBeTruthy();
    edit(ui.getByLabelText('Strength'), '.08');
    expect(getInheritedPageEffectForPage(second)?.displacement?.strength).toBe(.08);
    expect(getEffectsForPage(page)[0].displacement?.strength).toBe(.08);
    expect(getEffectsForPage(second)).toHaveLength(0); // no duplicate or accidental page override
  });
});
