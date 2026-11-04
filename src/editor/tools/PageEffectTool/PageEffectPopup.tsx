// PageEffectPopup.tsx — the Page Effect editor (ToolPopup root panel): Target,
// Preset, This Page (Exit) + Next/Any Page (Enter) rows. Each side opens a
// SideEditor sub-panel. See plan §6.2.

import { DEFAULT_DISPLACEMENT, normalizeDisplacement } from '@/shared/displacement-config';
import { ToolInput } from '../../controls';
import { ToolRow, ToolSelect, ControlActionRow, RemoveButton } from '../../controls';
import { useToolPopup } from '../../ui/ToolPopup';
import SideEditor from './SideEditor';
import { PRESET_OPTIONS, applyPreset } from '@/code/generation/view-transition-css';
import { createDefaultSide, type PageEffect, type SideConfig } from '@/code/project/page-effects-config';

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

  const setPreset = (preset: string) => {
    if (preset === 'displacement') { onChange({ target: effect.target, preset, displacement: { ...DEFAULT_DISPLACEMENT } });return; }
    if (preset === 'custom') { onChange({ ...effect, preset, displacement: undefined }); return; }
    const sides = applyPreset(preset);
    const nextEffect: PageEffect = { ...effect, preset, displacement: undefined, exit: sides.exit, enter: sides.enter };
    onChange(nextEffect);
  };

  // Editing any side flips the preset to 'custom' (design-tool parity).
  const setSide = (which: 'exit' | 'enter', side: SideConfig | undefined) => {
    const nextEffect: PageEffect = { ...effect, preset: 'custom', [which]: side };
    onChange(nextEffect);
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
        <ToolSelect value={effect.target} onChange={(v) => onChange({ ...effect, target: v })} options={targetOptions} />
      </ToolRow>
      <ToolRow label="Preset">
        <ToolSelect value={effect.preset} onChange={setPreset} options={PRESET_OPTIONS} />
      </ToolRow>

      {effect.preset === 'displacement' ? <div className="flex flex-col gap-2" data-displacement-controls>
        {([['duration', 'Duration (s)'], ['strength', 'Strength'], ['seed', 'Seed'], ['columns', 'Grid columns']] as const).map(([key,label]) =>
          <ToolRow key={key} label={label}><ToolInput value={String((effect.displacement ?? DEFAULT_DISPLACEMENT)[key])} step={key === 'duration' ? .1 : key === 'strength' ? .01 : 1} min={key === 'duration' ? .1 : key === 'columns' ? 2 : 0} max={key === 'duration' ? 4 : key === 'strength' ? .15 : key === 'columns' ? 64 : 65535} onChange={value => {
            const number = Number(value);if (!Number.isFinite(number)) return;
            const config = normalizeDisplacement({ ...(effect.displacement ?? DEFAULT_DISPLACEMENT), [key]: number });
            if (config) onChange({ ...effect, displacement: config });
          }} /></ToolRow>)}
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
