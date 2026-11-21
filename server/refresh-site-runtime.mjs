#!/usr/bin/env node
// Materialize the same canonical runtime as the editor's source exporter; never maintain a fork.
import process from 'node:process';
import console from 'node:console';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteId = process.argv[2];
if (!siteId || !/^[a-z0-9][a-z0-9-_]*$/.test(siteId)) throw new Error('Usage: node server/refresh-site-runtime.mjs <site-id>');
const site = path.join(repo, 'sites', siteId);
await fs.access(path.join(site, '_revyme/project-meta.json'));
const server = await createServer({ configFile: false, cacheDir: "/tmp/revyme-framer-import-vite", root: repo, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(repo, 'src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const files = {};
  const read = async (dir, prefix) => {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory()) await read(path.join(dir, item.name), name + '/');
      else if (/\.(tsx?|jsx?|mjs|css|json)$/.test(item.name)) files[name] = await fs.readFile(path.join(dir, item.name), 'utf8');
    }
  };
  for (const dir of ['app', 'components', 'cms', 'i18n', 'messages', 'icons', 'overrides']) {
    try { await read(path.join(site, dir), dir + '/'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const file of ['package.json', 'tsconfig.json', 'next.config.mjs']) files[file] = await fs.readFile(path.join(site, file), 'utf8');
  const { buildSourceExport } = await server.ssrLoadModule('/src/code/project/source-export.ts');
  const result = await buildSourceExport(files, { name: siteId, runtimeRange: '^0.0.32' });
  // This directory is wholly generated; remove only files no longer present in
  // the canonical export (renamed declarations and old hashed chunks included).
  const prune = async (dir, prefix) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await prune(path.join(dir, entry.name), relative + '/');
      else if (!(relative in result.files)) await fs.unlink(path.join(dir, entry.name));
    }
  };
  await prune(path.join(site, 'vendor/revyme-runtime'), 'vendor/revyme-runtime/');
  let count = 0;
  for (const [file, source] of Object.entries(result.files)) {
    if (file !== 'package.json' && !file.startsWith('vendor/revyme-runtime/')) continue;
    const destination = path.join(site, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, source); count++;
  }
  console.log('Exported canonical runtime:', siteId, count, 'files');
} finally { await server.close(); }
