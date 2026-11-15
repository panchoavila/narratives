// static.ts — Serve a built directory (editor, canvas sandbox, preview
// sandbox). Paths are resolved inside the directory only; Vite's hashed
// `/assets/*` are cached for a year, everything else revalidates.

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MIME_TYPES } from '../src/server/sites-plugin';
import { pathnameOf } from './http';
import { trace } from './trace';

const EXTRA_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
};

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return EXTRA_TYPES[ext] ?? MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** Absolute file for a URL path inside `dir`, or null (outside, missing, not a file). */
export function resolveInside(dir: string, urlPath: string): string | null {
  const normalized = path.posix.normalize('/' + urlPath.replace(/\\/g, '/'));
  const abs = path.join(dir, normalized);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return null;
  try {
    const stat = fs.statSync(abs);
    if (stat.isFile()) return abs;
    if (stat.isDirectory()) {
      const index = path.join(abs, 'index.html');
      return fs.statSync(index).isFile() ? index : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, headers: Record<string, string> = {}): void {
  const urlPath = pathnameOf(req);
  res.statusCode = 200;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', contentType(file));
  res.setHeader('Cache-Control', urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', (error) => {
    trace.error('static:read', { file, error: error.message });
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

/** Serve `urlPath` from `dir`; false when there is no such file. */
export function serveFrom(req: IncomingMessage, res: ServerResponse, dir: string, headers: Record<string, string> = {}): boolean {
  const file = resolveInside(dir, pathnameOf(req));
  if (!file) return false;
  sendFile(req, res, file, headers);
  return true;
}
