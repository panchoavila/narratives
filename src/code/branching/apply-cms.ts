// branching/apply-cms.ts — the CMS contract an apply must keep
// (briefs/22-11-2026-branch-review-workflow.md, D3).
//
// Before this, applying a branch merged CMS files as text and checked nothing:
// a branch could remove a field live items use, or ship views reading fields
// the schema lacks. Now the merged result (main's live items plus the
// branch's item changes, under the merged schemas) is checked the way
// `design:push` checked a push, before anything is written:
//   · schemas parse;
//   · no collection, and no field, that published items on main use is removed;
//   · views read only fields their collection's schema has;
//   · item data is backfilled with new fields' defaults and validated.
// Pure: reads two maps, returns the backfilled files or a refusal.

import {
  isCmsDataPath,
  parseSchemasFromFiles,
  reconcileCmsDataWithSchemas,
  validateSiteViewsAgainstSchemas,
  type CmsContractIssue,
} from '@/shared/cms-site-contract';

export interface ApplyCmsResult {
  /** Files to write in place of the merged ones (backfilled defaults). */
  updates: Map<string, string>;
  /** Why the apply must not happen; null when it may. */
  refusal: string | null;
}

type Item = Record<string, unknown>;

function itemsOf(content: string | undefined): Item[] {
  if (!content) return [];
  try {
    const v = JSON.parse(content) as unknown;
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Item[]) : [];
  } catch {
    return [];
  }
}

const isPublished = (item: Item) => (item._status ?? 'published') === 'published';
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const label = (item: Item) => String(item._slug || item._id || '?');

function describe(issues: CmsContractIssue[], max = 3): string {
  const shown = issues.slice(0, max).map((i) => i.message).join(' · ');
  return issues.length > max ? `${shown} · (+${issues.length - max} more)` : shown;
}

export function applyCmsContract(main: Map<string, string>, merged: Map<string, string>): ApplyCmsResult {
  const updates = new Map<string, string>();
  const mergedFiles = Object.fromEntries(merged);
  const { schemas, issues: schemaIssues } = parseSchemasFromFiles(mergedFiles);
  if (schemaIssues.length > 0) return { updates, refusal: `CMS schemas: ${describe(schemaIssues)}` };

  // Removing a collection or a field that published content on main uses.
  const { schemas: mainSchemas } = parseSchemasFromFiles(Object.fromEntries(main));
  const lost: string[] = [];
  for (const [slug, mainSchema] of mainSchemas) {
    const published = itemsOf(main.get(`cms/${slug}.json`)).filter(isPublished);
    if (published.length === 0) continue;
    const next = schemas.get(slug);
    if (!next) {
      lost.push(`the collection "${slug}" is removed, and ${published.length} published item(s) use it (${published.slice(0, 3).map(label).join(', ')})`);
      continue;
    }
    const kept = new Set(next.fields.map((f) => f.id));
    for (const field of mainSchema.fields) {
      if (kept.has(field.id)) continue;
      const using = published.filter((item) => !isEmpty(item[field.id]));
      if (using.length > 0) {
        lost.push(`the field "${slug}.${field.id}" is removed, and ${using.length} published item(s) have a value in it (${using.slice(0, 3).map(label).join(', ')})`);
      }
    }
  }
  if (lost.length > 0) {
    return { updates, refusal: `Applying would lose published content: ${lost.join('; ')}. Keep the field or collection, or unpublish or clear those items first.` };
  }

  // Views read only fields their collection has.
  const viewIssues = validateSiteViewsAgainstSchemas(mergedFiles, schemas);
  if (viewIssues.length > 0) return { updates, refusal: `Views and CMS schemas disagree: ${describe(viewIssues)}` };

  // Backfill new fields' defaults into existing items, then validate the data.
  const cmsData: Record<string, string> = {};
  for (const [p, content] of merged) if (isCmsDataPath(p)) cmsData[p] = content;
  const reconciled = reconcileCmsDataWithSchemas({ remoteCmsFiles: cmsData, schemas });
  if (reconciled.issues.length > 0) return { updates, refusal: `CMS items would be invalid: ${describe(reconciled.issues)}` };
  for (const p of reconciled.changedPaths) updates.set(p, reconciled.files[p]!);
  return { updates, refusal: null };
}
