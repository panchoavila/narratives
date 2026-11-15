// PageEffectPopup.tsx — the Page Effect editor (ToolPopup root panel): Target,
// Preset, This Page (Exit) + Next/Any Page (Enter) rows. Each side opens a
// SideEditor sub-panel. See plan §6.2.

import { DEFAULT_DISPLACEMENT, normalizeDisplacement } from '@/shared/displacement-config';
import { DEFAULT_GLITCH, normalizeGlitch } from '../../../../packages/revyme-runtime-scene/src/glitch-config';
import { DEFAULT_RIPPLE, normalizeRipple } from '../../../../packages/revyme-runtime-scene/src/ripple-config';
import { DEFAULT_VHS } from '../../../../packages/revyme-runtime-scene/src/vhs-config';
import { VhsControls } from '../AnimationTool/popups/VhsControls';
import { ToolInput } from '../../controls';
import { useEffect } from 'react';
import { ToolRow, ToolSelect, ControlActionRow, RemoveButton } from '../../controls';
import { useToolPopup } from '../../ui/ToolPopup';
import SideEditor from './SideEditor';
import { PRESET_OPTIONS, applyPreset, buildViewTransitionCSS, resolveTiming } from '@/code/generation/view-transition-css';
import { createDefaultSide, type PageEffect, type SideConfig } from '@/code/project/page-effects-config';

export function previewPageEffectOnCanvas(effect: PageEffect): void {
  if (typeof document === 'undefined' || !effect.enter || effect.preset === 'displacement') return;
  const iframe = document.querySelector('iframe[src*="5174"]') as HTMLIFrameElement | null;
  const doc = iframe?.contentDocument ?? document;
  if (!doc.head) return;
  const existing = doc.getElementById('revyme-canvas-vt-preview');
  if (existing) existing.remove();
  const tn = resolveTiming(effect.enter.transition);
  const styleEl = doc.createElement('style');
  styleEl.id = 'revyme-canvas-vt-preview';
  styleEl.textContent =
    buildViewTransitionCSS(effect.exit, effect.enter) +
    `\n[data-id="root"] { animation: ${tn.duration}s ${tn.easing} ${tn.delay}s both revyme-vt-enter !important; transform-origin: 50% 50% !important; }`;
  doc.head.appendChild(styleEl);
  window.setTimeout(() => {
    styleEl.remove();
  }, Math.ceil((tn.duration + tn.delay) * 1000) + 120);
}

/** Small diamond glyph matching the reference's effect icon. */
function Diamond() {
  return (
    <span className="flex items-center justify-center w-5 h-5 rounded shrink-0" style={{ backgroundColor: 'var(--accent)' }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent-fg)"><path d="M12 2 L22 12 L12 22 L2 12 Z" /></svg>
    </span>
  );
}

export default function PageEffectPopup({ effect, onChange, targetOptions }: {
  effect: PageEffect;
  onChange: (e: PageEffect) => void;
  targetOptions: { value: string; label: string }[];
}) {
  const { pushPanel } = useToolPopup();

  useEffect(() => {
    previewPageEffectOnCanvas(effect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPreset = (preset: string) => {
    if (preset === 'displacement') { onChange({ target: effect.target, preset, displacement: { ...DEFAULT_DISPLACEMENT } });return; }
    if (preset === 'glitch') { onChange({ target: effect.target, preset, glitch: { ...DEFAULT_GLITCH } });return; }
    if (preset === 'ripple-water') { onChange({ target: effect.target, preset, ripple: { ...DEFAULT_RIPPLE } });return; }
    if (preset === 'vhs') { onChange({ target: effect.target, preset, vhs: { ...DEFAULT_VHS } });return; }
    if (preset === 'custom') { onChange({ ...effect, preset, displacement: undefined, glitch: undefined, ripple: undefined, vhs: undefined }); return; }
    const sides = applyPreset(preset);
    const nextEffect: PageEffect = { ...effect, preset, displacement: undefined, glitch: undefined, ripple: undefined, vhs: undefined, exit: sides.exit, enter: sides.enter };
    onChange(nextEffect);
    previewPageEffectOnCanvas(nextEffect);
  };

  // Editing any side flips the preset to 'custom' (design-tool parity).
  const setSide = (which: 'exit' | 'enter', side: SideConfig | undefined) => {
    const nextEffect: PageEffect = { ...effect, preset: 'custom', [which]: side };
    onChange(nextEffect);
    previewPageEffectOnCanvas(nextEffect);
  };

  const openSide = (which: 'exit' | 'enter') => {
    const title = which === 'exit' ? 'This Page' : effect.target === 'all' ? 'Any Page' : 'Next Page';
    pushPanel(title, () => (
      <SideEditor side={(which === 'exit' ? effect.exit : effect.enter) ?? createDefaultSide()} onChange={(s) => setSide(which, s)} />
    ));
  };

  const enterLabel = effect.target === 'all' ? 'Any Page' : 'Next Page';

  return (
    <div className="flex flex-col gap-2 p-1">
      <ToolRow label="Target">
        <label className="w-full"><span className="sr-only">Transition target</span><ToolSelect value={effect.target} onChange={(v) => onChange({ ...effect, target: v })} options={targetOptions} /></label>
      </ToolRow>
      <ToolRow label="Preset">
        <label className="w-full"><span className="sr-only">Transition preset</span><ToolSelect value={effect.preset} onChange={setPreset} options={PRESET_OPTIONS} /></label>
      </ToolRow>

      {effect.preset === 'vhs' ? <>
        <VhsControls config={effect.vhs ?? DEFAULT_VHS} onChange={vhs => onChange({ ...effect, vhs })} />
        <p className="text-[11px] text-[var(--text-secondary)]">Navigate between pages in Preview to play this transition.</p>
      </> : effect.preset === 'ripple-water' ? <div className="flex flex-col gap-2" data-ripple-controls>
        {([
          ['amplitude', 'Amplitude', 0, 3, .05], ['speed', 'Speed', .1, 3, .05],
          ['wavelength', 'Wavelength (px)', 10, 300, 1], ['rings', 'Rings', 1, 8, 1],
          ['decay', 'Decay', .1, 4, .05], ['refraction', 'Refraction (px)', 0, 200, 1],
          ['dispersion', 'Dispersion', 0, 1, .05], ['shine', 'Shine', 0, 2, .05],
        ] as const).map(([key, label, min, max, step]) =>
          <ToolRow key={key} label={label}><label className="w-full"><span className="sr-only">{label}</span><ToolInput value={String((effect.ripple ?? DEFAULT_RIPPLE)[key])} min={min} max={max} step={step} onChange={value => {
            if (value.trim() === '') return;
            const number = Number(value); if (!Number.isFinite(number)) return;
            const config = normalizeRipple({ ...(effect.ripple ?? DEFAULT_RIPPLE), [key]: number });
            if (config) onChange({ ...effect, ripple: config });
          }} /></label></ToolRow>)}
        <p className="text-[11px] text-[var(--text-secondary)]">Navigate between pages in Preview to play this transition.</p>
      </div> : effect.preset === 'glitch' ? <div className="flex flex-col gap-2" data-glitch-controls>
        {([
          ['duration', 'Duration (s)', 0.05, 4, 0.05], ['intensity', 'Intensity', 0, 2, 0.05],
          ['slices', 'Slices', 3, 100, 1], ['shift', 'Shift (px)', 0, 200, 1],
          ['rgbShift', 'RGB shift (px)', 0, 40, 0.5], ['blocks', 'Blocks', 0, 1, 0.05], ['noise', 'Noise', 0, 1, 0.05],
        ] as const).map(([key, label, min, max, step]) =>
          <ToolRow key={key} label={label}><label className="w-full"><span className="sr-only">{label}</span><ToolInput value={String((effect.glitch ?? DEFAULT_GLITCH)[key])} min={min} max={max} step={step} onChange={value => {
            if (value.trim() === '') return;
            const number = Number(value); if (!Number.isFinite(number)) return;
            const config = normalizeGlitch({ ...(effect.glitch ?? DEFAULT_GLITCH), [key]: number });
            if (config) onChange({ ...effect, glitch: config });
          }} /></label></ToolRow>)}
        <p className="text-[11px] text-[var(--text-secondary)]">Navigate between pages in Preview to play this transition.</p>
      </div> : effect.preset === 'displacement' ? <div className="flex flex-col gap-2" data-displacement-controls>
        {([['duration', 'Duration (s)'], ['strength', 'Strength'], ['seed', 'Seed'], ['columns', 'Grid columns']] as const).map(([key,label]) =>
          <ToolRow key={key} label={label}><label className="w-full"><span className="sr-only">{label}</span><ToolInput value={String((effect.displacement ?? DEFAULT_DISPLACEMENT)[key])} step={key === 'duration' ? .1 : key === 'strength' ? .01 : 1} min={key === 'duration' ? .1 : key === 'columns' ? 2 : 0} max={key === 'duration' ? 4 : key === 'strength' ? .15 : key === 'columns' ? 64 : 65535} onChange={value => {
            const number = Number(value);if (!Number.isFinite(number)) return;
            const config = normalizeDisplacement({ ...(effect.displacement ?? DEFAULT_DISPLACEMENT), [key]: number });
            if (config) onChange({ ...effect, displacement: config });
          }} /></label></ToolRow>)}
        <p className="text-[11px] text-[var(--text-secondary)]">Navigate between pages in Preview to play this transition. Reduced motion uses normal navigation.</p>
      </div> : <>
      <ToolRow label="This Page">
        {effect.exit ? (
          <ControlActionRow className="!pr-2" onClick={() => openSide('exit')}>
            <Diamond />
            <span className="truncate flex-1">Exit</span>
            <RemoveButton onClick={() => setSide('exit', undefined)} />
          </ControlActionRow>
        ) : (
          <ControlActionRow className="!pr-2" onClick={() => { setSide('exit', createDefaultSide()); openSide('exit'); }}>
            <span className="flex-1 text-left text-[var(--text-secondary)]">Add Exit…</span>
          </ControlActionRow>
        )}
      </ToolRow>

      <ToolRow label={enterLabel}>
        {effect.enter ? (
          <ControlActionRow className="!pr-2" onClick={() => openSide('enter')}>
            <Diamond />
            <span className="truncate flex-1">Enter</span>
            <RemoveButton onClick={() => setSide('enter', undefined)} />
          </ControlActionRow>
        ) : (
          <ControlActionRow className="!pr-2" onClick={() => { setSide('enter', createDefaultSide()); openSide('enter'); }}>
            <span className="flex-1 text-left text-[var(--text-secondary)]">Add Enter…</span>
          </ControlActionRow>
        )}
      </ToolRow>
      </>}
    </div>
  );
}
