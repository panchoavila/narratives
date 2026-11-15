import { useEffect, useState } from 'react';
import { ToolInput, ToolRow, ToolSelect, ToolSlider, ColorSwatch } from '../../controls';
import { DEFAULT_LIQUID_GLASS, LIQUID_GLASS_CONTROLS, LIQUID_GLASS_PRESETS, normalizeLiquidGlass, type LiquidGlassConfig } from '../../../../packages/revyme-runtime-scene/src/liquid-glass-config';

function NumberControl({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (next: number) => { setDraft(next); onChange(next); };
  return <ToolRow label={label}>
    <ToolSlider value={draft} min={min} max={max} step={step} onChange={setDraft} onCommit={commit} />
    <ToolInput value={String(draft)} step={step} chevronLabel={suffix}
      onChange={value => commit(Number(value))} onChangeLive={value => setDraft(Number(value))}
      onCommit={value => commit(Number(value))} />
  </ToolRow>;
}

export default function LiquidGlassControls({ config, onChange, audioSources }: {
  config: LiquidGlassConfig; onChange: (config: LiquidGlassConfig) => void; audioSources: { value: string; label: string }[];
}) {
  const update = (patch: Partial<LiquidGlassConfig>) => onChange(normalizeLiquidGlass({ ...config, ...patch })!);
  const preset = LIQUID_GLASS_PRESETS.find(item => JSON.stringify({ ...DEFAULT_LIQUID_GLASS, ...item.settings }) === JSON.stringify(config));
  const toggle = (key: 'shadow' | 'specular' | 'tilt' | 'draggable' | 'audioReactive', label: string) => <ToolRow label={label} key={key}>
    <ToolSelect value={config[key] ? 'on' : 'off'} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
      onChange={value => update({ [key]: value === 'on' })} />
  </ToolRow>;
  return <div data-liquid-glass-controls className="flex flex-col gap-2">
    <ToolRow label="Preset">
      <ToolSelect value={preset?.value ?? 'custom'}
        options={[...LIQUID_GLASS_PRESETS.map(({ value, label }) => ({ value, label })), { value: 'custom', label: 'Custom' }]}
        onChange={value => { const item = LIQUID_GLASS_PRESETS.find(item => item.value === value); if (item) onChange({ ...DEFAULT_LIQUID_GLASS, ...item.settings }); }} />
    </ToolRow>
    {LIQUID_GLASS_CONTROLS.map(([key, label, min, max, step, suffix]) => <NumberControl key={key}
      label={label} value={config[key]} min={min} max={max} step={step} suffix={suffix} onChange={value => update({ [key]: value })} />)}
    <ToolRow label="Tint">
      <ColorSwatch style={{ background: config.tint }} />
      <ToolInput text value={config.tint} onChange={tint => update({ tint })} />
    </ToolRow>
    {toggle('shadow', 'Shadow')}
    {toggle('specular', 'Highlights')}
    <ToolRow label="Reveal"><ToolSelect value={config.reveal}
      options={[{ value: 'none', label: 'None' }, { value: 'fade', label: 'Fade' }]}
      onChange={reveal => update({ reveal: reveal === 'fade' ? 'fade' : 'none' })} /></ToolRow>
    <ToolRow label="Interaction"><ToolSelect value={config.interaction}
      options={[{ value: 'none', label: 'None' }, { value: 'fluid', label: 'Fluid' }]}
      onChange={interaction => update({ interaction: interaction === 'fluid' ? 'fluid' : 'none' })} /></ToolRow>
    {config.interaction === 'fluid' && <>
      <NumberControl label="Strength" value={config.interactionStrength} min={0} max={5} step={0.05} onChange={interactionStrength => update({ interactionStrength })} />
      <NumberControl label="Radius" value={config.interactionRadius} min={0.01} max={5} step={0.05} onChange={interactionRadius => update({ interactionRadius })} />
      <NumberControl label="Viscosity" value={config.interactionViscosity} min={0} max={1} step={0.01} onChange={interactionViscosity => update({ interactionViscosity })} />
    </>}
    {toggle('tilt', 'Tilt')}
    {config.tilt && <>
      <NumberControl label="Angle" value={config.tiltFactor} min={0} max={25} step={1} suffix="°" onChange={tiltFactor => update({ tiltFactor })} />
      <NumberControl label="Settle" value={config.tiltEase} min={0} max={2000} step={25} suffix="ms" onChange={tiltEase => update({ tiltEase })} />
    </>}
    {toggle('draggable', 'Draggable')}
    {toggle('audioReactive', 'Audio reactive')}
    {config.audioReactive && <>
      <ToolRow label="Audio source"><ToolSelect value={config.audioSourceId}
        options={[{ value: '', label: 'First audio / video' }, ...audioSources]}
        onChange={audioSourceId => update({ audioSourceId })} /></ToolRow>
      <NumberControl label="Sensitivity" value={config.audioGain} min={0} max={5} step={0.1} onChange={audioGain => update({ audioGain })} />
    </>}
    <NumberControl label="Quality" value={config.resolution} min={0.25} max={2} step={0.25} suffix="×" onChange={resolution => update({ resolution })} />
  </div>;
}
