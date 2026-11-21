import { findComponentControl, parseComponentControlsMeta, type ComponentControlDef } from './controls-parser';
import { coerceScalar } from '../values/value-eval';

const schemas = new Map<string, Record<string, ComponentControlDef> | undefined>();
/** Source-keyed so editing controls cannot retain stale prop types. Bound the cache for long sessions. */
export function componentPropControls(source: string): Record<string, ComponentControlDef> | undefined {
  if (schemas.has(source)) return schemas.get(source);
  const controls = parseComponentControlsMeta(source)?.controls;
  if (schemas.size >= 64) schemas.delete(schemas.keys().next().value!);
  schemas.set(source, controls);
  return controls;
}

/** Text controls can legitimately contain "2", "false" or a leading-zero ID. */
export function coerceComponentProp(value: unknown, name: string, controls?: Record<string, ComponentControlDef>): unknown {
  const type = findComponentControl(controls, name)?.type;
  if (type && ['text', 'select', 'font', 'color', 'upload', 'imageList', 'transition', 'objectList', 'slot'].includes(type)) return value;
  return coerceScalar(value);
}

export function coerceComponentProps(raw: Record<string, unknown>, source: string): Record<string, unknown> {
  const controls = componentPropControls(source);
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, coerceComponentProp(value, name, controls)]));
}
