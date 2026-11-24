#!/usr/bin/env node
// narratives-mcp.mjs — starts the Narratives MCP server (stdio) for agents
// such as Claude Code: it reads hosted sites and writes branches, which the
// owner reviews and applies (src/server/narratives-mcp.ts). Bundles that
// module with Rolldown (resolving `@/` aliases and TypeScript) into
// node_modules/.cache/ and runs it with this process's stdin/stdout.
//
// MCP client configuration (from the repository root):
//   { "command": "node", "args": ["server/narratives-mcp.mjs"] }
// with CMS_URL and CMS_AGENT_TOKEN_<SITE> in the environment or .env.local.

import { rolldown } from 'rolldown';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'narratives-mcp');
const outFile = path.join(cacheDir, 'narratives-mcp.mjs');

fs.mkdirSync(cacheDir, { recursive: true });

const bundle = await rolldown({
  input: path.join(root, 'src', 'server', 'narratives-mcp.ts'),
  platform: 'node',
  external: [/^node:/, /^@babel\//, 'jotai', 'react', 'react-dom', 'react-dom/server'],
  resolve: { alias: { '@': path.join(root, 'src') } },
  // Bundler notes go to stderr: stdout belongs to the MCP protocol.
  onLog: (level, log) => process.stderr.write(`[narratives-mcp build] ${level}: ${log.message}\n`),
});
await bundle.write({
  file: outFile,
  format: 'esm',
  banner: "import { createRequire as __mcpCreateRequire } from 'node:module'; const require = __mcpCreateRequire(import.meta.url); import.meta.env ??= { BASE_URL: '/' };",
});
await bundle.close();

const child = spawn(process.execPath, [outFile], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, NARRATIVES_MCP_RUN: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
