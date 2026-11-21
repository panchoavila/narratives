// cms-filter-utils.ts — Shared helpers for the Collection List Filters + Sorting
// popups: field-type-aware operator menus, order labels, and human-readable row
// summaries. Keeps the UI logic out of the controls + reusable across Filter and
// Sort editor panels.

import type { FilterConfig, FieldDefinition, CollectionSchema } from '@/shared/types';
import type { CmsPageMeta } from '@/code/project/cms-page-meta';

type FieldType = FieldDefinition['type'];

/** Value-column class for EVERY Collection List row (Source / Filters / Sorting /
 *  Pagination / Limit / Offset). A FIXED flex-basis at the panel's standard value
 *  width, so all CL rows compute to the EXACT same px as every OTHER tool row
 *  (Layout's Align/Justify, SizeTool's Width/Height, …).
 *
 *  Deriving the number (panel is a fixed 260px):
 *    row width R = 260 − 16 (`px-2`) − 12 (`pl-3`)                = 232px
 *    label basis = `w-3/4` = 0.75R                               = 174px
 *  A standard tool row uses a NON-plain `ControlLabel` whose gutter margin is
 *  `-ml-[18px]` (net −18px). With `justify-between` + `w-full` shrink:1 on both,
 *  the value column settles at  R − ((0.75R + R − 18) − R)·(R/1.75R)
 *    = 0.5714·R + 18/1.75  ≈ 142.9px  ≈ **61.6%** of R.
 *
 *  Two traps this avoids:
 *   1. My earlier `basis-[57%]` ignored that −18px gutter — 57% is the split with
 *      ZERO label margin; the real equilibrium is ~61.6%. 57% was ~9px too narrow.
 *   2. The CL uses a PLAIN `ControlLabel`, whose gutter is `-ml-[18px] mr-[2px]`
 *      (net −16px, not −18px) — so a plain row's `w-full` value lands ~2px NARROWER
 *      than the non-plain rows around it (the reported Advisors/Pagination gap). A
 *      margin fix can't heal it uniformly (EntryList's 2nd+ spacer has no `mr-[2px]`).
 *  A FIXED basis sidesteps both: `grow-0 shrink-0` pins the value to 61.6% of R
 *  regardless of label margin, value element type, or spacer rows. `min-w-0` keeps a
 *  wide-min-content value (Limit/Offset = ToolInput + RemoveButton) from clamping past
 *  it. The label column (shrink:1) absorbs whatever remains. */
export const COLLECTION_VALUE_CLS = 'grow-0 shrink-0 basis-[61.6%] min-w-0';

/** System fields present on EVERY CollectionItem (`_createdAt`/`_updatedAt`, set
 *  by addCollectionItem + bumped by updateCollectionItem). They aren't in
 *  `schema.fields` (so they don't show as editable columns) but ARE sortable +
 *  filterable date fields — design-tool parity (Created / Updated). */
const SYSTEM_SORT_FIELDS: FieldDefinition[] = [
  { id: '_id', name: 'ID', type: 'text' },
  { id: '_status', name: 'Publication status', type: 'enum', options: ['published', 'draft'] },
  { id: '_createdAt', name: 'Created', type: 'date' },
  { id: '_updatedAt', name: 'Updated', type: 'date' },
];

/** Fields offered in the Sort/Filter field dropdowns: the collection's own
 *  fields PLUS the system Created/Updated date fields. */
export function fieldsForSortFilter(schema: CollectionSchema | null): FieldDefinition[] {
  return [...(schema?.fields ?? []), ...SYSTEM_SORT_FIELDS];
}

/** Operator menu options for a given field type (standard: text gets
 *  contains/equals, number/date get comparisons + between, boolean is/is-not, …). */
export function operatorsForFieldType(type: FieldType | undefined): { value: FilterConfig['operator']; label: string }[] {
  switch (type) {
    case 'number':
    case 'date':
      return [
        { value: 'equals', label: 'equals' },
        { value: 'not_equals', label: 'not equals' },
        { value: 'gt', label: 'after / >' },
        { value: 'gte', label: 'on or after / ≥' },
        { value: 'lt', label: 'before / <' },
        { value: 'lte', label: 'on or before / ≤' },
        { value: 'between', label: 'between' },
        { value: 'exists', label: 'is set' },
      ];
    case 'boolean':
      return [
        { value: 'equals', label: 'is' },
        { value: 'not_equals', label: 'is not' },
      ];
    case 'enum':
      return [
        { value: 'equals', label: 'is' },
        { value: 'not_equals', label: 'is not' },
        { value: 'exists', label: 'is set' },
      ];
    case 'reference':
      return [
        { value: 'equals', label: 'is' },
        { value: 'not_equals', label: 'is not' },
        { value: 'exists', label: 'is set' },
      ];
    case 'multi-reference':
    case 'tags':
      return [
        { value: 'array_contains', label: 'contains ID' },
        { value: 'array_not_contains', label: 'does not contain ID' },
        { value: 'exists', label: 'is set' },
      ];
    default: // text, textarea, richtext, slug, link, url, color, image, file
      return [
        { value: 'contains', label: 'contains' },
        { value: 'not_contains', label: 'does not contain' },
        { value: 'equals', label: 'equals' },
        { value: 'not_equals', label: 'not equals' },
        { value: 'exists', label: 'is set' },
      ];
  }
}

/** Whether the value widget should be hidden (operators that take no value). */
export function operatorTakesNoValue(op: FilterConfig['operator']): boolean {
  return op === 'exists';
}

/** Resolve the effective sort/order TYPE for a field. Prefers the schema's
 *  declared type; falls back to a name heuristic so system date fields (Created,
 *  Updated, Published, …) that may be missing from `schema.fields` still get
 *  date-style order labels instead of the generic A→Z. */
export function effectiveFieldType(field: FieldDefinition | undefined, fieldId: string): FieldType | undefined {
  if (field?.type) return field.type;
  if (/creat|updat|publish|date|time|year/i.test(fieldId)) return 'date';
  return undefined;
}

/** Sort-order labels per field type — asc/desc in the field's natural language
 *  (A→Z text, Old→New date, Low→High number). Matches the reference's wording. */
export function orderLabels(type: FieldType | undefined): { value: 'asc' | 'desc'; label: string }[] {
  switch (type) {
    case 'date':
      return [{ value: 'asc', label: 'Old → New' }, { value: 'desc', label: 'New → Old' }];
    case 'number':
      return [{ value: 'asc', label: 'Low → High' }, { value: 'desc', label: 'High → Low' }];
    case 'boolean':
      return [{ value: 'asc', label: 'Off → On' }, { value: 'desc', label: 'On → Off' }];
    default: // text/slug/enum/…
      return [{ value: 'asc', label: 'A → Z' }, { value: 'desc', label: 'Z → A' }];
  }
}

/** Whether the "Current item" value source (a field of the page's detail item) can be
 *  offered: only while the active file is a `@cmsPage` detail page. */
export function canOfferCurrentItem(meta: CmsPageMeta | null): boolean {
  return meta?.kind === 'detail';
}

/** Whether the list at `nodeId` sits inside another collection list (an ancestor carries a
 *  `collectionList`). The outer list's row parameter shadows the detail item there, so
 *  "Current item" is not offered for it. Walks the parsed node map's parent chain. */
export function isNestedInCollectionList(
  nodes: ReadonlyMap<string, { parentId: string | null; collectionList?: unknown }>,
  nodeId: string,
): boolean {
  const seen = new Set<string>();
  let cur = nodes.get(nodeId)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent = nodes.get(cur);
    if (!parent) return false;
    if (parent.collectionList) return true;
    cur = parent.parentId;
  }
  return false;
}

/** Nearest enclosing list provides the row available to a nested filter. */
export function parentCollectionSource(
  nodes: ReadonlyMap<string, { parentId: string | null; collectionList?: { source: string } | null }>, nodeId: string,
): string | null {
  const seen = new Set<string>();
  let cur = nodes.get(nodeId)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent = nodes.get(cur);
    if (!parent) break;
    if (parent.collectionList) return parent.collectionList.source;
    cur = parent.parentId;
  }
  return null;
}

/** Operators a currentItem filter can use — the generator and parser only emit these. */
export function currentItemOperators(): { value: FilterConfig['operator']; label: string }[] {
  return [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'array_contains', label: 'contains ID' },
    { value: 'array_not_contains', label: 'does not contain ID' },
    { value: 'value_in_array', label: 'ID is in value' },
    { value: 'value_not_in_array', label: 'ID is not in value' },
  ];
}

/** Fields of the detail item a currentItem filter can read: its `_id` / `_slug` (always
 *  present on a collection item) followed by the detail collection's own fields. */
export function currentItemFieldOptions(detailSchema: CollectionSchema | null): { value: string; label: string }[] {
  return [
    { value: '_id', label: 'ID' },
    { value: '_slug', label: 'Slug' },
    ...(detailSchema?.fields ?? []).map(f => ({ value: f.id, label: f.name })),
  ];
}

const CURRENT_ITEM_SYMBOL: Partial<Record<FilterConfig['operator'], string>> = {
  equals: '=', not_equals: '≠', contains: 'contains', not_contains: 'does not contain',
  array_contains: 'contains ID', array_not_contains: 'does not contain ID', value_in_array: 'is in', value_not_in_array: 'is not in',
};

const OP_SUMMARY: Record<FilterConfig['operator'], string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'excludes',
  gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'in', not_in: 'not in', exists: 'is set', between: 'between',
  array_contains: 'contains ID', array_not_contains: 'does not contain ID', value_in_array: 'is in', value_not_in_array: 'is not in',
};

/** Human-readable one-line summary for a filter row (e.g. "Category is News"). */
export function filterSummary(f: FilterConfig, fieldName: string): string {
  if (f.valueSource === 'searchField') return `${fieldName} matches search`;
  if (f.valueSource === 'dateField') return `${fieldName} from date`;
  if (f.valueSource === 'currentItem') {
    return `${fieldName} ${CURRENT_ITEM_SYMBOL[f.operator] ?? f.operator} current item's ${f.valueField ?? '…'}`;
  }
  if (f.valueSource === 'parentItem') return `${fieldName} ${CURRENT_ITEM_SYMBOL[f.operator] ?? f.operator} parent item's ${f.valueField ?? '…'}`;
  const op = OP_SUMMARY[f.operator] ?? f.operator;
  if (operatorTakesNoValue(f.operator)) return `${fieldName} ${op}`;
  if (f.operator === 'between' && Array.isArray(f.value)) return `${fieldName} ${op} ${f.value[0]}–${f.value[1]}`;
  const v = f.value === '' || f.value == null ? '…' : String(f.value);
  return `${fieldName} ${op} ${v}`;
}

/** Preserve compatible field bindings when switching a collection. */
export function collectionFieldRemap(oldSchema?: CollectionSchema, newSchema?: CollectionSchema): Record<string, string> {
    const remap: Record<string, string> = {};
    if (oldSchema && newSchema) {
      const typeBucket = (t: string): string => {
        if (t === 'text' || t === 'textarea' || t === 'richtext' || t === 'slug') return 'text';
        if (t === 'image' || t === 'file') return 'image';
        if (t === 'link' || t === 'url') return 'link';
        return t;
      };
      const consumed = new Set<string>();
      for (const oldField of oldSchema.fields) {
        // Prefer same id if it exists with a compatible type (the user
        // probably meant the same thing).
        const sameId = newSchema.fields.find(
          f => f.id === oldField.id && typeBucket(f.type) === typeBucket(oldField.type),
        );
        if (sameId) {
          remap[oldField.id] = sameId.id;
          consumed.add(sameId.id);
          continue;
        }
        const candidate = newSchema.fields.find(
          f => typeBucket(f.type) === typeBucket(oldField.type) && !consumed.has(f.id),
        );
        if (candidate) {
          remap[oldField.id] = candidate.id;
          consumed.add(candidate.id);
        }
      }
    }
  return remap;
}
