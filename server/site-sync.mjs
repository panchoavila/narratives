#!/usr/bin/env node
// site-sync.mjs — Bundles `src/server/site-cli.ts` with Rolldown (resolving `@/`
// aliases and TypeScript in ~150 ms) into `node_modules/.cache/` and executes
// it with the current CLI arguments.

import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'revyme-site-cli');
const outFile = path.join(cacheDir, 'site-cli.mjs');

fs.mkdirSync(cacheDir, { recursive: true });

const bundle = await rolldown({
  input: path.join(root, 'src', 'server', 'site-cli.ts'),
  platform: 'node',
  external: [
    /^node:/,
    /^@babel\//,
    'jotai',
    'react',
    'react-dom',
    'react-dom/server',
  ],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
});

await bundle.write({
  file: outFile,
  format: 'esm',
  banner: "import { createRequire as __cliCreateRequire } from 'node:module'; const require = __cliCreateRequire(import.meta.url); import.meta.env ??= { BASE_URL: '/' };",
});
await bundle.close();

const run = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, REVYME_SITE_CLI_RUN: '1' },
});

process.exit(run.status ?? 1);
