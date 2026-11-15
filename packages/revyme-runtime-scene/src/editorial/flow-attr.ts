// editorial/flow-attr.ts — the `data-flow` attribute: how a free-form element joins an editorial flow.
//
// An element connected to an Editorial Flow (a picture, an ad, a hand-designed frame) carries its
// settings as versioned JSON in `data-flow`, the way Liquid Glass keeps its own in
// `data-liquid-glass`. The flow reserves a box for it like for any picture, by its role's rule —
// or by a placement of its own, given here — and paints the element inside that box.
//
//   data-flow='{"v":1,"role":"media","after":3,"place":{"column":-1,"span":1,"vertical":"top","clearance":1}}'
//
// Reading never throws: an unusable value is dropped and reported, so a hand-edited attribute cannot
// break a page. The editor's panel writes it, the runtime reads it, the oracle reports what was
// dropped. Pure: no DOM.

import type { ObjectHeight, ObjectRole, Placement, RoleRule } from './types';

export const FLOW_ATTRIBUTE = 'data-flow';

export const FLOW_OBJECT_ROLES: readonly ObjectRole[] = [
  'media', 'hero', 'aside', 'quote', 'badge', 'kicker', 'headline', 'deck', 'byline', 'caption', 'signature', 'folio',
];

export interface FlowObjectSettings {
  v: 1;
  role: ObjectRole;
  /** Body paragraphs before the object. 0 places it among the objects that open the piece. */
  after: number;
  /** Where the object goes, instead of its role's placement. */
  place?: Placement;
  /** How tall it is, instead of its role's rule. */
  height?: ObjectHeight;
  /** Most of the frame height it may take, as a fraction. */
  maxHeight?: number;
  /** Width / height of the element. Without it, the element's own size or the rule decides. */
  aspect?: number;
}

export const DEFAULT_FLOW_OBJECT: FlowObjectSettings = { v: 1, role: 'media', after: 0 };

export interface FlowAttributeProblem {
  /** Where in the settings, e.g. `place.span`. Empty for the attribute as a whole. */
  path: string;
  message: string;
}

const KNOWN_KEYS = new Set(['v', 'role', 'after', 'place', 'height', 'maxHeight', 'aspect']);
const PLACE_KEYS = new Set(['column', 'span', 'vertical', 'inset', 'clearance']);
const VERTICALS = new Set(['top', 'middle', 'bottom', 'anchor']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function readPlace(raw: unknown, problems: FlowAttributeProblem[]): Placement | undefined {
  if (!isRecord(raw)) {
    problems.push({ path: 'place', message: 'must be an object' });
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!PLACE_KEYS.has(key)) problems.push({ path: `place.${key}`, message: 'unknown setting, ignored' });
  }
  let column: Placement['column'] = 'anchor';
  if (raw.column === 'anchor' || (finite(raw.column) && Number.isInteger(raw.column))) column = raw.column as Placement['column'];
  else if (raw.column !== undefined) problems.push({ path: 'place.column', message: 'must be a whole number or "anchor"' });
  let span: Placement['span'] = 1;
  if (raw.span === 'all' || (finite(raw.span) && Number.isInteger(raw.span) && raw.span >= 1)) span = raw.span as Placement['span'];
  else if (raw.span !== undefined) problems.push({ path: 'place.span', message: 'must be a whole number from 1, or "all"' });
  let vertical: Placement['vertical'] = 'anchor';
  if (typeof raw.vertical === 'string' && VERTICALS.has(raw.vertical)) vertical = raw.vertical as Placement['vertical'];
  else if (raw.vertical !== undefined) problems.push({ path: 'place.vertical', message: 'must be "top", "middle", "bottom" or "anchor"' });
  let clearance = 1;
  if (finite(raw.clearance) && raw.clearance >= 0) clearance = raw.clearance;
  else if (raw.clearance !== undefined) problems.push({ path: 'place.clearance', message: 'must be a number of lines from 0' });
  const place: Placement = { column, span, vertical, clearance };
  if (raw.inset !== undefined) {
    const inset = raw.inset;
    if (isRecord(inset) && (inset.side === 'start' || inset.side === 'end') && finite(inset.fraction)
      && inset.fraction > 0 && inset.fraction <= 1) {
      place.inset = { side: inset.side, fraction: inset.fraction };
    } else {
      problems.push({ path: 'place.inset', message: 'must be { side: "start" | "end", fraction: 0–1 }' });
    }
  }
  return place;
}

function readHeight(raw: unknown, problems: FlowAttributeProblem[]): ObjectHeight | undefined {
  if (!isRecord(raw)) {
    problems.push({ path: 'height', message: 'must be an object' });
    return undefined;
  }
  switch (raw.kind) {
    case 'text':
    case 'fill':
      return { kind: raw.kind };
    case 'aspect':
      if (finite(raw.ratio) && raw.ratio > 0) return { kind: 'aspect', ratio: raw.ratio };
      problems.push({ path: 'height.ratio', message: 'must be a number above 0' });
      return undefined;
    case 'lines':
      if (finite(raw.lines) && raw.lines >= 1) return { kind: 'lines', lines: raw.lines };
      problems.push({ path: 'height.lines', message: 'must be a number from 1' });
      return undefined;
    default:
      problems.push({ path: 'height.kind', message: 'must be "text", "aspect", "lines" or "fill"' });
      return undefined;
  }
}

/** The settings in `raw` (the attribute's string, or already-parsed JSON), and every problem found.
 *  Never throws; what cannot be used falls back to the defaults. */
export function readFlowAttribute(raw: unknown): { settings: FlowObjectSettings; problems: FlowAttributeProblem[] } {
  const problems: FlowAttributeProblem[] = [];
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { settings: { ...DEFAULT_FLOW_OBJECT }, problems };
    try {
      value = JSON.parse(raw);
    } catch {
      problems.push({ path: '', message: 'is not valid JSON' });
      return { settings: { ...DEFAULT_FLOW_OBJECT }, problems };
    }
  }
  if (raw === undefined || raw === null) return { settings: { ...DEFAULT_FLOW_OBJECT }, problems };
  if (!isRecord(value)) {
    problems.push({ path: '', message: 'must be a JSON object' });
    return { settings: { ...DEFAULT_FLOW_OBJECT }, problems };
  }
  if (value.v !== 1) problems.push({ path: 'v', message: 'must be 1' });
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) problems.push({ path: key, message: 'unknown setting, ignored' });
  }
  const settings: FlowObjectSettings = { ...DEFAULT_FLOW_OBJECT };
  if (typeof value.role === 'string' && (FLOW_OBJECT_ROLES as readonly string[]).includes(value.role)) {
    settings.role = value.role as ObjectRole;
  } else if (value.role !== undefined) {
    problems.push({ path: 'role', message: `must be one of ${FLOW_OBJECT_ROLES.join(', ')}` });
  }
  if (finite(value.after) && Number.isInteger(value.after) && value.after >= 0) settings.after = value.after;
  else if (value.after !== undefined) problems.push({ path: 'after', message: 'must be a whole number from 0' });
  if (value.place !== undefined) {
    const place = readPlace(value.place, problems);
    if (place) settings.place = place;
  }
  if (value.height !== undefined) {
    const height = readHeight(value.height, problems);
    if (height) settings.height = height;
  }
  if (value.maxHeight !== undefined) {
    if (finite(value.maxHeight) && value.maxHeight > 0 && value.maxHeight <= 1) settings.maxHeight = value.maxHeight;
    else problems.push({ path: 'maxHeight', message: 'must be a fraction above 0, at most 1' });
  }
  if (value.aspect !== undefined) {
    if (finite(value.aspect) && value.aspect > 0) settings.aspect = value.aspect;
    else problems.push({ path: 'aspect', message: 'must be a number above 0' });
  }
  return { settings, problems };
}

/** The attribute's value for `settings`: JSON with a stable key order and only what is set. */
export function writeFlowAttribute(settings: FlowObjectSettings): string {
  const out: Record<string, unknown> = { v: 1, role: settings.role, after: settings.after };
  if (settings.place) {
    const { column, span, vertical, clearance, inset } = settings.place;
    out.place = inset ? { column, span, vertical, clearance, inset: { side: inset.side, fraction: inset.fraction } } : { column, span, vertical, clearance };
  }
  if (settings.height) out.height = settings.height;
  if (settings.maxHeight !== undefined) out.maxHeight = settings.maxHeight;
  if (settings.aspect !== undefined) out.aspect = settings.aspect;
  return JSON.stringify(out);
}

/** The part of a role rule the settings replace. */
export function flowRuleOverride(settings: FlowObjectSettings): Partial<RoleRule> {
  const rule: Partial<RoleRule> = {};
  if (settings.place) rule.place = settings.place;
  if (settings.height) rule.height = settings.height;
  if (settings.maxHeight !== undefined) rule.maxHeight = settings.maxHeight;
  return rule;
}
