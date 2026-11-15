// page-flow-gen.ts — Page Flow: from a chosen breakpoint up, the page reads sideways.
//
// The page root becomes a horizontal flex row whose direct children are full-height
// panels, so the document scrolls on X. Everything is written into the PAGE FILE only:
//   - primary (inline) styles of the root and its direct children,
//   - @media band overrides for the non-primary viewports below the gate,
//   - a `/** @pageFlow {json} */` block holding the gate and the ORIGINAL values, so OFF
//     restores exactly what ON replaced (one undo step restores the file).
// A runtime controller elsewhere reads `--revyme-page-flow` from the root; this module
// only writes it.
//
// On the canvas a horizontal tile's pages overflow to its right, so ON also arranges the tiles:
// the ones that read across in a column, each as tall as the device it simulates, and the ones
// that read down below them, side by side. The page's own arrangement is saved and given back.

import type { JSXElement } from '@babel/types';
import { parseJSX, findFirstElementByDataId } from '../parsing/ast-utils';
import { parseCanvasConfig, updateCanvasConfigInCode } from '../project/canvas-config';
import { parseContainerRules } from '../stores/container-query-store';
import { getViewportWidths, syncViewportWidths } from '../stores/viewport-store';
import { extractStyleCSS } from '../parsing/parser';
import { updateNodeInCode } from './generator-crud';
import { updateContainerQueryStyle } from './generator-styles';
import { isPrimaryViewport } from '@/shared/constants';
import { toKebab } from '@/shared/css-utils';
import { renderWidth, type ViewportConfig } from '@/shared/types';
import { simulatedVpHeight } from '@/shared/responsive-units';
import { trace } from '@/shared/debug-trace';

export const PAGE_FLOW_PROPERTY = '--revyme-page-flow';

const PAGE_ROOT_ID = 'root';
// overflow / overflowX: a scaffolded page root clips sideways (page-root-shell), and a root clipped
// with the shorthand would turn `overflow-x: visible` into `auto` (a scroll container) — either cuts
// the panels off. The shorthand comes first so the longhand written after it wins.
const ROOT_PROPS = ['display', 'flexDirection', 'flexWrap', 'alignItems', 'overflow', 'overflowX', PAGE_FLOW_PROPERTY] as const;
const CHILD_PROPS = ['flexShrink', 'height'] as const;

const ROOT_HORIZONTAL: Record<string, string> = {
  display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'stretch', overflow: 'visible', overflowX: 'visible', [PAGE_FLOW_PROPERTY]: 'horizontal',
};
const CHILD_HORIZONTAL: Record<string, string> = { flexShrink: '0', height: '100svh' };

/** Neutral values used below the gate when the page had no original to restore from. */
const ROOT_VERTICAL_DEFAULT: Record<string, string> = {
  display: 'block', flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'normal', overflow: 'visible', overflowX: 'visible',
};
const CHILD_VERTICAL_DEFAULT: Record<string, string> = { flexShrink: '1', height: 'auto' };

export interface PageFlowGate {
  /** Lowest width (inclusive) at which this gate's band is horizontal. */
  from: number;
  viewportId: string;
  label: string;
}

export interface PageFlowState {
  from: number;
  saved: Record<string /* nodeId */, {
    inline: Record<string, string | null>;
    bands: Record<string /* maxWidth */, Record<string, string | null>>;
  }>;
  /** The page's tile arrangement (the `@canvas` positions) before ON. */
  positions?: Record<string /* viewportId */, { x: number; y: number }>;
  /** The tile arrangement ON wrote; OFF gives `positions` back only while the tiles are still here. */
  applied?: Record<string /* viewportId */, { x: number; y: number }>;
}

/** Props whose numeric literal has no unit; React writes every other numeric literal in px. */
const UNITLESS_PROPS = new Set(['flexShrink', 'flexGrow', 'order', 'opacity', 'zIndex', 'lineHeight', 'fontWeight']);

/** A numeric style literal as the CSS value it stands for: `600` is `600px` for a length, `1` stays `1`. */
function numberAsCss(prop: string, n: number): string {
  return UNITLESS_PROPS.has(prop) ? String(n) : `${n}px`;
}

/** Space between stacked tiles (vertical) and between tiles side by side (the canvas's own gap). */
const TILE_GAP_Y = 240;
const TILE_GAP_X = 160;

const PAGE_FLOW_BLOCK = /\/\*\*\s*@pageFlow\s*(\{[\s\S]*?\})\s*\*\/[ \t]*\n?/;

function canvasViewports(code: string): ViewportConfig[] {
  return parseCanvasConfig(code)?.viewports ?? [];
}

/** Lower edge of a viewport's band: one px above the next smaller viewport; 0 for the smallest. */
function bandLowerEdge(vp: ViewportConfig, viewports: ViewportConfig[]): number {
  let lower = 0;
  for (const other of viewports) {
    if (other.width < vp.width && other.width + 1 > lower) lower = other.width + 1;
  }
  return lower;
}

/** Gates the panel offers, widest first. Empty when the page has no @canvas block. */
export function pageFlowGates(code: string): PageFlowGate[] {
  const viewports = canvasViewports(code);
  if (!viewports.length) return [];
  const widest = [...viewports].sort((a, b) => b.width - a.width);
  const smallest = widest[widest.length - 1];
  return widest.map((vp, i) => {
    let label: string;
    if (i === 0) label = vp.label;
    else if (vp === smallest) label = 'Every width';
    else label = `${vp.label} and up`;
    return { from: bandLowerEdge(vp, viewports), viewportId: vp.id, label };
  });
}

function isValueMap(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v as Record<string, unknown>).every((x) => x === null || typeof x === 'string');
}

function isPageFlowState(v: any): v is PageFlowState {
  if (!v || typeof v !== 'object') return false;
  if (typeof v.from !== 'number' || !Number.isFinite(v.from)) return false;
  if (!v.saved || typeof v.saved !== 'object' || Array.isArray(v.saved)) return false;
  for (const entry of Object.values(v.saved) as any[]) {
    if (!entry || !isValueMap(entry.inline)) return false;
    if (!entry.bands || typeof entry.bands !== 'object' || Array.isArray(entry.bands)) return false;
    for (const band of Object.values(entry.bands)) if (!isValueMap(band)) return false;
  }
  return isPositions(v.positions) && isPositions(v.applied);
}

function isPositions(v: any): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return (Object.values(v) as any[]).every((pos) => !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
}

/** The tiles that read across (the primary and every band at or above the gate) in a column at
 *  the arrangement's top-left, each as tall as the device it simulates; the ones that read down
 *  below them, left to right. Returns the code and the arrangement it replaced. */
function arrangeTiles(code: string, from: number): { code: string; before?: PageFlowState['positions']; applied?: PageFlowState['applied'] } {
  const config = parseCanvasConfig(code);
  if (!config || config.viewports.length === 0) return { code };
  const viewports = [...config.viewports].sort((a, b) => b.width - a.width);
  const at = (vp: ViewportConfig) => config.positions[vp.id] ?? { x: vp.x ?? 0, y: vp.y ?? 0 };
  const left = Math.min(...viewports.map((vp) => at(vp).x));
  const top = Math.min(...viewports.map((vp) => at(vp).y));
  const across = viewports.filter((vp) => isPrimaryViewport(vp.id) || bandLowerEdge(vp, viewports) >= from);
  const down = viewports.filter((vp) => !across.includes(vp));
  const next: Record<string, { x: number; y: number }> = {};
  let y = top;
  for (const vp of across) {
    next[vp.id] = { x: left, y };
    y += Math.round(simulatedVpHeight(renderWidth(vp))) + TILE_GAP_Y;
  }
  let x = left;
  for (const vp of down) {
    next[vp.id] = { x, y };
    x += renderWidth(vp) + TILE_GAP_X;
  }
  trace.action('page-flow-gen:arrange-tiles', { across: across.map((vp) => vp.id), down: down.map((vp) => vp.id) });
  return { code: updateCanvasConfigInCode(code, { ...config, positions: next }), before: { ...config.positions }, applied: next };
}

/** The saved Page Flow state, or null when the block is absent or malformed. */
export function parsePageFlow(code: string): PageFlowState | null {
  const match = code.match(PAGE_FLOW_BLOCK);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!isPageFlowState(parsed)) {
      trace.error('page-flow-gen:parse-shape', { raw: match[1].slice(0, 120) });
      return null;
    }
    return parsed;
  } catch {
    trace.error('page-flow-gen:parse-failed', { raw: match[1].slice(0, 120) });
    return null;
  }
}

/** Insert the block after the top-of-file annotation blocks (@canvas, @cmsPage), keeping 'use client' first. */
function insertPageFlowBlock(code: string, block: string): string {
  let idx = 0;
  const useClient = /^(['"])use client\1;?[ \t]*\n/.exec(code);
  if (useClient) idx = useClient[0].length;
  for (;;) {
    const rest = code.slice(idx);
    const ws = /^\s*/.exec(rest)![0];
    const doc = /^\/\*\*\s*@\w+[\s\S]*?\*\/[ \t]*\n?/.exec(rest.slice(ws.length));
    if (!doc) break;
    idx += ws.length + doc[0].length;
  }
  return code.slice(0, idx) + block + code.slice(idx);
}

function removePageFlowBlock(code: string): string {
  return code.replace(PAGE_FLOW_BLOCK, '');
}

/** Run `fn` with the global breakpoint list set from this file's @canvas, then put the previous list back. */
function withViewportWidths<T>(code: string, fn: () => T): T {
  const previous = { ...getViewportWidths() };
  syncViewportWidths(Object.fromEntries(canvasViewports(code).map((v) => [v.id, v.width])));
  try {
    return fn();
  } finally {
    syncViewportWidths(previous);
  }
}

interface InlineRead {
  /** Literal values as written in the style object (camelCase keys). */
  values: Record<string, string>;
  /** Keys whose value is not a literal (identifier, expression) — cannot be saved and restored. */
  opaque: string[];
  /** The style object spreads another object — its contents cannot be read. */
  spread: boolean;
}

function readStyleLiterals(el: JSXElement): InlineRead {
  const out: InlineRead = { values: {}, opaque: [], spread: false };
  const attr = el.openingElement.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'style',
  );
  if (!attr || attr.type !== 'JSXAttribute') return out;
  const expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
  if (!expr || expr.type !== 'ObjectExpression') { out.spread = true; return out; }
  for (const prop of expr.properties) {
    if (prop.type !== 'ObjectProperty') { out.spread = true; continue; }
    const key = prop.key.type === 'Identifier' ? prop.key.name
      : prop.key.type === 'StringLiteral' ? prop.key.value : null;
    if (!key) { out.spread = true; continue; }
    const v = prop.value;
    if (v.type === 'StringLiteral') out.values[key] = v.value;
    else if (v.type === 'NumericLiteral') out.values[key] = numberAsCss(key, v.value);
    else if (v.type === 'UnaryExpression' && v.operator === '-' && v.argument.type === 'NumericLiteral') {
      out.values[key] = numberAsCss(key, -v.argument.value);
    } else if (v.type === 'TemplateLiteral' && v.expressions.length === 0) {
      out.values[key] = v.quasis[0].value.cooked ?? v.quasis[0].value.raw;
    } else out.opaque.push(key);
  }
  return out;
}

interface PageNodes {
  /** Root first, then every direct child that carries a string data-id. */
  ids: string[];
  styles: Map<string, InlineRead>;
}

/** Fixed or absolute, or hidden inline: not part of the page's flow, so never a panel. */
function isOutOfFlow(read: InlineRead): boolean {
  const pos = read.values.position;
  return pos === 'fixed' || pos === 'absolute' || read.values.display === 'none';
}

function readPageNodes(code: string): PageNodes | null {
  const ast = parseJSX(code);
  if (!ast) return null;
  const hit: { el: JSXElement | null } = { el: null };
  findFirstElementByDataId(ast, PAGE_ROOT_ID, (_path, el) => { hit.el = el; });
  const root = hit.el;
  if (!root) return null;

  const ids = [PAGE_ROOT_ID];
  const styles = new Map<string, InlineRead>([[PAGE_ROOT_ID, readStyleLiterals(root)]]);
  for (const child of root.children) {
    if (child.type !== 'JSXElement') continue;
    const idAttr = child.openingElement.attributes.find(
      (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'data-id',
    );
    if (!idAttr || idAttr.type !== 'JSXAttribute' || idAttr.value?.type !== 'StringLiteral') continue;
    const id = idAttr.value.value;
    const read = readStyleLiterals(child);
    if (isOutOfFlow(read)) {
      trace.action('page-flow-gen:out-of-flow-skipped', { nodeId: id });
      continue;
    }
    ids.push(id);
    styles.set(id, read);
  }
  return { ids, styles };
}

/** Inline style literals of the elements with these data-ids, read from one parse. */
function readStylesOf(code: string, ids: string[]): Map<string, InlineRead> {
  const out = new Map<string, InlineRead>();
  const ast = parseJSX(code);
  if (!ast) return out;
  for (const id of ids) {
    const hit: { el: JSXElement | null } = { el: null };
    findFirstElementByDataId(ast, id, (_path, el) => { hit.el = el; });
    const el = hit.el;
    if (el) out.set(id, readStyleLiterals(el));
  }
  return out;
}

function samePositions(
  a: Record<string, { x: number; y: number }>,
  b: Record<string, { x: number; y: number }>,
): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const pa = a[key];
    const pb = b[key];
    if (!pa || !pb || pa.x !== pb.x || pa.y !== pb.y) return false;
  }
  return true;
}

/** Band overrides of this page: Map<maxWidth, Map<nodeId, Map<kebab property, value>>>. */
function readBandValues(code: string) {
  return parseContainerRules(extractStyleCSS(code));
}

function propsOf(id: string): readonly string[] {
  return id === PAGE_ROOT_ID ? ROOT_PROPS : CHILD_PROPS;
}

function neutralOf(id: string): Record<string, string> {
  return id === PAGE_ROOT_ID ? ROOT_VERTICAL_DEFAULT : CHILD_VERTICAL_DEFAULT;
}

function horizontalOf(id: string): Record<string, string> {
  return id === PAGE_ROOT_ID ? ROOT_HORIZONTAL : CHILD_HORIZONTAL;
}

/** Refusals are decided by pageFlowRefusal before this runs, so the page root is the only thing left to check. */
function turnOn(code: string, from: number): string {
  const nodes = readPageNodes(code);
  if (!nodes) {
    trace.error('page-flow-gen:no-page-root', { root: PAGE_ROOT_ID });
    return code;
  }

  return withViewportWidths(code, () => {
    const viewports = canvasViewports(code);
    const bands = viewports.filter((v) => !isPrimaryViewport(v.id));
    const bandsNow = readBandValues(code);

    // Save the originals before anything is written, so a re-applied gate never saves Page Flow's values.
    const saved: PageFlowState['saved'] = {};
    for (const id of nodes.ids) {
      const read = nodes.styles.get(id)!;
      const inline: Record<string, string | null> = {};
      for (const p of propsOf(id)) inline[p] = read.values[p] ?? null;
      const bandMap: Record<string, Record<string, string | null>> = {};
      for (const vp of bands) {
        const props = bandsNow.get(vp.width)?.get(id);
        bandMap[String(vp.width)] = Object.fromEntries(
          propsOf(id).map((p) => [p, props?.get(toKebab(p)) ?? null]),
        );
      }
      saved[id] = { inline, bands: bandMap };
    }

    let out = code;
    for (const id of nodes.ids) out = updateNodeInCode(out, id, horizontalOf(id));

    for (const id of nodes.ids) {
      for (const vp of bands) {
        const lower = bandLowerEdge(vp, viewports);
        const styles: Record<string, string> = {};
        for (const p of propsOf(id)) {
          if (lower >= from) {
            styles[p] = '';
          } else if (p === PAGE_FLOW_PROPERTY) {
            styles[p] = 'vertical';
          } else {
            const original = saved[id].bands[String(vp.width)][p];
            styles[p] = original ?? saved[id].inline[p] ?? neutralOf(id)[p];
          }
        }
        out = updateContainerQueryStyle(out, id, vp.width, styles);
      }
    }

    const arranged = arrangeTiles(out, from);
    out = arranged.code;
    const state: PageFlowState = arranged.before && arranged.applied
      ? { from, saved, positions: arranged.before, applied: arranged.applied }
      : { from, saved };
    out = insertPageFlowBlock(out, `/** @pageFlow ${JSON.stringify(state)} */\n`);
    trace.action('page-flow-gen:on', { from, nodes: nodes.ids.length, bands: bands.length });
    return out;
  });
}

/** What ON wrote into one band of one prop, recomputed from the saved state (null = nothing written). */
function onWroteBand(
  id: string,
  entry: PageFlowState['saved'][string],
  band: Record<string, string | null>,
  prop: string,
  lower: number,
  from: number,
): string | null {
  if (lower >= from) return null;
  if (prop === PAGE_FLOW_PROPERTY) return 'vertical';
  return band[prop] ?? entry.inline[prop] ?? neutralOf(id)[prop] ?? null;
}

function keptEdit(nodeId: string, prop: string, scope: string, current: string | null): void {
  trace.action('page-flow-gen:off-kept-edit', { nodeId, prop, scope, current });
}

/**
 * Put back what ON replaced. A value is restored only where it still holds what ON wrote; anything
 * edited since ON is kept. Bands for widths the @canvas no longer has are skipped.
 */
function turnOff(code: string, state: PageFlowState): string {
  return withViewportWidths(code, () => {
    const viewports = canvasViewports(code);
    const bandByWidth = new Map(viewports.filter((v) => !isPrimaryViewport(v.id)).map((v) => [v.width, v]));
    const bandsNow = readBandValues(code);
    const current = readStylesOf(code, Object.keys(state.saved));
    let out = code;

    // 1. Saved nodes.
    for (const [id, entry] of Object.entries(state.saved)) {
      const now = current.get(id);
      if (!now) {
        trace.action('page-flow-gen:off-node-missing', { nodeId: id });
        continue;
      }
      const inline: Record<string, string> = {};
      for (const p of propsOf(id)) {
        if (now.values[p] === horizontalOf(id)[p]) inline[p] = entry.inline[p] ?? '';
        else keptEdit(id, p, 'inline', now.values[p] ?? null);
      }
      if (Object.keys(inline).length) out = updateNodeInCode(out, id, inline);

      for (const [width, values] of Object.entries(entry.bands)) {
        const vp = bandByWidth.get(Number(width));
        if (!vp) {
          trace.action('page-flow-gen:off-band-gone', { nodeId: id, width: Number(width) });
          continue;
        }
        const lower = bandLowerEdge(vp, viewports);
        const seen = bandsNow.get(vp.width)?.get(id);
        const styles: Record<string, string> = {};
        for (const [p, original] of Object.entries(values)) {
          const expected = onWroteBand(id, entry, values, p, lower, state.from);
          const cur = seen?.get(toKebab(p)) ?? null;
          if (cur === expected) styles[p] = original ?? '';
          else keptEdit(id, p, `band ${vp.width}`, cur);
        }
        if (Object.keys(styles).length) out = updateContainerQueryStyle(out, id, vp.width, styles);
      }
    }

    // 2. Children added after ON (never saved): clear the two values ON would have written, if still there.
    const nodes = readPageNodes(code);
    if (nodes) {
      for (const id of nodes.ids) {
        if (id === PAGE_ROOT_ID || id in state.saved) continue;
        const read = nodes.styles.get(id)!;
        if (read.values.flexShrink !== '0' || read.values.height !== '100svh') continue;
        out = updateNodeInCode(out, id, { flexShrink: '', height: '' });
        for (const [width, byNode] of bandsNow) {
          const props = byNode.get(id);
          const styles: Record<string, string> = {};
          if (props?.get('flex-shrink') === '1') styles.flexShrink = '';
          if (props?.get('height') === 'auto') styles.height = '';
          if (Object.keys(styles).length) out = updateContainerQueryStyle(out, id, width, styles);
        }
        trace.action('page-flow-gen:off-added-child-cleared', { nodeId: id });
      }
    }

    // 3. Tiles: the page's own arrangement comes back only if the tiles are still where ON put them.
    if (state.positions && state.applied) {
      const config = parseCanvasConfig(out);
      if (config) {
        if (samePositions(config.positions, state.applied)) {
          out = updateCanvasConfigInCode(out, { ...config, positions: state.positions });
        } else {
          keptEdit('@canvas', 'positions', 'tiles', null);
        }
      }
    }

    out = removePageFlowBlock(out);
    trace.action('page-flow-gen:off', { from: state.from, nodes: Object.keys(state.saved).length });
    return out;
  });
}

/** Why Page Flow cannot be turned on or off for this file, or null when it can. One line, shown in the panel. */
export function pageFlowRefusal(code: string): string | null {
  if (code.includes('variantConfig')) return 'Page flow works on pages, not on component files.';
  if (!canvasViewports(code).length) return 'Page flow needs a @canvas block with at least one viewport.';
  if (PAGE_FLOW_BLOCK.test(code) && !parsePageFlow(code)) return 'The @pageFlow block is malformed; fix it by hand first.';
  const nodes = readPageNodes(code);
  if (!nodes) return `Page flow needs a root element with data-id="${PAGE_ROOT_ID}".`;
  for (const id of nodes.ids) {
    const read = nodes.styles.get(id)!;
    if (read.spread) return `The inline style of "${id}" is spread from another object.`;
    const touched = propsOf(id).filter((p) => read.opaque.includes(p));
    if (touched.length) return `The inline ${touched.join(', ')} of "${id}" is not a literal value.`;
  }
  return null;
}

/**
 * What a page with Page Flow on has not caught up with: direct children that are not set to the
 * horizontal panel value, and non-primary breakpoints below the gate that have no vertical band.
 * Both come from edits after ON (a new section, a new breakpoint). Empty when Page Flow is off.
 */
export function pageFlowStragglers(code: string): { children: string[]; bands: number[] } {
  const state = parsePageFlow(code);
  if (!state) return { children: [], bands: [] };
  const nodes = readPageNodes(code);
  const children = nodes
    ? nodes.ids.filter((id) => id !== PAGE_ROOT_ID && nodes.styles.get(id)!.values.flexShrink !== '0')
    : [];
  const viewports = canvasViewports(code);
  const bandsNow = readBandValues(code);
  const bands = viewports
    .filter((v) => !isPrimaryViewport(v.id) && bandLowerEdge(v, viewports) < state.from)
    .filter((v) => bandsNow.get(v.width)?.get(PAGE_ROOT_ID)?.get(PAGE_FLOW_PROPERTY) !== 'vertical')
    .map((v) => v.width);
  if (children.length || bands.length) {
    trace.action('page-flow-gen:stragglers', { children, bands });
  }
  return { children, bands };
}

/**
 * Turn Page Flow on from `from` (a gate's lower edge), or off with `null`.
 * Re-applying with another gate first restores the originals, so the saved values are always the page's own.
 */
export function setPageFlowInCode(code: string, from: number | null): string {
  const refusal = pageFlowRefusal(code);
  if (refusal) {
    trace.error('page-flow-gen:refused', { reason: refusal });
    return code;
  }
  const state = parsePageFlow(code);
  if (from === null) return state ? turnOff(code, state) : code;
  if (!Number.isFinite(from)) {
    trace.error('page-flow-gen:invalid-gate', { from });
    return code;
  }
  const base = state ? turnOff(code, state) : code;
  return turnOn(base, from);
}
