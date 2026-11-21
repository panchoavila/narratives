import { validCmsCollation } from '@/shared/cms-collation';
// Shared CMS row selection for native lists and collection-backed slots.
import type { CollectionItem, FilterConfig, FilterGroup, SortConfig } from '@/shared/types';
import { cmsValueIsSet } from '@/shared/cms-visibility';

// ─── Collection chain config (filter / sort / limit) ───────────────────────
//
// Mirrors what `cms-gen.ts:buildChainCode` emits and what
// `parser.ts:parseFilterCallback / parseSortCallback / parseSliceArgs`
// reads back. Run on the raw collection data BEFORE the renderer's ghost
// loop so the canvas reflects the live website's behaviour — change a
// filter and ghost #2 disappears, change a sort and rows reorder, drop
// a limit and the spillover rows hide. Without this the canvas would
// keep showing the unfiltered data and the user couldn't tell whether
// their config was correct.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateVal = (v: unknown): boolean => typeof v === 'string' && DATE_ONLY_RE.test(v);

/** A currentItem filter with its detail item's value resolved (`undefined` when the item
 *  lacks the field, exactly as the site's `item.<field>` reads it). Only a resolved filter is
 *  evaluated; an unresolved one (no previewed item) stays a pass-through, like the other dynamic
 *  sources. The mark is a field on the filter: the nodes reach the canvas iframe as a copy
 *  (postMessage / JSON), which an outside mark such as a WeakSet of identities does not survive. */
export function resolveCurrentItemFilter(filter: FilterConfig, value: unknown): FilterConfig {
  return { ...filter, value, resolvedFromItem: true };
}

/** A resolved currentItem predicate, evaluated like the emitted site code: `equals` is
 *  strict (`row.F === item.K`); contains / not_contains compare `String(...).toLowerCase()`
 *  on BOTH sides, so an array field is joined with commas, a number is compared by its
 *  digits, and a missing value is the text "undefined". */
function evalCurrentItem(item: CollectionItem, filter: FilterConfig): boolean {
  const lhs = item[filter.field];
  const rhs = filter.value;
  switch (filter.operator) {
    case 'equals': return lhs === rhs;
    case 'not_equals': return lhs !== rhs;
    case 'contains': return String(lhs).toLowerCase().includes(String(rhs).toLowerCase());
    case 'not_contains': return !String(lhs).toLowerCase().includes(String(rhs).toLowerCase());
    case 'array_contains': return Array.isArray(lhs) && lhs.includes(rhs);
    case 'array_not_contains': return !Array.isArray(lhs) || !lhs.includes(rhs);
    case 'value_in_array': return Array.isArray(rhs) && rhs.includes(lhs);
    case 'value_not_in_array': return !Array.isArray(rhs) || !rhs.includes(lhs);
    default: return true;
  }
}

function evalFilter(item: CollectionItem, filter: FilterConfig): boolean {
  const rhs = filter.value;
  if ((filter.valueSource === 'currentItem' || filter.valueSource === 'parentItem') && filter.resolvedFromItem === true) return evalCurrentItem(item, filter);
  // Dynamic-value filters (search field / date picker) have no author-time value on
  // the canvas — pass through so the canvas previews every row (the deployed page
  // applies the real predicate against the live variable). See Phase 4.
  if (filter.valueSource && filter.valueSource !== 'static') return true;
  // Date-day comparison (mirrors cms-gen): a date-only value compares against the
  // field's "YYYY-MM-DD" prefix so a full ISO timestamp (_createdAt/_updatedAt) or
  // a date-only field both match, and gt/lt/between compare lexically (chronologically).
  const dateCmp = !['in', 'not_in', 'array_contains', 'array_not_contains', 'value_in_array', 'value_not_in_array'].includes(filter.operator)
    && (isDateVal(rhs) || (Array.isArray(rhs) && (isDateVal(rhs[0]) || isDateVal(rhs[1]))));
  const lhs = dateCmp ? String(item[filter.field] ?? '').slice(0, 10) : item[filter.field];
  switch (filter.operator) {
    case 'between': {
      const [lo, hi] = Array.isArray(rhs) ? rhs : [rhs, rhs];
      if (dateCmp) return lhs >= String(lo) && lhs <= String(hi);
      return Number(lhs) >= Number(lo) && Number(lhs) <= Number(hi);
    }
    case 'equals': return lhs === rhs;
    case 'not_equals': return lhs !== rhs;
    // contains / not_contains are CASE-INSENSITIVE (design-tool parity) — matches the
    // generated predicate (String(field).toLowerCase().includes(value.toLowerCase())).
    case 'contains':
      if (typeof lhs === 'string' && typeof rhs === 'string') return lhs.toLowerCase().includes(rhs.toLowerCase());
      if (Array.isArray(lhs)) return lhs.includes(rhs);
      return false;
    case 'not_contains':
      if (typeof lhs === 'string' && typeof rhs === 'string') return !lhs.toLowerCase().includes(rhs.toLowerCase());
      if (Array.isArray(lhs)) return !lhs.includes(rhs);
      return true;
    case 'in': return Array.isArray(rhs) && rhs.includes(lhs);
    case 'not_in': return !Array.isArray(rhs) || !rhs.includes(lhs);
    case 'array_contains': return Array.isArray(lhs) && lhs.includes(rhs);
    case 'array_not_contains': return !Array.isArray(lhs) || !lhs.includes(rhs);
    case 'value_in_array': return Array.isArray(rhs) && rhs.includes(lhs);
    case 'value_not_in_array': return !Array.isArray(rhs) || !rhs.includes(lhs);
    case 'gt': return dateCmp ? String(lhs) > String(rhs) : Number(lhs) > Number(rhs);
    case 'gte': return dateCmp ? String(lhs) >= String(rhs) : Number(lhs) >= Number(rhs);
    case 'lt': return dateCmp ? String(lhs) < String(rhs) : Number(lhs) < Number(rhs);
    case 'lte': return dateCmp ? String(lhs) <= String(rhs) : Number(lhs) <= Number(rhs);
    case 'exists': {
      const present = cmsValueIsSet(lhs);
      return rhs === false ? !present : present;
    }
    default: return true;
  }
}

type ListOverride = { filterGroup?: FilterGroup | null; sort?: SortConfig[] | null };

export function applyChainConfig(
  raw: CollectionItem[],
  cfg: {
    filterGroup?: FilterGroup | null; sort?: SortConfig | SortConfig[] | null;
    limit?: number | null; offset?: number | null; pagination?: { perPage: number } | null;
    responsive?: Record<string, ListOverride> | null;
    variantConfigs?: Record<string, ListOverride> | null;
  } | undefined,
  /** Active replica width — selects the per-viewport override bucket (max-width). */
  vpWidth?: number,
  /** Active variant (master artboard / resolved instance variant) — selects the
   *  per-variant override. */
  variantName?: string,
  /** The row of the immediately enclosing list, if this list is nested. */
  parentItem?: CollectionItem | null,
): CollectionItem[] {
  if (!cfg) return raw;
  let data = raw;

  // Resolve effective filter/sort = base ← per-viewport bucket ← per-variant
  // (mirrors the deployed useResponsiveListConfig merge). An override only
  // replaces a dim it explicitly carries; absent dims inherit base.
  let filterGroup = cfg.filterGroup ?? null;
  let sort: SortConfig | SortConfig[] | null = cfg.sort ?? null;
  if (cfg.responsive && vpWidth) {
    const bps = Object.keys(cfg.responsive).map(Number).filter(n => isFinite(n) && n > 0).sort((a, b) => a - b);
    let bucket: number | null = null;
    for (const b of bps) { if (vpWidth <= b) { bucket = b; break; } }
    const ov = bucket != null ? cfg.responsive[String(bucket)] : null;
    if (ov) { if (ov.filterGroup !== undefined) filterGroup = ov.filterGroup; if (ov.sort !== undefined) sort = ov.sort; }
  }
  if (cfg.variantConfigs && variantName && cfg.variantConfigs[variantName]) {
    const ov = cfg.variantConfigs[variantName];
    if (ov.filterGroup !== undefined) filterGroup = ov.filterGroup;
    if (ov.sort !== undefined) sort = ov.sort;
  }

  if (filterGroup && filterGroup.filters.length > 0) {
    const { combinator } = filterGroup;
    const filters = filterGroup.filters.map(f => f.valueSource === 'parentItem' && parentItem && f.valueField
      ? resolveCurrentItemFilter(f, parentItem[f.valueField]) : f);
    data = data.filter(item => combinator === 'or'
      ? filters.some(f => evalFilter(item, f))
      : filters.every(f => evalFilter(item, f)));
  }
  // Multi-key stable sort: first non-zero key delta wins (accepts legacy single config).
  const sortKeys = Array.isArray(sort) ? sort : sort ? [sort] : [];
  if (sortKeys.length > 0) {
    data = [...data].sort((a, b) => {
      for (const key of sortKeys) {
        const { field, direction } = key;
        const order = key.valueSource === 'parentItem' && key.valueField ? parentItem?.[key.valueField] : key.resolvedOrder;
        if (key.valueSource && !Array.isArray(order)) continue;
        const av = key.valueSource ? (order as unknown[]).indexOf(a[field]) : a[field];
        const bv = key.valueSource ? (order as unknown[]).indexOf(b[field]) : b[field];
        const dir = direction === 'desc' ? -1 : 1;
        if (!key.valueSource && key.collation && validCmsCollation(key.collation)) {
          const compared = String(av ?? '').localeCompare(String(bv ?? ''), key.collation.locale, { sensitivity: key.collation.sensitivity });
          if (compared) return compared * dir;
          continue;
        }
        if (av === bv) continue;
        return av > bv ? dir : -dir;
      }
      return 0;
    });
  }
  // Skip the first `offset` items, then preview page 1 (pagination) / honor the
  // static limit. Mirrors the generated `.slice(offset, offset+N)` so the canvas
  // shows the same window the deployed page renders.
  const off = cfg.offset && cfg.offset > 0 ? cfg.offset : 0;
  if (cfg.pagination && cfg.pagination.perPage > 0) {
    data = data.slice(off, off + cfg.pagination.perPage);
  } else if (cfg.limit && cfg.limit > 0) {
    data = data.slice(off, off + cfg.limit);
  } else if (off > 0) {
    data = data.slice(off);
  }
  return data;
}

