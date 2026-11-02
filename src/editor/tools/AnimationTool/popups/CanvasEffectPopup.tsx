// AnimationTool/popups/CanvasEffectPopup.tsx — Editor popup for progressive
// HTML-in-Canvas (`content="drawable"` + `drawElementImage`) stage effects
// with automatic CSS/DOM fallback.

import { ControlLabel, ToolSelect } from '../../../controls';
import { SliderRow } from '../shared';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';
import {
  CANVAS_EFFECT_OPTIONS,
  supportsHtmlInCanvas,
  type CanvasEffectConfig,
  type CanvasEffectPreset,
} from '@/shared/canvas-effects';

export function CanvasEffectPopup({
  nodeId,
  config,
}: {
  nodeId: string;
  config: CanvasEffectConfig;
}) {
  const htmlInCanvasSupported = supportsHtmlInCanvas();

  const update = (patch: Partial<CanvasEffectConfig>) => {
    const next: CanvasEffectConfig = { ...config, ...patch };
    expediteStableAtomSync();
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: {
        'data-canvas-effect': next.preset,
        'data-canvas-duration': String(next.duration),
        'data-canvas-delay': String(next.delay),
        ...(next.intensity !== undefined ? { 'data-canvas-intensity': String(next.intensity) } : {}),
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
              });
            }}
            options={CANVAS_EFFECT_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
        </div>
      </div>

      {/* Duration */}
      <SliderRow
        label="Duration"
        value={config.duration}
        min={0.1}
        max={3}
        step={0.05}
        suffix="s"
        onChange={(v) => update({ duration: Number(v.toFixed(2)) })}
      />

      {/* Delay */}
      <SliderRow
        label="Delay"
        value={config.delay}
        min={0}
        max={2}
        step={0.05}
        suffix="s"
        onChange={(v) => update({ delay: Number(v.toFixed(2)) })}
      />

      {/* Intensity */}
      <SliderRow
        label="Intensity"
        value={config.intensity ?? 75}
        min={10}
        max={100}
        step={5}
        suffix="%"
        onChange={(v) => update({ intensity: Math.round(v) })}
      />

      {/* Runtime capability status */}
      <div
        data-testid="canvas-effect-runtime-badge"
        className="mt-1 px-2.5 py-1.5 rounded bg-[var(--control-bg)] border border-[var(--border-light)] text-[10px] leading-snug text-[var(--text-secondary)] flex items-center justify-between gap-2"
      >
        <span>Engine</span>
        <span className="font-mono text-[var(--text-primary)]">
          {htmlInCanvasSupported ? 'HTML-in-Canvas (drawable)' : 'DOM/CSS Fallback (active)'}
        </span>
      </div>
    </div>
  );
}
