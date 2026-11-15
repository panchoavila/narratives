import { toast } from 'sonner';
import { DEFAULT_GLITCH, normalizeGlitch, type GlitchConfig } from '../../../../../packages/revyme-runtime-scene/src/glitch-config';
import { DEFAULT_GLYPH_RAIN, normalizeGlyphRain } from '../../../../../packages/revyme-runtime-scene/src/glyph-rain';
import { DEFAULT_RIPPLE, normalizeRipple, type RippleConfig } from '../../../../../packages/revyme-runtime-scene/src/ripple-config';
import { DEFAULT_PARTICLE, normalizeParticle } from '../../../../../packages/revyme-runtime-scene/src/particle-config';
import { DEFAULT_VHS } from '../../../../../packages/revyme-runtime-scene/src/vhs-config';
import { VhsControls } from './VhsControls';
import { ensureGlitchElementRuntime } from '@/code/project/glitch-ops';
import { ControlLabel, ToolSelect, ToolInput } from '../../../controls';
import { SliderRow } from '../shared';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';
import {
  CANVAS_EFFECT_OPTIONS,
  type CanvasEffectConfig,
  type CanvasEffectPreset,
} from '@/shared/canvas-effects';

export function CanvasEffectPopup({
  nodeId,
  config,
  isParticleTarget = false,
}: {
  nodeId: string;
  config: CanvasEffectConfig;
  isParticleTarget?: boolean;
}) {
  const update = (patch: Partial<CanvasEffectConfig>) => {
    const next: CanvasEffectConfig = { ...config, ...patch };
    if (!ensureGlitchElementRuntime()) {
      toast.error('This effect needs a root layout with a body element.');
      return;
    }
    expediteStableAtomSync();
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: {
        'data-canvas-effect': next.preset,
        'data-canvas-duration': String(next.duration),
        'data-canvas-delay': String(next.delay),
        ...(next.intensity !== undefined ? { 'data-canvas-intensity': String(next.intensity) } : {}),
        ...(next.preset === 'glitch' ? Object.fromEntries(
          Object.entries(next.glitch ?? DEFAULT_GLITCH).filter(([key]) => key !== 'version')
            .map(([key, value]) => [`data-glitch-${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, String(value)]),
        ) : {}),
        ...(next.preset === 'glyph-rain' ? { 'data-glyph-rain': JSON.stringify(next.glyphRain ?? DEFAULT_GLYPH_RAIN).replace(/[&'<]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) } : {}),
        ...(next.preset === 'ripple-water' ? { 'data-ripple': JSON.stringify(next.ripple ?? DEFAULT_RIPPLE) } : {}),
        ...(next.preset === 'particle-object' ? { 'data-particle-object': JSON.stringify(next.particle ?? DEFAULT_PARTICLE) } : {}),
        ...(next.preset === 'vhs' ? { 'data-vhs': JSON.stringify(next.vhs ?? DEFAULT_VHS) } : {}),
      },
    });
    flushNow();
  };

  return (
    <div className="flex flex-col gap-2" data-testid="canvas-effect-popup">
      {/* Preset */}
      <div className="flex items-center justify-between w-full">
        <ControlLabel label="Preset" property="" plain />
        <div className="flex items-center gap-2 w-full">
          <ToolSelect
            value={config.preset}
            onChange={(v) => {
              const preset = v as CanvasEffectPreset;
              const opt = CANVAS_EFFECT_OPTIONS.find((o) => o.value === preset);
              update({
                preset,
                duration: opt?.defaultDuration ?? config.duration,
                ...(preset === 'glitch' ? { glitch: { ...DEFAULT_GLITCH } } : {}),
                ...(preset === 'glyph-rain' ? { glyphRain: { ...DEFAULT_GLYPH_RAIN } } : {}),
                ...(preset === 'ripple-water' ? { ripple: { ...DEFAULT_RIPPLE } } : {}),
                ...(preset === 'particle-object' ? { particle: { ...DEFAULT_PARTICLE } } : {}),
                ...(preset === 'vhs' ? { vhs: { ...DEFAULT_VHS } } : {}),
              });
            }}
            options={CANVAS_EFFECT_OPTIONS.filter(o => o.value !== 'particle-object' || isParticleTarget).map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
        </div>
      </div>

      {config.preset === 'vhs' ? (
        <VhsControls showTrigger config={config.vhs ?? DEFAULT_VHS} onChange={vhs => update({ vhs, duration: vhs.duration })} />
      ) : config.preset === 'particle-object' ? (
        <>
          {([
            ['count', 'Particles', 100, 20000, 100, ''],
            ['size', 'Size', .5, 10, .1, 'px'],
            ['sizeVariance', 'Size variation', 0, 1, .05, ''],
            ['radius', 'Cursor radius', 10, 500, 5, 'px'],
            ['strength', 'Strength', 0, 3, .05, ''],
            ['swirl', 'Swirl', 0, 2, .05, ''],
            ['spring', 'Return speed', .1, 4, .05, ''],
            ['drift', 'Drift', 0, 2, .05, ''],
          ] as const).map(([key, label, min, max, step, suffix]) => (
            <SliderRow key={key} label={label} value={(config.particle ?? DEFAULT_PARTICLE)[key]} min={min} max={max} step={step} suffix={suffix}
              onChange={value => { const particle = normalizeParticle({ ...(config.particle ?? DEFAULT_PARTICLE), [key]: value }); if (particle) update({ particle }); }} />
          ))}
        </>
      ) : config.preset === 'ripple-water' ? (
        <>
          <div className="flex items-center justify-between w-full">
            <ControlLabel label="Trigger" property="" plain />
            <div className="w-full"><ToolSelect value={(config.ripple ?? DEFAULT_RIPPLE).trigger}
              options={[{value:'click',label:'Click'},{value:'hover',label:'Hover'},{value:'none',label:'Ambient'}]}
              onChange={value => update({ ripple: { ...(config.ripple ?? DEFAULT_RIPPLE), trigger: value as RippleConfig['trigger'], ...(value === 'none' && !(config.ripple ?? DEFAULT_RIPPLE).interval ? { interval: 3 } : {}) } })} /></div>
          </div>
          {([
            ['amplitude', 'Amplitude', 0, 3, .05, ''],
            ['speed', 'Speed', .1, 3, .05, ''],
            ['wavelength', 'Wavelength', 10, 300, 1, 'px'],
            ['rings', 'Rings', 1, 8, 1, ''],
            ['decay', 'Decay', .1, 4, .05, ''],
            ['refraction', 'Refraction', 0, 200, 1, 'px'],
            ['dispersion', 'Dispersion', 0, 1, .05, ''],
            ['shine', 'Shine', 0, 2, .05, ''],
            ['interval', 'Interval', 0, 30, .1, 's'],
          ] as const).map(([key, label, min, max, step, suffix]) => (
            <SliderRow key={key} label={label} value={(config.ripple ?? DEFAULT_RIPPLE)[key]} min={min} max={max} step={step} suffix={suffix}
              onChange={value => { const ripple = normalizeRipple({ ...(config.ripple ?? DEFAULT_RIPPLE), [key]: value }); if (ripple) update({ ripple }); }} />
          ))}
        </>
      ) : config.preset === 'glyph-rain' ? (
        <>
          {([['color', 'Color'], ['headColor', 'Head color'], ['charset', 'Characters']] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between w-full">
              <ControlLabel label={label} property="" plain />
              <div className="w-full"><ToolInput text value={(config.glyphRain ?? DEFAULT_GLYPH_RAIN)[key]} onChange={value => {
                const glyphRain = normalizeGlyphRain({ ...(config.glyphRain ?? DEFAULT_GLYPH_RAIN), [key]: value });
                if (glyphRain) update({ glyphRain });
              }} /></div>
            </div>
          ))}
          {([
            ['cell', 'Glyph size', 8, 64, 1, 'px'],
            ['speed', 'Speed', .05, 3, .05, ''],
            ['density', 'Density', 0, 1, .05, ''],
            ['trail', 'Trail', .2, 3, .05, ''],
            ['glow', 'Glow', 0, 3, .05, ''],
            ['dim', 'Dim', 0, 1, .05, ''],
            ['light', 'Light', 0, 3, .05, ''],
            ['lightRadius', 'Light radius', 20, 600, 5, 'px'],
            ['stir', 'Cursor stir', 0, 1, .05, ''],
          ] as const).map(([key, label, min, max, step, suffix]) => (
            <SliderRow key={key} label={label} value={(config.glyphRain ?? DEFAULT_GLYPH_RAIN)[key]} min={min} max={max} step={step} suffix={suffix}
              onChange={(value) => {
                const glyphRain = normalizeGlyphRain({ ...(config.glyphRain ?? DEFAULT_GLYPH_RAIN), [key]: value });
                if (glyphRain) update({ glyphRain });
              }} />
          ))}
        </>
      ) : (
        <>
          {([
            ['intensity', 'Intensity', 0, 2, 0.05, ''],
            ['interval', 'Interval', 0, 30, 0.1, 's'],
            ['duration', 'Duration', 0.05, 4, 0.05, 's'],
            ['slices', 'Slices', 3, 100, 1, ''],
            ['shift', 'Shift', 0, 200, 1, 'px'],
            ['rgbShift', 'RGB Shift', 0, 40, 0.5, 'px'],
            ['blocks', 'Blocks', 0, 1, 0.05, ''],
            ['noise', 'Noise', 0, 1, 0.05, ''],
          ] as const).map(([key, label, min, max, step, suffix]) => (
            <SliderRow key={key} label={label} value={(config.glitch ?? DEFAULT_GLITCH)[key]} min={min} max={max} step={step} suffix={suffix}
              onChange={(value) => {
                const glitch = normalizeGlitch({ ...(config.glitch ?? DEFAULT_GLITCH), [key]: value }) as GlitchConfig;
                update({ glitch, ...(key === 'duration' ? { duration: glitch.duration } : {}) });
              }} />
          ))}
        </>
      )}
    </div>
  );
}
