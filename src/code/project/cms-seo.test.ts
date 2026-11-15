import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import * as ts from 'typescript';
import {
  buildCmsDetailServerWrapper,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  hasCmsSeo,
  bindableFields,
  defaultBindings,
  wrapperCollection,
} from './cms-seo';
import { parseMetadataFromCode } from '../generation/metadata-gen';
import type { CollectionSchema } from '@/shared/types';

const SCHEMA: CollectionSchema = {
  name: 'Articles',
  slug: 'articles',
  fields: [
    { id: 'cover', name: 'Cover', type: 'image' },
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'excerpt', name: 'Excerpt', type: 'textarea' },
    { id: 'views', name: 'Views', type: 'number' },
    { id: 'live', name: 'Live', type: 'boolean' },
  ],
};

const ITEMS = [
  { _slug: 'first', name: 'First Post', excerpt: 'About the first', cover: 'https://cdn/a.png' },
  { _slug: 'second', name: 'Second Post', excerpt: '', cover: '' },
];

/**
 * Run the emitted `generateMetadata` for real.
 *
 * Server wrappers get no FileKind, so the oracle never sees this file and it
 * ships to production verbatim — executing it here is the only gate it has.
 */
async function runGenerateMetadata(src: string, items: unknown[] | null, slug: string) {
  // The collection arrives through an import, which `new Function` cannot
  // resolve — bind that identifier to the test data instead.
  const importVar = /^import (\w+) from ['"]@\/cms\//m.exec(src)?.[1];
  if (!importVar) throw new Error('wrapper has no collection import');
  // Stop before generateStaticParams: that export is not part of the metadata
  // body, and `new Function` cannot parse an `export` keyword.
  const body = src
    .slice(src.indexOf('const seoDefaults'), src.indexOf('export function generateStaticParams'))
    .replace('export async function', 'async function')
    // A distinct name: the emitted code declares its own `items`, so reusing
    // that identifier would shadow the injection and throw on its own TDZ.
    .replace(new RegExp(`\\b${importVar}\\b`, 'g'), '__cmsData');
  const factory = new Function('__cmsData', `${body}\nreturn generateMetadata;`);
  const fn = factory(items) as (a: { params: unknown }) => Promise<Record<string, any>>;
  // vinext passes params as a THENABLE, matching Next 15 — the emitted code
  // must await it, so hand it a promise rather than a plain object.
  return fn({ params: Promise.resolve({ slug }) });
}

describe('buildCmsDetailServerWrapper', () => {
  const src = buildCmsDetailServerWrapper({
    collection: 'articles',
    defaults: { title: 'Articles', twitterCard: 'summary_large_image' },
    bindings: { title: 'name', description: 'excerpt', ogImage: 'cover' },
  });

  it('emits a module that parses', () => {
    expect(() => parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('exports generateMetadata and NOT a metadata const', () => {
    // Exporting both is a Next.js build error ("Cannot define both"), and
    // vinext silently prefers the function — so the panel's static values
    // would look saved and never render.
    expect(hasCmsSeo(src)).toBe(true);
    expect(src).not.toMatch(/export\s+const\s+metadata/);
    expect(src).toMatch(/const seoDefaults =/);
  });

  it('resolves the bound fields for the requested item', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'first');
    expect(meta.title).toBe('First Post');
    expect(meta.description).toBe('About the first');
    expect(meta.openGraph.images).toEqual(['https://cdn/a.png']);
  });

  it('gives each item its OWN title — the whole point', async () => {
    const a = await runGenerateMetadata(src, ITEMS, 'first');
    const b = await runGenerateMetadata(src, ITEMS, 'second');
    expect(a.title).toBe('First Post');
    expect(b.title).toBe('Second Post');
  });

  it('falls back to the static default when the item field is empty', async () => {
    // 'second' has an empty excerpt and no cover.
    const meta = await runGenerateMetadata(src, ITEMS, 'second');
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph.images).toEqual([]);
    expect(meta.twitter.card).toBe('summary_large_image');
  });

  it('falls back to the static title for an unknown slug', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'nope');
    expect(meta.title).toBe('Articles');
  });

  it('survives a collection file that is not an array', async () => {
    // Imported / hand-edited cms JSON is never validated on read, and this
    // file has no oracle behind it — a throw here would 500 the route.
    const meta = await runGenerateMetadata(src, null as never, 'first');
    expect(meta.title).toBe('Articles');
  });

  it('OG and Twitter inherit the resolved title when unbound', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'first');
    expect(meta.openGraph.title).toBe('First Post');
    expect(meta.twitter.title).toBe('First Post');
    // Twitter image falls back to the OG image rather than going blank.
    expect(meta.twitter.image).toBe('https://cdn/a.png');
  });

  it('round-trips its bindings and defaults', () => {
    expect(parseCmsSeoBindings(src)).toEqual({ title: 'name', description: 'excerpt', ogImage: 'cover' });
    expect(parseCmsSeoDefaults(src)).toMatchObject({ title: 'Articles', twitterCard: 'summary_large_image' });
    expect(wrapperCollection(src)).toBe('articles');
  });

  it('round-trips values containing quotes and braces', () => {
    const tricky = buildCmsDetailServerWrapper({
      collection: 'articles',
      defaults: { title: `It's a "test" }; export const metadata = {` },
    });
    expect(() => parse(tricky, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(parseCmsSeoDefaults(tricky).title).toBe(`It's a "test" }; export const metadata = {`);
  });

  it('handles a digit-leading collection slug', () => {
    const src2 = buildCmsDetailServerWrapper({ collection: '2023-recap' });
    expect(() => parse(src2, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(src2).toMatch(/import cms2023Recap from '@\/cms\/2023-recap\.json'/);
  });
});

describe('field offering', () => {
  it('offers text fields for text slots and images for image slots', () => {
    expect(bindableFields(SCHEMA, 'title').map((f) => f.id)).toEqual(['name', 'excerpt']);
    // Pointing og:image at a text field produces a broken card, silently.
    expect(bindableFields(SCHEMA, 'ogImage').map((f) => f.id)).toEqual(['cover']);
    expect(bindableFields(null, 'title')).toEqual([]);
  });

  it('seeds a new page with usable bindings', () => {
    expect(defaultBindings(SCHEMA)).toEqual({ title: 'name', description: 'excerpt', ogImage: 'cover' });
    expect(defaultBindings(null)).toEqual({});
  });
});

// ─── Migration from a legacy detail wrapper ─────────────────────────────────
//
// Detail pages created before per-item SEO carry the plain server wrapper
// with `export const metadata = {}`. The panel reads those through the old
// path and the first save replaces the file — the dangerous case, because
// patching instead would leave BOTH exports in one module.

describe('legacy wrapper migration', () => {
  const LEGACY = `import PageClient from './page.client';

export const metadata = { title: 'Blog', description: 'All posts' };

export default function Page() {
  return <PageClient />;
}
`;

  it('the legacy wrapper has no per-item SEO', () => {
    expect(hasCmsSeo(LEGACY)).toBe(false);
    expect(parseCmsSeoBindings(LEGACY)).toEqual({});
  });

  it('regenerating carries the old values over as fallbacks', () => {
    const old = parseMetadataFromCode(LEGACY);
    const next = buildCmsDetailServerWrapper({
      collection: 'articles',
      defaults: { title: old.title, description: old.description },
      bindings: { title: 'name' },
    });
    expect(parseCmsSeoDefaults(next)).toMatchObject({ title: 'Blog', description: 'All posts' });
    // …and the old export is gone, so the module has one metadata source.
    expect(next).not.toMatch(/export\s+const\s+metadata/);
    expect((next.match(/export\s+(async\s+function\s+generateMetadata|const\s+metadata)/g) ?? []).length).toBe(1);
  });
});

// ─── Static params for the detail route ─────────────────────────────────────
//
// A detail page mounted at the site root answers every unknown top-level URL.
// The client falls back to `items[0]`, so `/anything` would render the first
// item instead of a 404. `generateStaticParams` + `dynamicParams = false` make
// Next serve only real items.

/** Top-level export names, in source order. */
function exportOrder(src: string): string[] {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const names: string[] = [];
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') names.push('default');
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
    const d = node.declaration;
    if (d.type === 'FunctionDeclaration' && d.id) names.push(d.id.name);
    if (d.type === 'VariableDeclaration') {
      const id = d.declarations[0]?.id;
      if (id?.type === 'Identifier') names.push(id.name);
    }
  }
  return names;
}

/** Extract the emitted `generateStaticParams` and evaluate it for real, with
 *  the collection import bound to `items`. */
function runGenerateStaticParams(src: string, items: unknown): Array<Record<string, unknown>> {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const decl = ast.program.body.find(
    (n) => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration'
      && n.declaration.id?.name === 'generateStaticParams',
  );
  if (!decl || decl.type !== 'ExportNamedDeclaration' || decl.declaration?.type !== 'FunctionDeclaration') {
    throw new Error('wrapper has no generateStaticParams');
  }
  const importVar = /^import (\w+) from ['"]@\/cms\//m.exec(src)?.[1];
  if (!importVar) throw new Error('wrapper has no collection import');
  const fnSrc = src.slice(decl.declaration.start!, decl.declaration.end!);
  const js = ts.transpileModule(fnSrc, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const factory = new Function(importVar, `${js}\nreturn generateStaticParams;`);
  const fn = factory(items) as () => Array<Record<string, unknown>>;
  return fn();
}

describe('buildCmsDetailServerWrapper — static params', () => {
  const src = buildCmsDetailServerWrapper({
    collection: 'articles',
    defaults: { title: 'Articles' },
    bindings: { title: 'name' },
  });

  // S1 — the emitted exports exist with the agreed shape.
  it('emits generateStaticParams over the collection and dynamicParams = false', () => {
    expect(src).toMatch(/export function generateStaticParams\(\) \{/);
    expect(src).toMatch(/\.filter\(\(i\) => i && typeof i\._slug === 'string' && i\._slug !== ''\)/);
    expect(src).toMatch(/\.map\(\(i\) => \(\{ slug: i\._slug \}\)\)/);
    expect(src).toMatch(/export const dynamicParams = false;/);
  });

  // S2 — still valid TSX, and the exports come in the required order.
  it('parses, and orders generateMetadata, generateStaticParams, dynamicParams, default', () => {
    expect(() => parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(exportOrder(src)).toEqual(['generateMetadata', 'generateStaticParams', 'dynamicParams', 'default']);
  });

  // S3 — evaluate the emitted function against sample data.
  // Drafts get a route: collection lists show every item (nothing filters on `_status`), so a
  // draft excluded here would be a card on the site whose link 404s (review finding, 2026-11-13).
  it('returns a slug for every item a list can show, drafts included; skips empty slugs and nulls', () => {
    const items = [
      { _slug: 'a' },
      { _slug: 'b', _status: 'draft' },
      { _slug: '' },
      null,
      { _slug: 'c', _status: 'published' },
    ];
    expect(runGenerateStaticParams(src, items)).toEqual([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]);
  });

  it('returns no params when the collection file is not an array', () => {
    // Same defensive contract as generateMetadata: a malformed cms/*.json
    // must not throw during the build.
    expect(runGenerateStaticParams(src, null)).toEqual([]);
  });

  it('keeps the route param key aligned with generateMetadata (`slug`)', () => {
    expect(src).toMatch(/resolved\?\.slug/);
    expect(runGenerateStaticParams(src, [{ _slug: 'a' }])[0]).toHaveProperty('slug', 'a');
  });
});
