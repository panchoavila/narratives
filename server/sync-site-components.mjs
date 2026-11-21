#!/usr/bin/env node
// Materialize authoring adapters from the canonical Revyme source, not divergent copies.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [siteId, ...names] = process.argv.slice(2);
if (!siteId || !/^[a-z0-9][a-z0-9_-]*$/.test(siteId) || !names.length || names.some(n => !/^[A-Z][A-Za-z0-9]*$/.test(n))) throw new Error('Usage: sync-site-components <site> <Component> ...');
const site = path.join(root, 'sites', siteId);
await fs.access(path.join(site, '_revyme/project-meta.json'));
const server = await createServer({ configFile: false, cacheDir: '/tmp/revyme-site-adapters-vite', root,
  optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  await fs.mkdir(path.join(site, 'components'), { recursive: true });
  for (const name of names) {
    const module = await server.ssrLoadModule('/src/code/project/default-code-components/' + name + '.ts');
    const source = Object.values(module).find(value => typeof value === 'string' && value.includes('function ' + name + '('));
    if (typeof source !== 'string') throw new Error('No canonical adapter export for ' + name);
    await fs.writeFile(path.join(site, 'components', name + '.tsx'), source);
  }
} finally { await server.close(); }
