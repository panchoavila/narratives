/** Canonical, scope-checked CMS visibility predicate shared by parser and oracle. */
import _generate from '@babel/generator';
import { parseExpression } from '@babel/parser';
import type * as t from '@babel/types';

import type { CmsVisibility } from '@/shared/cms-visibility';
export type { CmsVisibility } from '@/shared/cms-visibility';
const generate = (typeof _generate === 'function' ? _generate : (_generate as any).default) as typeof _generate;
const IDENT = /^[$A-Z_a-z][$\w]*$/;

export function cmsVisibilityPredicate(owner: string, config: CmsVisibility): string | null {
  if (!IDENT.test(owner) || !config.field) return null;
  const field = IDENT.test(config.field) ? `${owner}.${config.field}` : `${owner}[${JSON.stringify(config.field)}]`;
  const positive = `(Array.isArray(${field}) ? ${field}.length > 0 : ${field} !== null && ${field} !== undefined && ${field} !== '')`;
  return config.condition === 'notSet' ? `!${positive}` : positive;
}
export function parseCmsVisibilityMarker(raw: string | null | undefined): CmsVisibility | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if ((data.source !== 'row' && data.source !== 'currentItem') || (data.condition !== 'isSet' && data.condition !== 'notSet') || typeof data.field !== 'string' || !data.field || Object.keys(data).some(k => !['source', 'field', 'condition'].includes(k))) return null;
    return { source: data.source, field: data.field, condition: data.condition };
  } catch { return null; }
}
/** Reject unmarked, mismatched or arbitrary JS: only the exact generated predicate is editable. */
export function matchesCmsVisibilityPredicate(expression: t.Node, owner: string, config: CmsVisibility): boolean {
  const canonical = cmsVisibilityPredicate(owner, config);
  if (!canonical) return false;
  try { return generate(expression).code === generate(parseExpression(canonical)).code; }
  catch { return false; }
}
