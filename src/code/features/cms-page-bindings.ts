// cms-page-bindings.ts — Apply previewed-item data to a detail page's
// node tree at canvas-render time.
//
// Detail-page templates use JSX bindings like `{item.title}` /
// `<img src={item.cover}>` that the parser detects (when the file has
// `/** @cmsPage { kind: 'detail' } */`) and stores on each node as
// `binding`, `attrBindings`, `styleBindings` — same shape inline `.map()`
// templates use.
//
// This helper takes the parser's node map + the previewed item record and
// returns a NEW map where binding-bearing nodes are shallow-cloned with
// their `textContent` / `attrs` / `styles` substituted. Nodes without
// bindings are passed through by reference; cloning is per-node so
// switching previewed slugs is cheap.

import type { CanvasNode } from '../parsing/parser';
import type { FilterGroup } from '@/shared/types';
import { formatBoundStyleValue } from './cms-style-format';
import { resolveCurrentItemFilter } from '@/canvas/renderer/collection-data';
import { cmsValueIsSet } from '@/shared/cms-visibility';
import { trace } from '@/shared/debug-trace';

/**
 * Resolve the currentItem filters of a list's base filter group against the previewed
 * detail item: `{ valueSource: 'currentItem', valueField: '_id' }` gets the detail item's
 * `_id` as its value, and `applyChainConfig` evaluates it the way the emitted site code
 * does. A field the item lacks resolves to `undefined` (the site compares the same
 * `undefined`), never to a made-up `''`. Non-currentItem filters pass through.
 * Returns the input group untouched when it has no currentItem filter.
 */
export function resolveCurrentItemFilters(
  fg: FilterGroup,
  item: Record<string, unknown>,
): FilterGroup {
  if (!fg.filters.some(f => f.valueSource === 'currentItem')) return fg;
  return {
    combinator: fg.combinator,
    filters: fg.filters.map(f => {
      if (f.valueSource !== 'currentItem' || !f.valueField) return f;
      return resolveCurrentItemFilter(f, item[f.valueField]);
    }),
  };
}

/**
 * Walk the node map and apply field substitutions for any node whose
 * parser-detected bindings reference fields present on `item`. Returns a
 * new Map; the input map is left untouched (Canvas re-renders on slug
 * change get the fresh substitution without mutating the parser cache).
 */
export function applyDetailPageBindings(
  nodes: Map<string, CanvasNode>,
  item: Record<string, unknown> | null,
): Map<string, CanvasNode> {
  if (!item) return nodes;
  const out = new Map(nodes);
  let mutatedCount = 0;

  for (const [id, node] of out) {
    let cloned: CanvasNode | null = null;

    // Text / single-attribute binding.
    if (node.binding && item[node.binding.field] !== undefined) {
      const resolved = String(item[node.binding.field] ?? '');
      cloned = { ...node };
      if (node.binding.property === 'text') {
        cloned.textContent = resolved;
      } else {
        cloned.attrs = { ...cloned.attrs, [node.binding.property]: resolved };
      }
    }

    // Multi-attribute bindings (src + alt etc.).
    if (node.attrBindings) {
      for (const ab of node.attrBindings) {
        if (item[ab.field] === undefined) continue;
        const resolved = String(item[ab.field] ?? '');
        if (!cloned) cloned = { ...node };
        cloned.attrs = { ...cloned.attrs, [ab.property]: resolved };
      }
    }

    // Style bindings — `{ backgroundColor: item.bgColor }` etc.
    // For URL-bearing props (`backgroundImage`, `maskImage`, …) the JSON
    // holds a bare URL, but CSS needs `url(...)`; `formatBoundStyleValue`
    // wraps when needed. Same helper the Renderer uses for .map() ghosts so
    // detail-page substitution and per-item rendering stay byte-identical.
    if (node.styleBindings) {
      for (const sb of node.styleBindings) {
        if (item[sb.field] === undefined) continue;
        const resolved = formatBoundStyleValue(sb.styleProp, item[sb.field] ?? '');
        if (!cloned) cloned = { ...node };
        cloned.styles = { ...cloned.styles, [sb.styleProp]: resolved };
      }
    }

    // DORMANT bindings (`data-cms-orphan`). A node dragged onto the canvas of
    // its own detail page cannot keep a live `{item.field}` — `canvasNodes` is
    // module scope, where `item` is not declared — so the binding is stashed
    // and the row's value baked into the JSX as a literal. That literal is a
    // SNAPSHOT: editing the field left the canvas copy showing the old text
    // (report 2026-09-09). Painting the stash here makes the canvas follow the
    // field like every other bound node, while the source keeps the safe
    // literal. A field this page's item doesn't have is skipped, so a row
    // dragged out of a NESTED collection list stays on its baked value.
    if (node.orphanBindings) {
      for (const ob of node.orphanBindings) {
        if (item[ob.field] === undefined) continue;
        if (!cloned) cloned = { ...node };
        if (ob.prop === '__text') {
          cloned.textContent = String(item[ob.field] ?? '');
        } else if (ob.prop.startsWith('__style.')) {
          const cssProp = ob.prop.slice('__style.'.length);
          cloned.styles = { ...cloned.styles, [cssProp]: formatBoundStyleValue(cssProp, item[ob.field] ?? '') };
        } else {
          cloned.attrs = { ...cloned.attrs, [ob.prop]: String(item[ob.field] ?? '') };
        }
      }
    }

    // Resolve detail-item presence without changing its persistent source binding.
    if (node.cmsVisibility?.source === 'currentItem') {
      const present = cmsValueIsSet(item[node.cmsVisibility.field]);
      const base = cloned ?? node;
      cloned = { ...base, cmsVisibility: { ...node.cmsVisibility, resolved: node.cmsVisibility.condition === 'isSet' ? present : !present } };
    }

    // currentItem list filters (`row.desk === item._id`) → resolved against this item.
    const cl = node.collectionList;
    const resolveSort = (sort: NonNullable<CanvasNode['collectionList']>['sort']) => sort?.map(key => key.valueSource === 'currentItem' && key.valueField ? { ...key, resolvedOrder: Array.isArray(item[key.valueField]) ? item[key.valueField] as unknown[] : [] } : key);
    const resolveOverrides = (input: NonNullable<CanvasNode['collectionList']>['responsive']) => input && Object.fromEntries(Object.entries(input).map(([key, value]) => [key, {
      ...value, ...(value.filterGroup ? { filterGroup: resolveCurrentItemFilters(value.filterGroup, item) } : {}), ...(value.sort ? { sort: resolveSort(value.sort) } : {}),
    }]));
    const hasScoped = cl && (cl.sort?.some(s => s.valueSource === 'currentItem') || Object.values(cl.responsive ?? {}).some(v => v.sort?.some(s => s.valueSource === 'currentItem')) || Object.values(cl.variantConfigs ?? {}).some(v => v.sort?.some(s => s.valueSource === 'currentItem')) || cl.filterGroup?.filters.some(f => f.valueSource === 'currentItem')
      || Object.values(cl.responsive ?? {}).some(v => v.filterGroup?.filters.some(f => f.valueSource === 'currentItem'))
      || Object.values(cl.variantConfigs ?? {}).some(v => v.filterGroup?.filters.some(f => f.valueSource === 'currentItem')));
    if (cl && hasScoped) {
      const base = cloned ?? node;
      cloned = { ...base, collectionList: { ...cl,
        filterGroup: cl.filterGroup ? resolveCurrentItemFilters(cl.filterGroup, item) : cl.filterGroup, sort: resolveSort(cl.sort),
        responsive: resolveOverrides(cl.responsive), variantConfigs: resolveOverrides(cl.variantConfigs),
      } };
      trace.action('cms-page-bindings:current-item-filter', { nodeId: id });
    }

    if (cloned) {
      out.set(id, cloned);
      mutatedCount++;
    }
  }

  trace.fn('cms-page-bindings:apply', { mutatedCount, totalNodes: out.size });
  return out;
}
