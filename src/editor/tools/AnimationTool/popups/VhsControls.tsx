import { VHS_CONTROLS, normalizeVhs, type VhsConfig } from '../../../../../packages/revyme-runtime-scene/src/vhs-config';
import { ToolRow, ToolSelect } from '../../../controls';
import { SliderRow } from '../shared';

export function VhsControls({ config, onChange, showTrigger }: {
  config: VhsConfig;
  onChange: (config: VhsConfig) => void;
  showTrigger?: boolean;
}) {
  return <div className="flex flex-col gap-2" data-vhs-controls>
    {showTrigger && <ToolRow label="Trigger">
      <ToolSelect
        value={config.trigger}
        options={[{ value: 'click', label: 'Click' }, { value: 'hover', label: 'Hover' }]}
        onChange={trigger => onChange({ ...config, trigger: trigger === 'hover' ? 'hover' : 'click' })}
      />
    </ToolRow>}
    {VHS_CONTROLS.map(([key, label, min, max, step, suffix]) => <SliderRow
      key={key}
      label={label}
      value={config[key]}
      min={min}
      max={max}
      step={step}
      suffix={suffix}
      onChange={value => onChange(normalizeVhs({ ...config, [key]: value })!)}
    />)}
  </div>;
}
