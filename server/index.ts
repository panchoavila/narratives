// index.ts — Self-hosted collaboration server for the editor
// (briefs/13-11-2026-self-hosted-collab-backend.md).
//
// Three listeners, because the editor pins its canvas sandbox and preview to
// ports 5174/5175 on its own hostname (src/canvas-sandbox/protocol.ts,
// src/editor/header/PreviewOverlay.tsx). In production Caddy terminates TLS on
// 443/5174/5175 and forwards to these:
//   editor  (PORT_EDITOR)  editor build, /auth, /api, Socket.IO, site assets
//   sandbox (PORT_SANDBOX) canvas sandbox build + site assets
//   preview (PORT_PREVIEW) preview sandbox build + site assets
// Site assets are served only from the projects the signed-in user may open.

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { loadConfig } from './config';
import { Db, type UserRow } from './db';
import { Access } from './access';
import { createMailer } from './mail';
import { Auth } from './auth';
import { SiteLocks } from './site-locks';
import { Realtime } from './realtime';
import { Api } from './api';
import { resolveInside, sendFile, serveFrom } from './static';
import { pathnameOf, redirect, sendError } from './http';
import { createStaticAssetMiddleware } from '../src/server/sites-plugin';
import { trace } from './trace';

const config = loadConfig();
const db = new Db(path.join(config.dataDir, 'db.sqlite'));
const access = new Access(db, config);
access.admin();
access.syncFromDisk();
const auth = new Auth(config, db, createMailer(config), access);
const locks = new SiteLocks();

// One session lookup per request, shared by the asset filter's per-site checks.
const requestUsers = new WeakMap<IncomingMessage, UserRow | null>();
function userOf(req: IncomingMessage): UserRow | null {
  if (!requestUsers.has(req)) requestUsers.set(req, auth.userFor(req));
  return requestUsers.get(req) ?? null;
}

const siteAssets = createStaticAssetMiddleware(config.rootDir, {
  allowSite: (req, siteId) => !!access.roleFor(userOf(req), siteId),
});

function serveSiteAsset(req: IncomingMessage, res: ServerResponse): void {
  if (!userOf(req)) {
    sendError(res, 404, 'Not found');
    return;
  }
  siteAssets(req, res, () => sendError(res, 404, 'Not found'));
}

// The canvas iframe is `credentialless` (src/canvas/Canvas.tsx), so nothing it
// requests carries the session cookie and `serveSiteAsset` would 404 every
// image on the canvas. On the sandbox origin only, site `public/` files are
// served the way the local editor serves them: every site, no session. Owner's
// decision (15-11-2026): an unpublished project's public file is readable by
// anyone who knows its exact path. The editor and preview origins keep the
// per-member check.
const canvasAssets = createStaticAssetMiddleware(config.rootDir);
trace.action('server:canvas-assets', { sessionRequired: false, origin: 'sandbox' });

function serveCanvasAsset(req: IncomingMessage, res: ServerResponse): void {
  canvasAssets(req, res, () => sendError(res, 404, 'Not found'));
}

const editorDir = config.distDir;
const sandboxDir = path.join(config.distDir, 'sandbox');
const previewDir = path.join(config.distDir, 'preview-sandbox');
const isHtmlRoute = (p: string) => p === '/dashboard' || p === '/builder' || p.startsWith('/builder/');
const isInside = (file: string, dir: string) => file === dir || file.startsWith(dir + path.sep);

let api: Api;

async function handleEditor(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = pathnameOf(req);
  try {
    if (await auth.handle(req, res)) return;
    if (pathname.startsWith('/api/')) {
      await api.handle(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'Method not allowed');
      return;
    }
    if (pathname === '/') {
      redirect(res, '/dashboard');
      return;
    }
    if (isHtmlRoute(pathname)) {
      if (!userOf(req)) {
        redirect(res, `/auth?returnTo=${encodeURIComponent(req.url ?? '/dashboard')}`);
        return;
      }
      const index = resolveInside(editorDir, '/index.html');
      if (index) sendFile(req, res, index);
      else sendError(res, 500, 'Editor build missing');
      return;
    }
    // The sandbox and preview builds sit inside the editor build but must only
    // ever load from their own origins (:5174/:5175). Checked on the RESOLVED
    // file, so `//sandbox/…` or `/x/../sandbox/…` cannot slip through.
    const file = resolveInside(editorDir, pathname);
    if (file && !isInside(file, sandboxDir) && !isInside(file, previewDir)) {
      sendFile(req, res, file);
      return;
    }
    serveSiteAsset(req, res);
  } catch (error) {
    trace.error('server:editor-request', { pathname, error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) sendError(res, 500, 'Internal error');
  }
}

const SANDBOX_HEADERS = {
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Origin-Agent-Cluster': '?1',
  'Access-Control-Allow-Origin': '*',
};
const PREVIEW_HEADERS = {
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Access-Control-Allow-Origin': '*',
};

function frameHandler(
  dir: string,
  headers: Record<string, string>,
  name: string,
  serveAsset: (req: IncomingMessage, res: ServerResponse) => void,
) {
  return (req: IncomingMessage, res: ServerResponse) => {
    try {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'Method not allowed');
        return;
      }
      if (serveFrom(req, res, dir, headers)) return;
      serveAsset(req, res);
    } catch (error) {
      trace.error(`server:${name}-request`, { url: req.url, error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) sendError(res, 500, 'Internal error');
    }
  };
}

// The request handler is registered BEFORE Socket.IO attaches, so engine.io
// wraps it and answers /socket.io/ itself.
const editorServer = http.createServer((req, res) => void handleEditor(req, res));
const io = new Server(editorServer, { maxHttpBufferSize: 10 * 1024 * 1024, serveClient: false });
const realtime = new Realtime(io, { config, db, access, auth, locks });
auth.onLogout = (userId) => realtime.disconnectUser(userId);
api = new Api({ config, db, access, auth, realtime, locks });

const sandboxServer = http.createServer(frameHandler(sandboxDir, SANDBOX_HEADERS, 'sandbox', serveCanvasAsset));
const previewServer = http.createServer(frameHandler(previewDir, PREVIEW_HEADERS, 'preview', serveSiteAsset));

function listen(server: http.Server, port: number, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => {
      trace.action('server:listening', { name, host: config.host, port });
      resolve();
    });
  });
}

await Promise.all([
  listen(editorServer, config.portEditor, 'editor'),
  listen(sandboxServer, config.portSandbox, 'sandbox'),
  listen(previewServer, config.portPreview, 'preview'),
]);
process.stdout.write(`READY editor=http://${config.host}:${config.portEditor}\n`);

const purge = setInterval(() => db.purgeExpired(), 60 * 60 * 1000);
purge.unref();

let shuttingDown = false;
/** Refuse new writes, write every room's live edits (members get the new
 *  revision), let Socket.IO flush and close, then exit. */
async function shutdown(reason: string, code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  trace.action('server:shutdown', { reason });
  try {
    await realtime.close(`shutdown:${reason}`);
  } catch (error) {
    trace.error('server:shutdown-persist', error);
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    io.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  sandboxServer.close();
  previewServer.close();
  try {
    db.close();
  } catch (error) {
    trace.error('server:db-close', error);
  }
  process.exit(code);
}
process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('SIGINT', () => void shutdown('SIGINT', 0));
// A crash must not take the room's unsaved edits with it: persist, then exit
// non-zero so systemd restarts the service.
process.on('uncaughtException', (error) => {
  trace.error('server:uncaught-exception', error);
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  trace.error('server:unhandled-rejection', reason instanceof Error ? reason : { reason: String(reason) });
  void shutdown('unhandledRejection', 1);
});
