import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { selectedIdsAtom } from '@/code/stores/store';
import { activeFilePathAtom, getVariantBasePage, isPageClientFile, isPageServerFile, listPageFiles, getFileDisplayName } from '@/code/project/active-file-store';
import { projectVersionAtom } from '@/code/project/project-fs';
import { getEffectsForPage, getInheritedPageEffectForPage, setPageEffectForPage, removePageEffectForPage, routeForPage } from '@/code/project/page-effects-ops';
import { isHomeRoute, type PageEffect } from '@/code/project/page-effects-config';
import { PRESET_OPTIONS } from '@/code/generation/view-transition-css';
import { useActiveViewports } from '@/canvas/hooks/useActiveViewports';
import { DEFAULT_DISPLACEMENT } from '@/shared/displacement-config';
import { trace } from '@/shared/debug-trace';
import { ToolSection, ToolRow, ToolSelect, ToolInput, ToolDivider, ToolButton, ControlActionRow, RemoveButton } from '@/editor/controls';
import ToolPopup from '@/editor/ui/ToolPopup';
import PageEffectPopup from '@/editor/tools/PageEffectTool/PageEffectPopup';
import { sceneActiveAtom, sceneCameraAtom, sceneSeparationAtom, DEFAULT_SCENE_CAMERA } from './scene-state';

/** Native sidebar sections for the current 3D workspace, independent of selection. */
export default function SceneProperties() {
  const active = useAtomValue(sceneActiveAtom);
  if (!active) return null;
  return <div data-scene-properties="">
    <SceneViewportProperties />
    <ScenePageTransitions />
    <ToolDivider />
  </div>;
}

function SceneViewportProperties() {
  const [viewport, setViewport] = useAtom(interactingViewportIdAtom);
  const setSelection = useSetAtom(selectedIdsAtom);
  const views = useActiveViewports();
  const [camera, setCamera] = useAtom(sceneCameraAtom);
  const [separation, setSeparation] = useAtom(sceneSeparationAtom);
  return <>
    <ToolSection title="Viewport">
      <label className="w-full" data-scene-viewport-select="">
        <span className="sr-only">3D viewport</span>
        <ToolSelect value={viewport} options={views.map(v => ({ value: v.id, label: v.label || v.id }))} onChange={id => {
          setViewport(id); setSelection(['root']); trace.action('scene-composer:viewport', { id });
        }} />
      </label>
    </ToolSection>
    <ToolDivider />
    <ToolSection title="3D view">
      <ToolRow label="Projection">
        <label className="w-full"><span className="sr-only">3D projection</span>
          <ToolSelect value={camera.perspective ? 'perspective' : 'orthographic'} options={[{ value:'orthographic', label:'Orthographic' },{ value:'perspective', label:'Perspective' }]} onChange={value => {
            setCamera(c => ({ ...c, perspective: value === 'perspective', previousPerspective: value === 'perspective' }));
            trace.action('scene-composer:projection-control', { value });
          }} />
        </label>
      </ToolRow>
      <ToolRow label="Layers">
        <label className="w-full"><span className="sr-only">Layer separation</span>
          <ToolInput value={String(separation)} chevronLabel="px" min={0} max={96} step={1} onChange={value => {
            const next = Number(value); if (!Number.isFinite(next)) return;
            setSeparation(Math.max(0, Math.min(96, next))); trace.action('scene-composer:separation', { value: next });
          }} />
        </label>
      </ToolRow>
      <ToolButton onClick={() => { setCamera({ ...DEFAULT_SCENE_CAMERA }); trace.action('scene-composer:reset-view', {}); }}>Reset view</ToolButton>
    </ToolSection>
  </>;
}

function ScenePageTransitions() {
  const activeFile = useAtomValue(activeFilePathAtom);
  const file = getVariantBasePage(activeFile) ?? activeFile;
  useAtomValue(projectVersionAtom); // Authored settings stay live when changed elsewhere.
  const setVersion = useSetAtom(projectVersionAtom);
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const anchorRef = useRef<HTMLElement | null>(null);
  useEffect(() => { setOpenTarget(null); setError(''); }, [file]);
  const isPage = isPageClientFile(file) || isPageServerFile(file);
  if (!isPage) return null;
  const effects = getEffectsForPage(file);
  const inherited = getInheritedPageEffectForPage(file);
  if (inherited) effects.push(inherited);
  const options = [
    ...(isHomeRoute(routeForPage(file)) ? [{ value:'all', label:'All Pages' }] : []),
    ...listPageFiles().filter(f => f !== file).map(f => ({ value:routeForPage(f), label:isHomeRoute(routeForPage(f)) ? 'Home' : getFileDisplayName(f) })),
  ];
  // Existing legacy/all targets remain editable even if they are not offered for new effects.
  for (const effect of effects) if (!options.some(o => o.value === effect.target)) options.push({ value:effect.target, label:effect.target === 'all' ? 'All Pages' : effect.target });
  const openEffect = effects.find(effect => effect.target === openTarget);
  const commit = (previousTarget: string, next: PageEffect) => {
    const scope = inherited?.target === previousTarget ? 'default' : 'page';
    if (!setPageEffectForPage(file, next, scope)) { setError('The page needs a layout to save transitions.'); return; }
    if (previousTarget !== next.target) removePageEffectForPage(file, previousTarget, scope);
    setVersion(v => v + 1); setOpenTarget(next.target); setError('');
    trace.action('scene-composer:transition-settings', { file, target:next.target, preset:next.preset });
  };
  const available = options.find(option => !effects.some(effect => effect.target === option.value));
  return <div data-scene-page-transitions="">
    <ToolDivider />
    <ToolSection title="Page transitions">
      {inherited && <span className="text-xs text-[var(--text-secondary)]">Includes the site default</span>}
      {effects.map(effect => <ToolRow key={effect.target} label={options.find(o => o.value === effect.target)?.label || effect.target} truncateLabel>
        <ControlActionRow className="px-2" data-scene-transition={effect.target} onClick={event => {
          anchorRef.current = event.currentTarget as HTMLElement; setOpenTarget(effect.target);
          trace.action('scene-composer:open-transition', { file, target:effect.target });
        }}>
          <span className="truncate flex-1 text-left">{PRESET_OPTIONS.find(p => p.value === effect.preset)?.label || effect.preset}</span>
          <RemoveButton onClick={() => { removePageEffectForPage(file, effect.target, effect === inherited ? 'default' : 'page'); setVersion(v => v + 1); if (openTarget === effect.target) setOpenTarget(null); }} />
        </ControlActionRow>
      </ToolRow>)}
      {!effects.length && <span className="text-xs text-[var(--text-secondary)]">No page transition</span>}
      {available && <ToolButton onClick={event => {
        anchorRef.current = event.currentTarget as HTMLElement;
        commit(available.value, { preset:'displacement', target:available.value, displacement:{ ...DEFAULT_DISPLACEMENT } });
      }}>Add transition</ToolButton>}
      {error && <span role="alert" className="text-xs text-[var(--text-secondary)]">{error}</span>}
    </ToolSection>
    {openEffect && <ToolPopup isOpen onClose={() => setOpenTarget(null)} title="Page transition" anchorRef={anchorRef} resetKey={`${file}:${openTarget}`}>
      {openEffect === inherited && <p className="px-1 pb-2 text-xs text-[var(--text-secondary)]">Applies to all pages.</p>}
      <PageEffectPopup effect={openEffect} targetOptions={openEffect === inherited ? [{ value:'all', label:'All Pages' }] : options} onChange={next => commit(openEffect.target, next)} />
    </ToolPopup>}
  </div>;
}
