// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const sites = path.join(repo, 'sites');
let site = '', temp = '', workspaceFont = '', createdFontsDir = false, createdWorkspaceDir = false;
function put(base: string, relative: string, data: string | Uint8Array) {
  const target = path.join(base, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}
afterEach(() => {
  if (site) fs.rmSync(site, { recursive: true, force: true });
  if (workspaceFont) fs.rmSync(workspaceFont, { force: true });
  if (createdFontsDir) fs.rmdirSync(path.dirname(workspaceFont));
  if (createdWorkspaceDir) fs.rmdirSync(path.dirname(path.dirname(workspaceFont)));
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  site = temp = workspaceFont = ''; createdFontsDir = createdWorkspaceDir = false;
});

it('exports local and workspace assets, runnable config and published CMS without changing source or including private files', async () => {
  site = path.join(sites, `export-fixture-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(site);
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-cli-export-'));
  const id = path.basename(site), output = path.join(temp, 'output');
  const fontName = `export-${crypto.randomBytes(8).toString('hex')}.woff2`;
  const workspaceDir = path.join(sites, '.workspace'), fontsDir = path.join(workspaceDir, 'fonts');
  createdWorkspaceDir = !fs.existsSync(workspaceDir); createdFontsDir = !fs.existsSync(fontsDir);
  workspaceFont = path.join(fontsDir, fontName);
  put(fontsDir, fontName, Uint8Array.from([11, 22, 33]));
  put(site, '_revyme/project-meta.json', '{"id":"fixture"}');
  put(site, '_meta/private.json', 'private-metadata');
  put(site, '.env.local', 'SECRET=fixture');
  put(site, 'app/page.tsx', "import { schema } from '@/lib/schema'; export default function Page() { return JSON.stringify(schema); }\n");
  put(site, 'app/globals.css', `@font-face { font-family: Fixture; src: url('/workspace-fonts/${fontName}') }\n@font-face { font-family: Existing; src: url('/workspace-fonts/already-local.woff2') }`);
  put(site, 'lib/schema.ts', "export const schema = { '@type': 'Organization' };\n");
  put(site, 'lib/redirects.mjs', "export const redirects = () => [{ source: '/old', destination: '/new', permanent: true }];\n");
  put(site, 'next.config.mjs', "import { redirects } from './lib/redirects.mjs'; export default { redirects };\n");
  put(site, 'public/fonts/local.woff2', Uint8Array.from([9, 8, 7]));
  put(site, 'public/workspace-fonts/already-local.woff2', Uint8Array.from([4, 5, 6]));
  put(site, 'public/assets/picture.bin', Uint8Array.from([0, 128, 255]));
  const cms = '[{"_id":"a","_status":"published"},{"_id":"b","_status":"draft","title":"private draft"}]';
  put(site, 'cms/posts.json', cms);
  const result = spawnSync(process.execPath, ['server/export-site-source.mjs', id, output], { cwd: repo, encoding: 'utf8', timeout: 30000 });
  expect(result.status, result.stderr).toBe(0);
  const read = (file: string) => fs.readFileSync(path.join(output, file));
  expect(read(`public/workspace-fonts/${fontName}`)).toEqual(Buffer.from([11, 22, 33]));
  expect(read('public/workspace-fonts/already-local.woff2')).toEqual(Buffer.from([4, 5, 6]));
  expect(read('public/fonts/local.woff2')).toEqual(Buffer.from([9, 8, 7]));
  expect(read('public/assets/picture.bin')).toEqual(Buffer.from([0, 128, 255]));
  expect(read('lib/schema.ts').toString()).toContain('Organization');
  expect((await import(pathToFileURL(path.join(output, 'next.config.mjs')).href)).default.redirects()).toEqual([{ source: '/old', destination: '/new', permanent: true }]);
  expect(read('cms/posts.json').toString()).not.toContain('private draft');
  expect(fs.readFileSync(path.join(site, 'cms/posts.json'), 'utf8')).toBe(cms);
  for (const file of ['.env.local', '_meta/private.json', '_revyme/project-meta.json']) expect(fs.existsSync(path.join(output, file))).toBe(false);
}, 30000);
