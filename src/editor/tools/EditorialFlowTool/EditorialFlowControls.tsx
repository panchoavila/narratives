import { useEffect, useState } from 'react';
import { ToolInput, ToolRow, ToolSelect, ToolSlider } from '../../controls';
import { FLOW_OBJECT_ROLES, type FlowAttributeProblem, type FlowObjectSettings } from '../../../../packages/revyme-runtime-scene/src/editorial/flow-attr';
import type { ObjectHeight, ObjectRole, Placement } from '../../../../packages/revyme-runtime-scene/src/editorial/types';

export const flowRoleLabel = (role: ObjectRole) => role.charAt(0).toUpperCase() + role.slice(1);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Snaps to the control's step so slider drags do not write 0.30000000000000004. */
const snap = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(4));

const COLUMN_OPTIONS = [
  { value: 'anchor', label: 'Where it falls' },
  ...[0, 1, 2, 3, 4, 5].map(index => ({ value: String(index), label: String(index + 1) })),
  { value: '-1', label: 'Last' },
  { value: '-2', label: 'Second to last' },
];
const SPAN_OPTIONS = [
  ...[1, 2, 3, 4, 5, 6].map(span => ({ value: String(span), label: String(span) })),
  { value: 'all', label: 'All columns' },
];
const VERTICAL_OPTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'anchor', label: 'Where it falls' },
];
const INSET_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'start', label: 'Start' },
  { value: 'end', label: 'End' },
];
const CUSTOM_PLACE: Placement = { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 };

/** A settings copy without one optional key: the role's rule applies again. */
function without(settings: FlowObjectSettings, key: 'place' | 'height' | 'maxHeight'): FlowObjectSettings {
  const next = { ...settings };
  delete next[key];
  return next;
}

/** A number field with a text input and, when asked, a slider. Drafts stay local until a commit. */
function NumberField({ label, value, min, max, step, slider = false, onChange }: {
  label: string; value: number; min: number; max: number; step: number; slider?: boolean; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (next: number) => {
    const clean = snap(clamp(Number.isFinite(next) ? next : min, min, max), step);
    setDraft(clean);
    onChange(clean);
  };
  return <ToolRow label={label}>
    {slider && <ToolSlider value={draft} min={min} max={max} step={step} onChange={setDraft} onCommit={commit} />}
    <ToolInput value={String(draft)} step={step} min={min} max={max}
      onChange={value => commit(Number(value))} onChangeLive={value => setDraft(Number(value))}
      onCommit={value => commit(Number(value))} />
  </ToolRow>;
}

/** Controls for one element's `data-flow` settings. Every change is reported whole to `onChange`. */
export default function EditorialFlowControls({ settings, problems, onChange }: {
  settings: FlowObjectSettings; problems: FlowAttributeProblem[]; onChange: (next: FlowObjectSettings) => void;
}) {
  const place = settings.place;
  const height = settings.height;
  const inset = place?.inset;
  const setPlace = (next: Placement) => onChange({ ...settings, place: next });
  const setInset = (side: 'none' | 'start' | 'end', fraction: number) => {
    if (!place) return;
    const next: Placement = { ...place };
    delete next.inset;
    if (side !== 'none') next.inset = { side, fraction };
    setPlace(next);
  };
  const setHeight = (kind: string) => {
    if (kind === 'role') return onChange(without(settings, 'height'));
    const next: ObjectHeight = kind === 'aspect' ? { kind: 'aspect', ratio: 1.5 }
      : kind === 'lines' ? { kind: 'lines', lines: 8 }
        : kind === 'text' ? { kind: 'text' }
          : { kind: 'fill' };
    onChange({ ...settings, height: next });
  };
  const heightOptions = [
    { value: 'role', label: 'Role default' },
    { value: 'aspect', label: 'Aspect' },
    { value: 'lines', label: 'Lines' },
    { value: 'fill', label: 'Fill' },
    ...(height?.kind === 'text' ? [{ value: 'text', label: 'Fit text' }] : []),
  ];

  return <div data-editorial-flow-controls className="flex flex-col gap-2">
    {problems.length > 0 && <ul data-editorial-flow-problems className="flex flex-col gap-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
      {problems.map(problem => <li key={`${problem.path}:${problem.message}`}>
        {problem.path ? `${problem.path}: ` : ''}{problem.message}
      </li>)}
    </ul>}
    <ToolRow label="Role">
      <ToolSelect value={settings.role}
        options={FLOW_OBJECT_ROLES.map(role => ({ value: role, label: flowRoleLabel(role) }))}
        onChange={role => onChange({ ...settings, role: role as ObjectRole })} />
    </ToolRow>
    <NumberField label="After paragraph" value={settings.after} min={0} max={Infinity} step={1}
      onChange={after => onChange({ ...settings, after })} />
    <p className="text-[11px] leading-snug text-[var(--text-secondary)]">0 opens the piece.</p>
    <ToolRow label="Placement">
      <ToolSelect value={place ? 'custom' : 'role'}
        options={[{ value: 'role', label: 'Role default' }, { value: 'custom', label: 'Custom' }]}
        onChange={value => value === 'custom' ? onChange({ ...settings, place: { ...CUSTOM_PLACE } }) : onChange(without(settings, 'place'))} />
    </ToolRow>
    {place && <>
      <ToolRow label="Column">
        <ToolSelect value={String(place.column)} options={COLUMN_OPTIONS}
          onChange={value => setPlace({ ...place, column: value === 'anchor' ? 'anchor' : Number(value) })} />
      </ToolRow>
      <ToolRow label="Span">
        <ToolSelect value={String(place.span)} options={SPAN_OPTIONS}
          onChange={value => setPlace({ ...place, span: value === 'all' ? 'all' : Number(value) })} />
      </ToolRow>
      <ToolRow label="Vertical">
        <ToolSelect value={place.vertical} options={VERTICAL_OPTIONS}
          onChange={value => setPlace({ ...place, vertical: value as Placement['vertical'] })} />
      </ToolRow>
      <ToolRow label="Inset">
        <ToolSelect value={inset?.side ?? 'none'} options={INSET_OPTIONS}
          onChange={value => setInset(value as 'none' | 'start' | 'end', inset?.fraction ?? 0.5)} />
      </ToolRow>
      {inset && <NumberField label="Inset width" value={inset.fraction} min={0.2} max={1} step={0.05} slider
        onChange={fraction => setInset(inset.side, fraction)} />}
      <NumberField label="Clearance" value={place.clearance} min={0} max={6} step={0.5} slider
        onChange={clearance => setPlace({ ...place, clearance })} />
    </>}
    <ToolRow label="Height">
      <ToolSelect value={height?.kind ?? 'role'} options={heightOptions} onChange={setHeight} />
    </ToolRow>
    {height?.kind === 'aspect' && <NumberField label="Ratio" value={height.ratio} min={0.2} max={5} step={0.05}
      onChange={ratio => onChange({ ...settings, height: { kind: 'aspect', ratio } })} />}
    {height?.kind === 'lines' && <NumberField label="Lines" value={height.lines} min={1} max={60} step={1}
      onChange={lines => onChange({ ...settings, height: { kind: 'lines', lines } })} />}
    <ToolRow label="Max height">
      <ToolSelect value={settings.maxHeight === undefined ? 'role' : 'custom'}
        options={[{ value: 'role', label: 'Role default' }, { value: 'custom', label: 'Custom' }]}
        onChange={value => value === 'custom' ? onChange({ ...settings, maxHeight: 1 }) : onChange(without(settings, 'maxHeight'))} />
    </ToolRow>
    {settings.maxHeight !== undefined && <NumberField label="Fraction" value={settings.maxHeight} min={0.05} max={1} step={0.05} slider
      onChange={maxHeight => onChange({ ...settings, maxHeight })} />}
  </div>;
}
