// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isManagedProjectPath, readSiteProject, readSiteMeta, writeSiteCmsContent, writeSiteProject } from './sites-plugin';
import { buildSourceExport } from '../code/project/source-export';
import { InMemoryProjectFS } from '../code/project/project-fs';
import { isDesignManagedPath } from '../shared/cms-site-contract';

let root: string, sitesRoot: string, site: string;
const page = "import { schema } from '@/lib/schema';\nexport default function Page() { return JSON.stringify(schema); }\n";
const schema = "export const schema = { '@type': 'Organization' };\n";
const redirects = "export async function redirects() { return [{ source: '/old', destination: '/new', permanent: true }]; }\n";
const config = "import { redirects } from './lib/redirects';\nexport default { redirects };\n";
function put(file: string, content: string) { const dest = path.join(site, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content); }
function get(file: string) { return fs.readFileSync(path.join(site, file), 'utf8'); }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-project-files-'));
  sitesRoot = path.join(root, 'sites'); site = path.join(sitesRoot, 'sample');
  put('app/page.tsx', page); put('lib/schema.ts', schema); put('lib/redirects.ts', redirects); put('next.config.ts', config);
  put('_revyme/project-meta.json', JSON.stringify({ id: 'sample', name: 'Sample', format: 'revyme-v1', managedFiles: ['app/page.tsx'] }));
  put('.env.local', 'SECRET=never-manage');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('site project files', () => {
  it('loads library and supported Next config with the project and exports their imports intact', async () => {
    const project = readSiteProject(sitesRoot, 'sample')!.project;
    expect(project.files).toMatchObject({ 'app/page.tsx': page, 'lib/schema.ts': schema, 'lib/redirects.ts': redirects, 'next.config.ts': config });
    expect(project.files['.env.local']).toBeUndefined();
    const exported = await buildSourceExport(project.files, { name: 'Sample', runtimeRange: '^1' });
    expect(exported.files).toMatchObject({ 'app/page.tsx': page, 'lib/schema.ts': schema, 'lib/redirects.ts': redirects, 'next.config.ts': config });
    expect(exported.files['next.config.mjs']).toBeUndefined();
    expect(exported.files['.env.local']).toBeUndefined();
  });

  it('protects new managed files when an already-open older snapshot is saved', () => {
    writeSiteProject(sitesRoot, 'sample', { format: 'revyme-v1', files: { 'app/page.tsx': page + '// old tab edit\n' } }, '^1');
    expect(get('app/page.tsx')).toContain('old tab edit');
    expect(get('lib/schema.ts')).toBe(schema);
    expect(get('lib/redirects.ts')).toBe(redirects);
    expect(get('next.config.ts')).toBe(config);
    expect(fs.existsSync(path.join(site, 'next.config.mjs'))).toBe(false);
    expect(get('.env.local')).toBe('SECRET=never-manage');
    expect(readSiteMeta(site, 'sample').managedFiles).toEqual(expect.arrayContaining(['app/page.tsx', 'lib/schema.ts', 'lib/redirects.ts', 'next.config.ts']));
  });

  it('allows informed deletion yet protects files from an older tab even after a newer tab saves', () => {
    put('lib/obsolete.ts', 'export const obsolete = true;');
    const fresh = readSiteProject(sitesRoot, 'sample')!.project;
    expect(JSON.parse(fresh.files['_meta/source-file-contract.json'])).toMatchObject({ version: 1 });
    fresh.files['lib/schema.ts'] = "export const schema = { '@type': 'Organization', name: 'Updated' };\n";
    delete fresh.files['lib/obsolete.ts'];
    writeSiteProject(sitesRoot, 'sample', fresh, '^1');
    expect(fs.existsSync(path.join(site, 'lib/obsolete.ts'))).toBe(false);
    expect(get('lib/schema.ts')).toContain('Updated');

    // This tab was loaded before the extended file contract was introduced.
    writeSiteProject(sitesRoot, 'sample', { format: 'revyme-v1', files: { 'app/page.tsx': page + '// stale tab\n' } }, '^1');
    expect(get('lib/schema.ts')).toContain('Updated');
    expect(get('lib/redirects.ts')).toBe(redirects);
    expect(get('next.config.ts')).toBe(config);
    expect(get('app/page.tsx')).toContain('stale tab');
    expect(readSiteMeta(site, 'sample').managedFiles).toEqual(expect.arrayContaining(['lib/schema.ts', 'lib/redirects.ts', 'next.config.ts']));
  });

  it('retains the source contract through the editor project filesystem and excludes it from export', async () => {
    const loaded = readSiteProject(sitesRoot, 'sample')!.project;
    const editor = new InMemoryProjectFS(new Map());
    editor.loadSnapshot(new Map(Object.entries(loaded.files)));
    editor.createBranch('test');
    const envelope = editor.toEnvelope();
    expect(JSON.parse(envelope.files['_meta/source-file-contract.json'])).toMatchObject({ version: 1 });
    const exported = await buildSourceExport(envelope.files, { name: 'Sample', runtimeRange: '^1' });
    expect(exported.files['_meta/source-file-contract.json']).toBeUndefined();
  });

  it('rejects traversal, secret, binary and editor metadata paths', () => {
    for (const value of ['lib/../../outside.ts', '../lib/a.ts', '.env.local', '_revyme/project-meta.json', 'public/photo.png']) expect(isManagedProjectPath(value)).toBe(false);
  });

  it('keeps library and configs under design ownership during CMS-only writes', () => {
    for (const file of ['lib/schema.ts', 'src/helpers.ts', 'styles/theme.css', 'next.config.ts', 'package.json']) expect(isDesignManagedPath(file)).toBe(true);
    expect(isDesignManagedPath('cms/posts.json')).toBe(false);
    const result = writeSiteCmsContent(sitesRoot, 'sample', { 'lib/schema.ts': 'tampered', 'next.config.ts': 'tampered', 'app/page.tsx': 'tampered' });
    expect(result).toMatchObject({ fileCount: 0, writtenPaths: [], issues: [] });
    expect(get('lib/schema.ts')).toBe(schema);
    expect(get('next.config.ts')).toBe(config);
    expect(get('app/page.tsx')).toBe(page);
  });

  it('treats a corrupt or unknown source contract as an old snapshot', () => {
    for (const marker of ['{bad', '{"version":2}']) {
      writeSiteProject(sitesRoot, 'sample', { files: { 'app/page.tsx': page, '_meta/source-file-contract.json': marker } }, '^1');
      expect(get('lib/schema.ts')).toBe(schema);
      expect(get('next.config.ts')).toBe(config);
    }
  });

  it('keeps a runnable redirects config and JSON-LD helper through load and source export', async () => {
    fs.rmSync(path.join(site, 'next.config.ts'));
    const nextConfig = `import { readFileSync } from 'node:fs';\nimport { buildRedirects } from './lib/redirects.mjs';\nexport default { async redirects() { return buildRedirects(JSON.parse(readFileSync(new URL('./app/_redirects.json', import.meta.url), 'utf8'))); } };\n`;
    const helper = `export function buildRedirects(records) { return records.map(({from,to}) => ({source: from, destination: to, permanent: true})); }\n`;
    const records = '[{"from":"/old","to":"/new"}]';
    const jsonLd = `export const homeSchema = () => ({ '@type': 'Organization', name: 'REAL' });\n`;
    put('next.config.mjs', nextConfig); put('lib/redirects.mjs', helper); put('app/_redirects.json', records); put('lib/framer-schema.ts', jsonLd);
    const project = readSiteProject(sitesRoot, 'sample')!.project;
    const exported = await buildSourceExport(project.files, { name: 'Sample', runtimeRange: '^1' });
    expect(exported.files['lib/framer-schema.ts']).toBe(jsonLd);
    for (const file of ['next.config.mjs', 'lib/redirects.mjs', 'app/_redirects.json']) {
      expect(exported.files[file]).toBe(project.files[file]);
      const output = path.join(root, 'export', file); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, exported.files[file]);
    }
    const loaded = await import(pathToFileURL(path.join(root, 'export/next.config.mjs')).href);
    expect(await loaded.default.redirects()).toEqual([{ source: '/old', destination: '/new', permanent: true }]);
  });
});
