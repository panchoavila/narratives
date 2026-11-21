// cms-site-contract.ts — Shared ownership, schema-to-TypeScript generation,
// Data ↔ Schema validation, schema backfill, and AST View ↔ Schema checks for
// sites where content lives 100% in the CMS (`cmsOnly: true`) and design/views
// are authored locally (briefs/15-11-2026-cms-only-remote-design-local.md).
//
// Pure & isomorphic (no fs, no DOM): runs in the browser (oracle gate), Vite
// dev middleware, the self-hosted Node server, and CLI sync scripts.

import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { ADDITIONAL_SOURCE_DIRECTORIES, PROJECT_CONFIG_FILES } from './project-source-files';

export type CmsFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'image'
  | 'file'
  | 'link'
  | 'url'
  | 'color'
  | 'enum'
  | 'tags'
  | 'slug'
  | 'reference'
  | 'multi-reference';

export interface FieldDefinition {
  id: string;
  name: string;
  type: CmsFieldType;
  required?: boolean;
  translatable?: boolean;
  description?: string;
  options?: string[];
  referenceCollection?: string;
  defaultValue?: unknown;
  source?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}

export interface CollectionSchema {
  name: string;
  slug: string;
  fields: FieldDefinition[];
}

const traverse = (typeof _traverse === 'function'
  ? _traverse
  : (_traverse as unknown as { default: typeof _traverse }).default);

// ─── File Ownership Contract ────────────────────────────────────────────────

const CMS_SCHEMA_RE = /^cms\/([a-z0-9][a-z0-9-_]*)\.schema\.json$/;
const CMS_DATA_RE = /^cms\/([a-z0-9][a-z0-9-_]*)\.json$/;

const DESIGN_TOP_DIRS = new Set([
  ...ADDITIONAL_SOURCE_DIRECTORIES,
  'app',
  'components',
  'i18n',
  'messages',
  'icons',
  'overrides',
  'plugins',
]);

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** `cms/<slug>.schema.json` → `<slug>`, else null. */
export function cmsSlugFromSchemaPath(relPath: string): string | null {
  const clean = normalizeRelPath(relPath);
  if (clean.includes('..')) return null;
  return CMS_SCHEMA_RE.exec(clean)?.[1] ?? null;
}

/** `cms/<slug>.json` (excluding `*.schema.json`) → `<slug>`, else null. */
export function cmsSlugFromDataPath(relPath: string): string | null {
  const clean = normalizeRelPath(relPath);
  if (clean.includes('..') || clean.endsWith('.schema.json')) return null;
  return CMS_DATA_RE.exec(clean)?.[1] ?? null;
}

export function isCmsSchemaPath(relPath: string): boolean {
  return cmsSlugFromSchemaPath(relPath) !== null;
}

/** True only for CMS item data files (`cms/<slug>.json`, never `*.schema.json`). */
export function isCmsDataPath(relPath: string): boolean {
  return cmsSlugFromDataPath(relPath) !== null;
}

/** True for managed project files owned by local design/schema authoring. */
export function isDesignManagedPath(relPath: string): boolean {
  const clean = normalizeRelPath(relPath);
  if (!clean || clean.includes('..')) return false;
  if (clean.split('/').some(part => part.startsWith('.'))) return false;
  if (PROJECT_CONFIG_FILES.has(clean)) return true;
  if (clean === 'cms/cms-types.d.ts' || isCmsSchemaPath(clean)) return true;
  if (clean.startsWith('cms/') || clean.startsWith('_meta/')) return false;
  const top = clean.split('/')[0] ?? '';
  return DESIGN_TOP_DIRS.has(top);
}

/**
 * Relative path INSIDE `sites/<id>/public/` (`uploads/a.png`, `media/b.jpg`,
 * `brand/media/c.jpg`). Content uploads/media belong to the CMS; everything
 * else in `public/` (`assets/`, `fonts/`, `workspace-fonts/`, brand SVGs)
 * belongs to local design.
 */
export function isContentPublicAssetPath(relUnderPublic: string): boolean {
  const clean = normalizeRelPath(relUnderPublic);
  if (!clean || clean.includes('..')) return false;
  if (clean.startsWith('uploads/') || clean.startsWith('media/')) return true;
  const parts = clean.split('/');
  return parts.length >= 3 && parts[1] === 'media';
}

export function isDesignPublicAssetPath(relUnderPublic: string): boolean {
  const clean = normalizeRelPath(relUnderPublic);
  if (!clean || clean.includes('..')) return false;
  return !isContentPublicAssetPath(clean);
}

// ─── Schema Map Helper ──────────────────────────────────────────────────────

export function parseSchemasFromFiles(files: Record<string, string>): {
  schemas: Map<string, CollectionSchema>;
  issues: CmsContractIssue[];
} {
  const schemas = new Map<string, CollectionSchema>();
  const issues: CmsContractIssue[] = [];
  for (const [rawPath, rawContent] of Object.entries(files)) {
    const slug = cmsSlugFromSchemaPath(rawPath);
    if (!slug) continue;
    try {
      const parsed = JSON.parse(rawContent) as CollectionSchema;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fields)) {
        issues.push({
          code: 'CMS_SCHEMA_INVALID',
          path: normalizeRelPath(rawPath),
          message: `${rawPath}: schema must be a JSON object with a "fields" array.`,
        });
        continue;
      }
      schemas.set(slug, { ...parsed, slug: parsed.slug || slug });
    } catch (err) {
      issues.push({
        code: 'CMS_SCHEMA_INVALID',
        path: normalizeRelPath(rawPath),
        message: `${rawPath}: invalid JSON (${err instanceof Error ? err.message : String(err)}).`,
      });
    }
  }
  return { schemas, issues };
}

// ─── Schema → TypeScript `.d.ts` Generator ──────────────────────────────────

function pascalSlug(slug: string): string {
  const base = slug
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
  return /^[0-9]/.test(base) ? `Cms${base}` : base || 'Collection';
}

function tsTypeForField(field: FieldDefinition): string {
  switch (field.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'tags':
    case 'multi-reference':
      return 'string[]';
    case 'enum':
      if (Array.isArray(field.options) && field.options.length > 0) {
        const literals = field.options.map((o) => JSON.stringify(String(o)));
        if (!field.required && !field.options.includes('')) literals.push('""');
        return literals.join(' | ');
      }
      return 'string';
    default:
      return 'string';
  }
}

/**
 * Emit `cms/cms-types.d.ts` from a site's `cms/*.schema.json` definitions.
 * Also augments `React.CSSProperties` so builder-emitted `--revyme-*` custom
 * properties typecheck cleanly under strict React 19 types.
 */
export function generateCmsTypesDts(
  schemasInput: ReadonlyMap<string, CollectionSchema> | Record<string, CollectionSchema>,
): string {
  const entries: Array<[string, CollectionSchema]> =
    schemasInput instanceof Map ? [...schemasInput.entries()] : Object.entries(schemasInput);
  entries.sort(([a], [b]) => a.localeCompare(b));

  const lines: string[] = [
    '// Generated from cms/*.schema.json — do not edit by hand.',
    '// Regenerated automatically when schemas change or via `npm run site:check`.',
    '',
    "import 'react';",
    '',
    "declare module 'react' {",
    '  interface CSSProperties {',
    '    [key: `--${string}`]: string | number | undefined;',
    '  }',
    '}',
    '',
    'export interface CmsItemSystemFields {',
    '  _id: string;',
    '  _slug: string;',
    "  _status?: 'published' | 'draft';",
    '  _layout?: string;',
    '  _publishAt?: string;',
    '  _createdAt?: string;',
    '  _updatedAt?: string;',
    '}',
    '',
  ];

  const registryProps: string[] = [];
  for (const [slug, schema] of entries) {
    const iface = `${pascalSlug(slug)}Item`;
    const propLines: string[] = [];
    const translatableLines: string[] = [];
    for (const field of schema.fields ?? []) {
      const tsType = tsTypeForField(field);
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.id) ? field.id : JSON.stringify(field.id);
      if (field.required) {
        propLines.push(`  ${key}: ${tsType};`);
      } else {
        propLines.push(`  ${key}?: ${tsType} | null;`);
      }
      if (tsType === 'string' || field.type === 'enum') {
        translatableLines.push(`    ${key}?: string;`);
      }
    }
    lines.push(`export interface ${iface} extends CmsItemSystemFields {`);
    lines.push(...propLines);
    if (translatableLines.length > 0) {
      lines.push('  _i18n?: Record<string, {');
      lines.push(...translatableLines);
      lines.push('  }>;');
    } else {
      lines.push('  _i18n?: Record<string, Record<string, string>>;');
    }
    lines.push('}');
    lines.push('');
    const slugKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(slug) ? slug : JSON.stringify(slug);
    registryProps.push(`  ${slugKey}: ${iface}[];`);
  }

  lines.push('export interface SiteCollections {');
  lines.push(...registryProps);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ─── Issues & Data ↔ Schema Validation ──────────────────────────────────────

export interface CmsContractIssue {
  code:
    | 'CMS_SCHEMA_INVALID'
    | 'CMS_SCHEMA_MISSING'
    | 'CMS_DATA_INVALID_JSON'
    | 'CMS_DATA_NOT_ARRAY'
    | 'CMS_ITEM_INVALID'
    | 'CMS_ITEM_ID_INVALID'
    | 'CMS_ITEM_ID_DUPLICATE'
    | 'CMS_ITEM_SLUG_INVALID'
    | 'CMS_ITEM_SLUG_DUPLICATE'
    | 'CMS_ITEM_FIELD_TYPE'
    | 'CMS_ITEM_ENUM_INVALID'
    | 'CMS_ITEM_REQUIRED_EMPTY'
    | 'CMS_UNKNOWN_FIELD'
    | 'CMS_SEO_UNKNOWN_FIELD';
  path: string;
  line?: number;
  elementId?: string;
  itemId?: string;
  fieldId?: string;
  message: string;
}

/** URL-safe single route segment (no `/`, `..`, whitespace, or control chars). */
const SAFE_ITEM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?$/i;

const STRING_FIELD_TYPES = new Set<FieldDefinition['type']>([
  'text',
  'textarea',
  'richtext',
  'date',
  'image',
  'file',
  'link',
  'url',
  'color',
  'enum',
  'slug',
  'reference',
]);

function isEmptyFieldValue(value: unknown, type: FieldDefinition['type']): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if ((type === 'tags' || type === 'multi-reference') && Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Validate a parsed collection array against its `CollectionSchema`.
 *
 * `required: true` is enforced on `_status === 'published'` items (the default
 * when `_status` is omitted), while `_status === 'draft'` items may keep empty
 * required fields while authors fill out a newly added row in CmsEditorOverlay.
 * Type, enum membership, `_id` uniqueness, and URL-safe `_slug` uniqueness hold
 * for EVERY item (drafts are included in `generateStaticParams`).
 */
export function validateCollectionItemsAgainstSchema(
  slug: string,
  schema: CollectionSchema,
  rawItems: unknown,
): CmsContractIssue[] {
  const filePath = `cms/${slug}.json`;
  if (!Array.isArray(rawItems)) {
    return [{
      code: 'CMS_DATA_NOT_ARRAY',
      path: filePath,
      message: `${filePath}: collection data must be a JSON array of items.`,
    }];
  }

  const issues: CmsContractIssue[] = [];
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const fields = Array.isArray(schema.fields) ? schema.fields : [];

  for (let idx = 0; idx < rawItems.length; idx++) {
    const row = rawItems[idx];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      issues.push({
        code: 'CMS_ITEM_INVALID',
        path: filePath,
        message: `${filePath}[${idx}]: each entry must be a JSON object.`,
      });
      continue;
    }
    const item = row as Record<string, unknown>;
    const rawId = typeof item._id === 'string' ? item._id.trim() : '';
    if (!rawId) {
      issues.push({
        code: 'CMS_ITEM_ID_INVALID',
        path: filePath,
        message: `${filePath}[${idx}]: item is missing a non-empty string "_id".`,
      });
    } else if (seenIds.has(rawId)) {
      issues.push({
        code: 'CMS_ITEM_ID_DUPLICATE',
        path: filePath,
        itemId: rawId,
        message: `${filePath}: duplicate item _id "${rawId}".`,
      });
    } else {
      seenIds.add(rawId);
    }

    const rawSlug = typeof item._slug === 'string' ? item._slug.trim() : '';
    if (!rawSlug || rawSlug.includes('..') || !SAFE_ITEM_SLUG_RE.test(rawSlug)) {
      issues.push({
        code: 'CMS_ITEM_SLUG_INVALID',
        path: filePath,
        itemId: rawId || undefined,
        message: `${filePath} (item "${rawId || idx}"): "_slug" must be a non-empty URL-safe segment (letters, digits, hyphens, underscores; got ${JSON.stringify(item._slug)}).`,
      });
    } else {
      const slugKey = rawSlug.toLowerCase();
      if (seenSlugs.has(slugKey)) {
        issues.push({
          code: 'CMS_ITEM_SLUG_DUPLICATE',
          path: filePath,
          itemId: rawId || undefined,
          message: `${filePath}: duplicate item _slug "${rawSlug}" — every item needs a unique slug for Next.js static routes.`,
        });
      } else {
        seenSlugs.add(slugKey);
      }
    }

    if (item._status !== undefined && item._status !== 'published' && item._status !== 'draft') {
      issues.push({
        code: 'CMS_ITEM_INVALID',
        path: filePath,
        itemId: rawId || undefined,
        message: `${filePath} (item "${rawId || rawSlug}"): "_status" must be "published" or "draft".`,
      });
    }
    const isPublished = (item._status ?? 'published') === 'published';

    for (const field of fields) {
      const val = item[field.id];
      if (val === undefined || val === null) {
        if (field.required && isPublished) {
          issues.push({
            code: 'CMS_ITEM_REQUIRED_EMPTY',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): required field "${field.name}" (${field.id}) is empty on a published item.`,
          });
        }
        continue;
      }

      if (STRING_FIELD_TYPES.has(field.type)) {
        if (typeof val !== 'string') {
          issues.push({
            code: 'CMS_ITEM_FIELD_TYPE',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): field "${field.id}" (${field.type}) must be a string, got ${typeof val}.`,
          });
          continue;
        }
        if (field.required && isPublished && val.trim() === '') {
          issues.push({
            code: 'CMS_ITEM_REQUIRED_EMPTY',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): required field "${field.name}" (${field.id}) cannot be blank on a published item.`,
          });
          continue;
        }
        if (
          field.type === 'enum' &&
          Array.isArray(field.options) &&
          field.options.length > 0 &&
          val !== '' &&
          !field.options.includes(val)
        ) {
          issues.push({
            code: 'CMS_ITEM_ENUM_INVALID',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): field "${field.id}" has value ${JSON.stringify(val)}, which is not in enum options [${field.options.map((o) => JSON.stringify(o)).join(', ')}].`,
          });
        }
      } else if (field.type === 'number') {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          issues.push({
            code: 'CMS_ITEM_FIELD_TYPE',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): field "${field.id}" (number) must be a finite number or null.`,
          });
        }
      } else if (field.type === 'boolean') {
        if (typeof val !== 'boolean') {
          issues.push({
            code: 'CMS_ITEM_FIELD_TYPE',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): field "${field.id}" (boolean) must be true or false.`,
          });
        }
      } else if (field.type === 'tags' || field.type === 'multi-reference') {
        if (!Array.isArray(val) || val.some((entry) => typeof entry !== 'string')) {
          issues.push({
            code: 'CMS_ITEM_FIELD_TYPE',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): field "${field.id}" (${field.type}) must be an array of strings.`,
          });
        } else if (field.required && isPublished && isEmptyFieldValue(val, field.type)) {
          issues.push({
            code: 'CMS_ITEM_REQUIRED_EMPTY',
            path: filePath,
            itemId: rawId || undefined,
            fieldId: field.id,
            message: `${filePath} (item "${rawSlug || rawId}"): required field "${field.name}" (${field.id}) must have at least one entry on a published item.`,
          });
        }
      }
    }
  }

  return issues;
}

/** Validate a map of `cms/<slug>.json` raw JSON strings against `schemas`. */
export function validateAllCmsDataFiles(
  cmsDataFiles: Record<string, string>,
  schemas: ReadonlyMap<string, CollectionSchema>,
): CmsContractIssue[] {
  const issues: CmsContractIssue[] = [];
  for (const [rawPath, content] of Object.entries(cmsDataFiles)) {
    const slug = cmsSlugFromDataPath(rawPath);
    if (!slug) continue;
    const schema = schemas.get(slug);
    if (!schema) {
      issues.push({
        code: 'CMS_SCHEMA_MISSING',
        path: `cms/${slug}.json`,
        message: `cms/${slug}.json has no matching cms/${slug}.schema.json.`,
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      issues.push({
        code: 'CMS_DATA_INVALID_JSON',
        path: `cms/${slug}.json`,
        message: `cms/${slug}.json is not valid JSON (${err instanceof Error ? err.message : String(err)}).`,
      });
      continue;
    }
    issues.push(...validateCollectionItemsAgainstSchema(slug, schema, parsed));
  }
  return issues;
}

// ─── Safe Schema Reconciliation (Design Push → Remote Content) ──────────────

/**
 * Reconcile remote `cms/<slug>.json` content when local schemas evolve:
 *   - Existing remote items and values are NEVER overwritten or deleted.
 *   - Brand-new collections absent on the server are seeded from `starterCmsFiles`
 *     (or `[]` when none is given).
 *   - Fields newly added to a schema that specify `defaultValue` (or `tags` → `[]`,
 *     required `boolean` → `false`) are backfilled ONLY on items where the key is
 *     currently `undefined`.
 *   - Finally, every collection is validated against the new schemas; any
 *     incompatibility (e.g. a narrowed enum or new required field without a
 *     default on an already-published item) is returned in `issues`.
 */
export function reconcileCmsDataWithSchemas(opts: {
  remoteCmsFiles: Record<string, string>;
  starterCmsFiles?: Record<string, string>;
  schemas: ReadonlyMap<string, CollectionSchema>;
}): {
  files: Record<string, string>;
  changedPaths: string[];
  issues: CmsContractIssue[];
} {
  const { remoteCmsFiles, starterCmsFiles = {}, schemas } = opts;
  const nextFiles: Record<string, string> = {};
  const changedPaths: string[] = [];

  for (const [rawPath, rawContent] of Object.entries(remoteCmsFiles)) {
    const slug = cmsSlugFromDataPath(rawPath);
    if (slug) nextFiles[`cms/${slug}.json`] = rawContent;
  }

  for (const [slug, schema] of schemas.entries()) {
    const dataPath = `cms/${slug}.json`;
    if (!(dataPath in nextFiles)) {
      const starter = starterCmsFiles[dataPath];
      nextFiles[dataPath] = typeof starter === 'string' && starter.trim() ? starter : '[]\n';
      changedPaths.push(dataPath);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(nextFiles[dataPath]!);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;

    let mutated = false;
    const updatedRows = parsed.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
      for (const field of schema.fields ?? []) {
        if (copy[field.id] !== undefined) continue;
        if (field.defaultValue !== undefined) {
          copy[field.id] = field.defaultValue;
          mutated = true;
        } else if (field.type === 'tags' || field.type === 'multi-reference') {
          copy[field.id] = [];
          mutated = true;
        } else if (field.type === 'boolean' && field.required) {
          copy[field.id] = false;
          mutated = true;
        }
      }
      return copy;
    });
    if (mutated) {
      nextFiles[dataPath] = JSON.stringify(updatedRows, null, 2) + '\n';
      changedPaths.push(dataPath);
    }
  }

  // Only validate collections governed by the current schemas (legacy orphan
  // data files on disk stay untouched on disk, never deleted).
  const scopedForValidation: Record<string, string> = {};
  for (const slug of schemas.keys()) {
    const p = `cms/${slug}.json`;
    if (p in nextFiles) scopedForValidation[p] = nextFiles[p]!;
  }
  const issues = validateAllCmsDataFiles(scopedForValidation, schemas);
  return { files: nextFiles, changedPaths, issues };
}

// ─── AST View ↔ Schema Validation ───────────────────────────────────────────

const SYSTEM_ITEM_FIELDS = new Set([
  '_id',
  '_slug',
  '_status',
  '_layout',
  '_publishAt',
  '_createdAt',
  '_updatedAt',
  '_i18n',
]);

export interface CmsViewBindingIssue {
  code: 'CMS_UNKNOWN_FIELD' | 'CMS_SCHEMA_MISSING';
  line?: number;
  elementId?: string;
  collection: string;
  fieldId?: string;
  message: string;
}

/**
 * Unwrap a CMS chain head (`entries`, `entries.filter(...).sort(...).slice(...)`,
 * `localizeRows(entries, locale)`, `__applyListConfig(entries, cfg)`) back to
 * its imported collection slug, or null when the expression is not a CMS chain.
 */
function resolveCollectionSlugFromChain(
  node: t.Node | null | undefined,
  importVarToSlug: ReadonlyMap<string, string>,
): string | null {
  let cur: t.Node | null | undefined = node;
  while (cur) {
    if (t.isIdentifier(cur)) {
      return importVarToSlug.get(cur.name) ?? null;
    }
    if (t.isParenthesizedExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (t.isTSAsExpression(cur) || t.isTSNonNullExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (t.isCallExpression(cur)) {
      if (
        t.isIdentifier(cur.callee) &&
        (cur.callee.name === 'localizeRows' || cur.callee.name === '__applyListConfig')
      ) {
        cur = cur.arguments[0] ?? null;
        continue;
      }
      if (
        t.isMemberExpression(cur.callee) &&
        t.isIdentifier(cur.callee.property) &&
        (cur.callee.property.name === 'filter' ||
          cur.callee.property.name === 'sort' ||
          cur.callee.property.name === 'slice' ||
          cur.callee.property.name === 'find' ||
          cur.callee.property.name === 'findIndex')
      ) {
        cur = cur.callee.object;
        continue;
      }
    }
    return null;
  }
  return null;
}

function nearestJsxDataId(path: NodePath): string | undefined {
  let p: NodePath | null = path;
  while (p) {
    if (p.isJSXElement()) {
      for (const attr of p.node.openingElement.attributes) {
        if (
          t.isJSXAttribute(attr) &&
          t.isJSXIdentifier(attr.name, { name: 'data-id' }) &&
          t.isStringLiteral(attr.value)
        ) {
          return attr.value.value;
        }
      }
    }
    p = p.parentPath;
  }
  return undefined;
}

/**
 * Inspect a parsed TSX file (`page.client.tsx`, `LayoutClient.tsx`, or
 * `components/*.tsx`) and verify that every `item.<field>` / `item['<field>']`
 * read on a CMS item variable (`map`, `filter`, `sort`, `find`, or `@cmsPage`
 * detail lookup) exists in `cms/<slug>.schema.json`.
 */
export function checkCmsViewBindingsInAst(
  code: string,
  ast: t.File,
  schemas: ReadonlyMap<string, CollectionSchema>,
  opts: { requireSchema?: boolean } = {},
): CmsViewBindingIssue[] {
  const { requireSchema = true } = opts;
  const issues: CmsViewBindingIssue[] = [];
  const importVarToSlug = new Map<string, string>();

  for (const stmt of ast.program.body) {
    if (!t.isImportDeclaration(stmt)) continue;
    const m = /^@\/cms\/([a-z0-9][a-z0-9-_]*)\.json$/.exec(stmt.source.value);
    if (!m) continue;
    const slug = m[1]!;
    for (const spec of stmt.specifiers) {
      if (t.isImportDefaultSpecifier(spec)) {
        importVarToSlug.set(spec.local.name, slug);
      }
    }
    if (requireSchema && !schemas.has(slug)) {
      issues.push({
        code: 'CMS_SCHEMA_MISSING',
        line: stmt.loc?.start.line,
        collection: slug,
        message: `Imports '@/cms/${slug}.json' but cms/${slug}.schema.json does not exist. Define the collection schema first.`,
      });
    }
  }

  if (importVarToSlug.size === 0) return issues;

  // `@cmsPage { "collection": "<slug>", "kind": "detail" }` binds top-level `item`
  // (or `const <var> = <col>.find(...)`).
  const cmsPageMatch = code.match(/\/\*\*\s*@cmsPage\s*(\{[\s\S]*?\})\s*\*\//);
  let detailSlugFromMeta: string | null = null;
  if (cmsPageMatch) {
    try {
      const parsed = JSON.parse(cmsPageMatch[1]!);
      if (parsed?.kind === 'detail' && typeof parsed.collection === 'string') {
        detailSlugFromMeta = parsed.collection;
      }
    } catch {
      // Malformed @cmsPage is handled by existing oracle checks.
    }
  }

  // Track lexical scopes of CMS item variables: stack of Map<varName, collectionSlug | null>.
  // `null` means a local parameter shadows an outer CMS variable with a non-CMS value.
  const scopeStack: Array<Map<string, string | null>> = [new Map()];
  if (detailSlugFromMeta && schemas.has(detailSlugFromMeta)) {
    scopeStack[0]!.set('item', detailSlugFromMeta);
  }

  const lookupCmsVar = (name: string): string | null => {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const frame = scopeStack[i]!;
      if (frame.has(name)) return frame.get(name) ?? null;
    }
    return null;
  };

  const seenReportKeys = new Set<string>();

  const callbackScopeFor = (fnPath: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>): Map<string, string | null> => {
    const frame = new Map<string, string | null>();
    // Mark all identifier params as shadowing outer CMS variables unless bound below.
    for (const param of fnPath.node.params) {
      if (t.isIdentifier(param)) frame.set(param.name, null);
    }
    const parent = fnPath.parentPath;
    if (
      parent?.isCallExpression() &&
      parent.node.arguments[0] === fnPath.node &&
      t.isMemberExpression(parent.node.callee) &&
      t.isIdentifier(parent.node.callee.property)
    ) {
      const method = parent.node.callee.property.name;
      const slug = resolveCollectionSlugFromChain(parent.node.callee.object, importVarToSlug);
      if (slug && schemas.has(slug)) {
        if (method === 'map' || method === 'filter' || method === 'find' || method === 'findIndex') {
          const first = fnPath.node.params[0];
          if (t.isIdentifier(first)) frame.set(first.name, slug);
        } else if (method === 'sort') {
          const p0 = fnPath.node.params[0];
          const p1 = fnPath.node.params[1];
          if (t.isIdentifier(p0)) frame.set(p0.name, slug);
          if (t.isIdentifier(p1)) frame.set(p1.name, slug);
        }
      }
    }
    return frame;
  };

  traverse(ast, {
    VariableDeclarator(p) {
      // `const item = pieces.find(...) ?? pieces[0] ?? ...`
      if (!t.isIdentifier(p.node.id) || !p.node.init) return;
      let head: t.Node = p.node.init;
      while (t.isLogicalExpression(head) && (head.operator === '??' || head.operator === '||')) {
        head = head.left;
      }
      if (t.isTSAsExpression(head)) head = head.expression;
      const slug = resolveCollectionSlugFromChain(head, importVarToSlug);
      if (slug && schemas.has(slug)) {
        scopeStack[scopeStack.length - 1]!.set(p.node.id.name, slug);
      }
    },
    ArrowFunctionExpression: {
      enter(p) {
        scopeStack.push(callbackScopeFor(p));
      },
      exit() {
        scopeStack.pop();
      },
    },
    FunctionExpression: {
      enter(p) {
        scopeStack.push(callbackScopeFor(p));
      },
      exit() {
        scopeStack.pop();
      },
    },
    MemberExpression(p) {
      checkMember(p, p.node.object, p.node.property, p.node.computed);
    },
    OptionalMemberExpression(p) {
      checkMember(p, p.node.object, p.node.property, p.node.computed);
    },
  });

  function checkMember(
    p: NodePath,
    obj: t.Expression | t.V8IntrinsicIdentifier,
    prop: t.Expression | t.PrivateName,
    computed: boolean,
  ): void {
    if (!t.isIdentifier(obj)) return;
    const slug = lookupCmsVar(obj.name);
    if (!slug) return;
    const schema = schemas.get(slug);
    if (!schema) return;

    let fieldId: string | null = null;
    if (!computed && t.isIdentifier(prop)) {
      fieldId = prop.name;
    } else if (computed && t.isStringLiteral(prop)) {
      fieldId = prop.value;
    }
    if (!fieldId) return;
    if (SYSTEM_ITEM_FIELDS.has(fieldId)) return;
    // Ignore standard JS prototype methods if called (`item.toString()`).
    if (
      (fieldId === 'toString' || fieldId === 'valueOf' || fieldId === 'hasOwnProperty') &&
      p.parentPath?.isCallExpression() &&
      p.parentPath.node.callee === p.node
    ) {
      return;
    }

    const validIds = new Set((schema.fields ?? []).map((f) => f.id));
    if (validIds.has(fieldId)) return;

    const line = prop.loc?.start.line ?? obj.loc?.start.line;
    const elId = nearestJsxDataId(p);
    const dedup = `${slug}::${fieldId}::${line ?? 0}`;
    if (seenReportKeys.has(dedup)) return;
    seenReportKeys.add(dedup);

    const available = [...validIds].join(', ') || '(none)';
    issues.push({
      code: 'CMS_UNKNOWN_FIELD',
      line,
      elementId: elId,
      collection: slug,
      fieldId,
      message: `"${obj.name}.${fieldId}"${line ? ` (line ${line})` : ''} reads a field that does not exist in cms/${slug}.schema.json. Available fields on "${slug}": ${available} (plus system fields _id, _slug, _status). Update the binding or add "${fieldId}" to cms/${slug}.schema.json first.`,
    });
  }

  return issues;
}

const IMAGE_SLOT_KEYS = new Set(['ogImage', 'twitterImage']);
const IMAGE_FIELD_TYPES = new Set<FieldDefinition['type']>(['image', 'file']);
const TEXT_SEO_FIELD_TYPES = new Set<FieldDefinition['type']>(['text', 'textarea', 'richtext', 'slug']);

/** Validate `seoBindings` in a detail server `app/** /page.tsx` against `schemas`. */
function validateServerWrapperSeoBindings(
  code: string,
  filePath: string,
  schemas: ReadonlyMap<string, CollectionSchema>,
): CmsContractIssue[] {
  const colMatch = /from\s+['"]@\/cms\/([a-z0-9][a-z0-9-_]*)\.json['"]/.exec(code);
  if (!colMatch) return [];
  const slug = colMatch[1]!;
  const schema = schemas.get(slug);
  if (!schema) {
    return [{
      code: 'CMS_SCHEMA_MISSING',
      path: filePath,
      message: `${filePath}: imports '@/cms/${slug}.json' but cms/${slug}.schema.json is missing.`,
    }];
  }
  const bindingsMatch = /\bconst\s+seoBindings(?:\s*:[^=]+)?\s*=\s*(\{[^}]*\})/.exec(code);
  if (!bindingsMatch) return [];

  const issues: CmsContractIssue[] = [];
  const fieldById = new Map((schema.fields ?? []).map((f) => [f.id, f]));
  for (const m of bindingsMatch[1]!.matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) {
    const slot = m[1]!;
    const fieldId = m[2]!;
    if (SYSTEM_ITEM_FIELDS.has(fieldId)) continue;
    const field = fieldById.get(fieldId);
    if (!field) {
      issues.push({
        code: 'CMS_SEO_UNKNOWN_FIELD',
        path: filePath,
        fieldId,
        message: `${filePath}: seoBindings.${slot} references "${fieldId}", which does not exist in cms/${slug}.schema.json.`,
      });
      continue;
    }
    const wantImage = IMAGE_SLOT_KEYS.has(slot);
    if (wantImage && !IMAGE_FIELD_TYPES.has(field.type)) {
      issues.push({
        code: 'CMS_SEO_UNKNOWN_FIELD',
        path: filePath,
        fieldId,
        message: `${filePath}: seoBindings.${slot} points to "${fieldId}" (${field.type}), which is not an image/file field.`,
      });
    } else if (!wantImage && !TEXT_SEO_FIELD_TYPES.has(field.type)) {
      issues.push({
        code: 'CMS_SEO_UNKNOWN_FIELD',
        path: filePath,
        fieldId,
        message: `${filePath}: seoBindings.${slot} points to "${fieldId}" (${field.type}), which is not a text field.`,
      });
    }
  }
  return issues;
}

/** Validate all view files (`app/**` and `components/**`) against `schemas`. */
export function validateSiteViewsAgainstSchemas(
  files: Record<string, string>,
  schemas: ReadonlyMap<string, CollectionSchema>,
): CmsContractIssue[] {
  const issues: CmsContractIssue[] = [];
  for (const [rawPath, code] of Object.entries(files)) {
    const filePath = normalizeRelPath(rawPath);
    if (filePath.startsWith('app/') && filePath.endsWith('/page.tsx') || filePath === 'app/page.tsx') {
      issues.push(...validateServerWrapperSeoBindings(code, filePath, schemas));
      continue;
    }
    const isSurface =
      (filePath.startsWith('app/') && (filePath.endsWith('page.client.tsx') || filePath.endsWith('LayoutClient.tsx'))) ||
      (filePath.startsWith('components/') && filePath.endsWith('.tsx'));
    if (!isSurface) continue;
    let ast: t.File;
    try {
      ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch {
      continue;
    }
    for (const v of checkCmsViewBindingsInAst(code, ast, schemas)) {
      issues.push({
        code: v.code,
        path: filePath,
        line: v.line,
        elementId: v.elementId,
        fieldId: v.fieldId,
        message: `${filePath}: ${v.message}`,
      });
    }
  }
  return issues;
}

/** Full site contract check over a `files` map (`cms/`, `app/`, `components/`). */
export function validateFullCmsSite(files: Record<string, string>): {
  schemas: Map<string, CollectionSchema>;
  issues: CmsContractIssue[];
} {
  const { schemas, issues } = parseSchemasFromFiles(files);
  const cmsDataFiles: Record<string, string> = {};
  for (const [p, content] of Object.entries(files)) {
    if (isCmsDataPath(p)) cmsDataFiles[normalizeRelPath(p)] = content;
  }
  issues.push(...validateAllCmsDataFiles(cmsDataFiles, schemas));
  issues.push(...validateSiteViewsAgainstSchemas(files, schemas));
  return { schemas, issues };
}
