// api.ts — `/api/*` for the self-hosted editor. Every route has an explicit
// rule (briefs/13-11-2026-self-hosted-collab-backend.md, "Server routes and
// policy"); anything unlisted answers 404 and never reaches a middleware.
//
// The sites, workspace and publishing endpoints are the local editor's own
// middlewares (src/server/sites-plugin.ts, site-publishing.ts), called only
// after the caller's role on the site is checked. Three routes are answered
// here instead: the site list (filtered to the caller's sites), the site load
// (adds `revision` and `role`) and the save (revision check, per-site lock,
// broadcast to the room).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from './config';
import type { Db, MemberRole, SiteRole, UserRow } from './db';
import type { Access } from './access';
import type { Auth } from './auth';
import type { Realtime } from './realtime';
import type { SiteLocks } from './site-locks';
import {
  HttpError,
  isMutating,
  pathnameOf,
  queryOf,
  readJson,
  sendError,
  sendFailure,
  sendJson,
} from './http';
import {
  MIME_TYPES,
  SITE_ID_RE,
  createSitesApiMiddleware,
  createWorkspaceApiMiddleware,
  ensureNextScaffold,
  listAllSites,
  readRuntimeRange,
  readSiteMeta,
  readSiteProject,
  syncSiteCmsTypesDts,
  walkManagedFiles,
  writeSiteCmsContent,
  writeSiteMeta,
  writeSiteProject,
} from '../src/server/sites-plugin';
import {
  isCmsDataPath,
  isContentPublicAssetPath,
  isDesignManagedPath,
  isDesignPublicAssetPath,
  parseSchemasFromFiles,
  reconcileCmsDataWithSchemas,
  validateSiteViewsAgainstSchemas,
} from '../src/shared/cms-site-contract';
import { SitePublisher, createPublishingMiddleware } from '../src/server/site-publishing';
import { createSiteExportAssetsMiddleware } from '../src/server/site-export-assets';
import { trace } from './trace';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

const SAVE_LIMIT_BYTES = 50 * 1024 * 1024;
const ASSET_LIMIT_BYTES = 25 * 1024 * 1024;
const WORKSPACE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Deps {
  config: ServerConfig;
  db: Db;
  access: Access;
  auth: Auth;
  realtime: Realtime;
  locks: SiteLocks;
}

export class Api {
  private readonly sitesMiddleware: Middleware;
  private readonly workspaceMiddleware: Middleware;
  private readonly publishingMiddleware: Middleware;
  private readonly exportAssetsMiddleware: Middleware;
  private readonly runtimeRange: string;

  constructor(private readonly deps: Deps) {
    const root = deps.config.rootDir;
    this.sitesMiddleware = createSitesApiMiddleware(root);
    this.workspaceMiddleware = createWorkspaceApiMiddleware(root);
    // Authorized per route below, before the middleware runs.
    this.publishingMiddleware = createPublishingMiddleware(root, new SitePublisher(root), () => true);
    this.exportAssetsMiddleware = createSiteExportAssetsMiddleware(root);
    this.runtimeRange = readRuntimeRange(root);
  }

  /** Run a reused middleware; a route it does not know is a 404 here. The
   *  reused middlewares read bodies without a limit, so a body must declare
   *  its length and stay under `maxBytes`. */
  private delegate(mw: Middleware, req: IncomingMessage, res: ServerResponse, maxBytes = 64 * 1024): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const declared = Number(req.headers['content-length'] ?? NaN);
      const chunked = req.headers['transfer-encoding'] !== undefined;
      if (chunked || !Number.isFinite(declared)) throw new HttpError(411, 'Content-Length required');
      if (declared > maxBytes) throw new HttpError(413, `Request body over ${Math.round(maxBytes / 1024 / 1024) || 1} MB`);
    }
    return new Promise((resolve, reject) => {
      const next = () => {
        sendError(res, 404, 'Not found');
        resolve();
      };
      res.once('finish', () => resolve());
      Promise.resolve(mw(req, res, next)).catch(reject);
    });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = pathnameOf(req);
    try {
      if (isMutating(req.method) && !this.deps.access.originAllowed(req)) {
        trace.action('api:origin-refused', { pathname, origin: req.headers.origin });
        throw new HttpError(403, 'Cross-origin request refused');
      }
      const user = this.deps.auth.userFor(req);
      if (!user) throw new HttpError(401, 'Sign in required');

      const segments = pathname.split('/').filter(Boolean); // ['api', ...]
      if (segments[1] === 'sites') return await this.sites(req, res, user, segments);
      if (segments[1] === 'workspace') return await this.workspace(req, res, user);
      if (segments[1] === 'websites' && segments.length === 4 && segments[3] === 'collaborators') {
        return await this.collaborators(req, res, user, segments[2] ?? '');
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      sendFailure(res, error, 'api:handle');
    }
  }

  // ─── /api/sites ─────────────────────────────────────────────────────────

  private requireRole(user: UserRow, siteId: string, allowed: SiteRole[]): SiteRole {
    const role = this.deps.access.roleFor(user, siteId);
    // Non-members get the same 404 as a missing site: no probing for site ids.
    if (!role) throw new HttpError(404, 'Site not found');
    if (!allowed.includes(role)) throw new HttpError(403, 'Your role on this site does not allow this.');
    return role;
  }

  private async sites(req: IncomingMessage, res: ServerResponse, user: UserRow, segments: string[]): Promise<void> {
    const { access } = this.deps;
    const method = req.method ?? 'GET';
    const ALL: SiteRole[] = ['owner', 'editor', 'viewer'];
    const WRITE: SiteRole[] = ['owner', 'editor'];

    if (segments.length === 2) {
      if (method === 'GET') {
        const permitted = access.permittedSites(user);
        const sites = listAllSites(access.sitesRoot).filter((s) => permitted === null || permitted.has(s.id));
        sendJson(res, 200, { sites });
        return;
      }
      if (method === 'POST') {
        if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin creates projects.');
        await this.delegate(this.sitesMiddleware, req, res);
        access.syncFromDisk();
        return;
      }
      throw new HttpError(405, 'Method not allowed');
    }

    const siteId = segments[2] ?? '';
    const rest = segments.slice(3);

    if (rest.length === 0) {
      if (method === 'GET') {
        const role = this.requireRole(user, siteId, ALL);
        const payload = readSiteProject(access.sitesRoot, siteId);
        if (!payload) throw new HttpError(404, 'Site not found');
        sendJson(res, 200, { ...payload, revision: access.siteRow(siteId)?.revision ?? 0, role });
        return;
      }
      if (method === 'PUT') {
        this.requireRole(user, siteId, WRITE);
        await this.save(req, res, user, siteId);
        return;
      }
      if (method === 'PATCH') {
        this.requireRole(user, siteId, WRITE);
        await this.delegate(this.sitesMiddleware, req, res);
        return;
      }
      throw new HttpError(405, 'Method not allowed');
    }

    const [sub, action] = rest;
    if (sub === 'export-assets' && rest.length === 1 && method === 'GET') {
      this.requireRole(user, siteId, ALL);
      await this.delegate(this.exportAssetsMiddleware, req, res);
      return;
    }
    if (sub === 'assets' && rest.length === 1 && method === 'POST') {
      this.requireRole(user, siteId, WRITE);
      await this.delegate(this.sitesMiddleware, req, res, ASSET_LIMIT_BYTES);
      return;
    }
    if (sub === 'fonts') {
      if (rest.length === 1 && method === 'GET') this.requireRole(user, siteId, ALL);
      else if (rest.length === 2 && action === 'adobe' && (method === 'POST' || method === 'DELETE')) {
        // Syncing an Adobe kit makes the server fetch URLs taken from the
        // request (src/server/adobe-fonts-lowlevel.ts): admin only.
        this.requireRole(user, siteId, ALL);
        if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin manages Adobe Fonts.');
      } else throw new HttpError(404, 'Not found');
      await this.delegate(this.sitesMiddleware, req, res, 2 * 1024 * 1024);
      return;
    }
    if (sub === 'publish' && rest.length <= 2) {
      if (method === 'GET' && (action === undefined || action === 'domains')) this.requireRole(user, siteId, ALL);
      else if (method === 'POST' && (action === 'preview' || action === 'production')) this.requireRole(user, siteId, WRITE);
      else if (method === 'POST' && (action === 'connect' || action === 'domains' || action === 'verify-domain')) {
        this.requireRole(user, siteId, ALL);
        if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin manages the Vercel connection and domains.');
      } else throw new HttpError(404, 'Not found');
      await this.delegate(this.publishingMiddleware, req, res);
      return;
    }
    if (sub === 'content' && method === 'GET') {
      this.requireRole(user, siteId, WRITE);
      if (rest.length === 1) {
        await this.pullContent(res, siteId);
        return;
      }
      if (rest.length === 2 && action === 'asset') {
        this.pullContentAsset(req, res, siteId);
        return;
      }
      throw new HttpError(404, 'Not found');
    }
    if (sub === 'design' && rest.length === 1 && method === 'POST') {
      if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin pushes design updates.');
      if (!SITE_ID_RE.test(siteId)) throw new HttpError(400, 'Invalid site ID.');
      await this.pushDesign(req, res, user, siteId);
      return;
    }
    throw new HttpError(404, 'Not found');
  }

  /** PUT /api/sites/:id — save on the current revision only. */
  private async save(req: IncomingMessage, res: ServerResponse, user: UserRow, siteId: string): Promise<void> {
    const { access, db, locks, realtime } = this.deps;
    const body = await readJson<Record<string, unknown>>(req, SAVE_LIMIT_BYTES);
    if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files) || Object.keys(body.files).length === 0) {
      // writeSiteProject deletes every managed file the envelope omits.
      throw new HttpError(400, 'The save has no files.');
    }
    const cmsOnly = access.isCmsOnly(siteId);
    const result = await locks.run(
      siteId,
      ():
        | { kind: 'conflict'; conflict: number }
        | { kind: 'invalid'; issues: import('../src/shared/cms-site-contract').CmsContractIssue[] }
        | { kind: 'ok'; fileCount: number; revision: number } => {
        const current = access.siteRow(siteId)?.revision ?? 0;
        if (typeof body.baseRevision !== 'number' || body.baseRevision !== current) {
          trace.action('api:save-conflict', { siteId, userId: user.id, baseRevision: body.baseRevision, current });
          return { kind: 'conflict', conflict: current };
        }
        if (cmsOnly) {
          const cmsSaved = writeSiteCmsContent(access.sitesRoot, siteId, body.files as Record<string, string>);
          if (cmsSaved.issues.length > 0) {
            trace.action('api:save-invalid-cms', { siteId, userId: user.id, issues: cmsSaved.issues.map((i) => i.code) });
            return { kind: 'invalid', issues: cmsSaved.issues };
          }
          const revision = db.bumpRevision(siteId);
          return { kind: 'ok', fileCount: cmsSaved.fileCount, revision };
        }
        const { baseRevision: _base, inSync: _inSync, ...envelope } = body;
        const fileCount = writeSiteProject(access.sitesRoot, siteId, envelope, this.runtimeRange);
        const revision = db.bumpRevision(siteId);
        return { kind: 'ok', fileCount, revision };
      },
    );
    if (result.kind === 'conflict') {
      sendError(res, 409, 'This project changed since your copy was loaded.', { revision: result.conflict });
      return;
    }
    if (result.kind === 'invalid') {
      sendError(res, 422, result.issues[0]?.message ?? 'Invalid CMS content.', { issues: result.issues });
      return;
    }
    realtime.savedWithoutRoom(siteId);
    realtime.notifySaved(siteId, result.revision, body.inSync === true);
    trace.action('api:saved', { siteId, userId: user.id, revision: result.revision, fileCount: result.fileCount, cmsOnly });
    sendJson(res, 200, { ok: true, fileCount: result.fileCount, revision: result.revision });
  }

  /** GET /api/sites/:id/content — snapshot of CMS item data + content media manifest. */
  private async pullContent(res: ServerResponse, siteId: string): Promise<void> {
    const { access, realtime } = this.deps;
    await realtime.flushSite(siteId);
    const siteDir = path.join(access.sitesRoot, siteId);
    const meta = readSiteMeta(siteDir, siteId);
    const allManaged = walkManagedFiles(siteDir);
    const cmsFiles: Record<string, string> = {};
    for (const [relPath, content] of Object.entries(allManaged)) {
      if (isCmsDataPath(relPath)) cmsFiles[relPath] = content;
    }

    const mediaFiles: Array<{ path: string; size: number; sha1: string }> = [];
    const publicDir = path.join(siteDir, 'public');
    if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
      const walkPublic = (absDir: string, relPrefix: string) => {
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          const absChild = path.join(absDir, entry.name);
          if (fs.lstatSync(absChild).isSymbolicLink()) continue;
          const relChild = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walkPublic(absChild, relChild);
          } else if (entry.isFile() && isContentPublicAssetPath(relChild)) {
            const bytes = fs.readFileSync(absChild);
            mediaFiles.push({
              path: relChild,
              size: bytes.length,
              sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
            });
          }
        }
      };
      walkPublic(publicDir, '');
    }
    mediaFiles.sort((a, b) => a.path.localeCompare(b.path));

    const revision = access.siteRow(siteId)?.revision ?? 0;
    trace.action('api:content-pulled', { siteId, cmsCollections: Object.keys(cmsFiles).length, mediaFiles: mediaFiles.length, revision });
    sendJson(res, 200, {
      id: siteId,
      name: meta.name,
      revision,
      cmsFiles,
      mediaFiles,
    });
  }

  /** GET /api/sites/:id/content/asset?path=<relUnderPublic> — stream one content media file. */
  private pullContentAsset(req: IncomingMessage, res: ServerResponse, siteId: string): void {
    const rawRel = queryOf(req).get('path') ?? '';
    const cleanRel = rawRel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!isContentPublicAssetPath(cleanRel)) {
      throw new HttpError(400, 'Invalid content asset path.');
    }
    const publicDir = path.join(this.deps.access.sitesRoot, siteId, 'public');
    const absFile = path.resolve(publicDir, cleanRel);
    if (!absFile.startsWith(publicDir + path.sep) || !fs.existsSync(absFile)) {
      throw new HttpError(404, 'Asset not found.');
    }
    const stat = fs.lstatSync(absFile);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new HttpError(404, 'Asset not found.');
    }
    const ext = path.extname(absFile).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(absFile).pipe(res);
  }

  /**
   * POST /api/sites/:id/design — admin-only push of local design, views,
   * components, and schemas. Preserves remote `cms/<slug>.json` data and
   * `public/uploads/**` + `public/media/**`, backfills defaults for new schema
   * fields, rejects breaking schema changes on published items, and broadcasts
   * updated files live to any open collaboration room.
   */
  private async pushDesign(req: IncomingMessage, res: ServerResponse, user: UserRow, siteId: string): Promise<void> {
    const { access, db, locks, realtime } = this.deps;
    const body = await readJson<{
      name?: unknown;
      format?: unknown;
      cmsOnly?: unknown;
      settings?: unknown;
      designFiles?: unknown;
      starterCmsFiles?: unknown;
      designAssets?: unknown;
      deleteDesignAssets?: unknown;
    }>(req, SAVE_LIMIT_BYTES);

    if (!body.designFiles || typeof body.designFiles !== 'object' || Array.isArray(body.designFiles)) {
      throw new HttpError(400, 'designFiles object is required.');
    }

    const cleanDesignFiles: Record<string, string> = {};
    for (const [rawPath, content] of Object.entries(body.designFiles as Record<string, unknown>)) {
      const cleanRel = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!isDesignManagedPath(cleanRel) || typeof content !== 'string') {
        throw new HttpError(400, `Path "${rawPath}" is not a valid design/schema path.`);
      }
      cleanDesignFiles[cleanRel] = content;
    }
    if (Object.keys(cleanDesignFiles).length === 0) {
      throw new HttpError(400, 'designFiles cannot be empty.');
    }

    const starterCmsFiles: Record<string, string> = {};
    if (body.starterCmsFiles && typeof body.starterCmsFiles === 'object' && !Array.isArray(body.starterCmsFiles)) {
      for (const [rawPath, content] of Object.entries(body.starterCmsFiles as Record<string, unknown>)) {
        const cleanRel = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (isCmsDataPath(cleanRel) && typeof content === 'string') {
          starterCmsFiles[cleanRel] = content;
        }
      }
    }

    const cleanDesignAssets: Record<string, Buffer> = {};
    if (body.designAssets && typeof body.designAssets === 'object' && !Array.isArray(body.designAssets)) {
      for (const [rawPath, b64] of Object.entries(body.designAssets as Record<string, unknown>)) {
        const cleanRel = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!isDesignPublicAssetPath(cleanRel) || typeof b64 !== 'string') {
          throw new HttpError(400, `Asset path "${rawPath}" is not a valid design public asset.`);
        }
        cleanDesignAssets[cleanRel] = Buffer.from(b64, 'base64');
      }
    }

    const cleanDeleteDesignAssets: string[] = [];
    if (Array.isArray(body.deleteDesignAssets)) {
      for (const rawPath of body.deleteDesignAssets) {
        if (typeof rawPath !== 'string') continue;
        const cleanRel = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!isDesignPublicAssetPath(cleanRel)) {
          throw new HttpError(400, `Cannot delete non-design asset "${rawPath}".`);
        }
        cleanDeleteDesignAssets.push(cleanRel);
      }
    }

    // 1. Validate schemas + View ↔ Schema contract BEFORE touching disk.
    const { schemas, issues: schemaIssues } = parseSchemasFromFiles(cleanDesignFiles);
    const viewIssues = validateSiteViewsAgainstSchemas(cleanDesignFiles, schemas);
    const preIssues = [...schemaIssues, ...viewIssues];
    if (preIssues.length > 0) {
      sendError(res, 422, preIssues[0]!.message, { issues: preIssues });
      return;
    }

    // 2. Flush any in-memory CMS edits from an open room BEFORE taking the site lock.
    if (access.siteExists(siteId)) {
      await realtime.flushSite(siteId);
    }

    // 3. Reconcile remote CMS data + atomically update design files under site lock.
    const outcome = await locks.run(
      siteId,
      ():
        | { kind: 'invalid'; issues: import('../src/shared/cms-site-contract').CmsContractIssue[] }
        | {
            kind: 'ok';
            revision: number;
            designFileCount: number;
            reconciledCollections: string[];
            broadcastFiles: Record<string, string>;
            deletedDesignPaths: string[];
          } => {
      const siteDir = path.join(access.sitesRoot, siteId);
      const existed = access.siteExists(siteId);
      const prevMeta = existed
        ? readSiteMeta(siteDir, siteId)
        : { id: siteId, name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : siteId, format: 'revyme-v1' as const };
      const existingManaged = existed ? walkManagedFiles(siteDir) : {};

      const remoteCmsFiles: Record<string, string> = {};
      for (const [relPath, content] of Object.entries(existingManaged)) {
        if (isCmsDataPath(relPath)) remoteCmsFiles[relPath] = content;
      }

      const reconciled = reconcileCmsDataWithSchemas({
        remoteCmsFiles,
        starterCmsFiles,
        schemas,
      });
      if (reconciled.issues.length > 0) {
        return { kind: 'invalid', issues: reconciled.issues };
      }

      fs.mkdirSync(siteDir, { recursive: true });

      const broadcastFiles: Record<string, string> = {};
      for (const [cleanRel, content] of Object.entries(cleanDesignFiles)) {
        const abs = path.join(siteDir, cleanRel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
        broadcastFiles[cleanRel] = content;
      }

      // Delete stale design files that were removed locally (never CMS data or _meta).
      const deletedDesignPaths: string[] = [];
      for (const oldRel of Object.keys(existingManaged)) {
        if (!isDesignManagedPath(oldRel)) continue;
        if (oldRel === 'cms/cms-types.d.ts') continue;
        if (oldRel in cleanDesignFiles) continue;
        const absOld = path.join(siteDir, oldRel);
        if (fs.existsSync(absOld) && fs.statSync(absOld).isFile()) {
          fs.rmSync(absOld, { force: true });
          deletedDesignPaths.push(oldRel);
        }
      }

      // Persist newly seeded collections and backfilled schema defaults.
      for (const changedCmsPath of reconciled.changedPaths) {
        const content = reconciled.files[changedCmsPath]!;
        const abs = path.join(siteDir, changedCmsPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
        broadcastFiles[changedCmsPath] = content;
      }

      // Sync design public assets (never touching public/uploads or public/**/media).
      const publicDir = path.join(siteDir, 'public');
      for (const [cleanRel, bytes] of Object.entries(cleanDesignAssets)) {
        const abs = path.resolve(publicDir, cleanRel);
        if (!abs.startsWith(publicDir + path.sep)) continue;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, bytes);
      }
      for (const cleanRel of cleanDeleteDesignAssets) {
        const abs = path.resolve(publicDir, cleanRel);
        if (!abs.startsWith(publicDir + path.sep)) continue;
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          fs.rmSync(abs, { force: true });
        }
      }

      const siteName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : prevMeta.name;
      ensureNextScaffold(siteDir, siteId, siteName, this.runtimeRange);
      const dtsRel = syncSiteCmsTypesDts(siteDir);
      if (dtsRel) {
        broadcastFiles[dtsRel] = fs.readFileSync(path.join(siteDir, dtsRel), 'utf-8');
      }

      const finalManaged = Object.keys(walkManagedFiles(siteDir)).sort();
      writeSiteMeta(siteDir, {
        ...prevMeta,
        id: siteId,
        name: siteName,
        format: body.format === 'revyme-v2' ? 'revyme-v2' : prevMeta.format || 'revyme-v1',
        cmsOnly: typeof body.cmsOnly === 'boolean' ? body.cmsOnly : prevMeta.cmsOnly ?? true,
        ...(body.settings && typeof body.settings === 'object' ? { settings: body.settings as Record<string, unknown> } : {}),
        managedFiles: finalManaged,
        updatedAt: new Date().toISOString(),
      });

      access.siteRow(siteId);
      const revision = db.bumpRevision(siteId);
      return {
        kind: 'ok',
        revision,
        designFileCount: Object.keys(cleanDesignFiles).length,
        reconciledCollections: reconciled.changedPaths,
        broadcastFiles,
        deletedDesignPaths,
      };
    });

    if (outcome.kind === 'invalid') {
      sendError(res, 422, outcome.issues[0]!.message, { issues: outcome.issues });
      return;
    }

    realtime.applyDesignPush(siteId, outcome.broadcastFiles, outcome.deletedDesignPaths, outcome.revision, user.id);
    trace.action('api:design-pushed', {
      siteId,
      userId: user.id,
      revision: outcome.revision,
      designFileCount: outcome.designFileCount,
      reconciledCollections: outcome.reconciledCollections,
    });
    sendJson(res, 200, {
      ok: true,
      revision: outcome.revision,
      designFileCount: outcome.designFileCount,
      reconciledCollections: outcome.reconciledCollections,
    });
  }

  // ─── /api/workspace ─────────────────────────────────────────────────────

  private async workspace(req: IncomingMessage, res: ServerResponse, user: UserRow): Promise<void> {
    if (req.method !== 'GET' && !this.deps.access.isAdmin(user)) {
      throw new HttpError(403, 'Only the admin changes workspace fonts and settings.');
    }
    await this.delegate(this.workspaceMiddleware, req, res, WORKSPACE_UPLOAD_LIMIT_BYTES);
  }

  // ─── /api/websites/:id/collaborators ────────────────────────────────────
  // Shapes: src/backend/revyme-backend.ts (Collaborator) and
  // src/editor/collab/CollaboratorsModal.tsx. Invitees are real users from the
  // moment they are invited, so every member row is `source: 'collaborator'`
  // (the modal only offers role/remove on those); `pending` marks people who
  // have not signed in yet.

  private async collaborators(req: IncomingMessage, res: ServerResponse, user: UserRow, siteId: string): Promise<void> {
    const { access, db, auth, realtime } = this.deps;
    const role = this.requireRole(user, siteId, ['owner', 'editor', 'viewer']);
    const site = access.siteRow(siteId)!;
    const admin = access.admin();
    const method = req.method ?? 'GET';

    if (method === 'GET') {
      const owner = {
        user_id: admin.id,
        email: admin.email,
        name: admin.name,
        avatar: null,
        role: 'owner' as const,
        color: site.owner_color,
        source: 'owner' as const,
      };
      const members = db.listMembers(siteId).map((m) => ({
        user_id: m.user_id,
        email: m.email,
        name: m.name,
        avatar: null,
        role: m.role,
        color: m.color,
        source: 'collaborator' as const,
        collaborator_id: m.user_id,
        pending: m.last_login_at === null,
      }));
      sendJson(res, 200, { collaborators: [owner, ...members] });
      return;
    }

    if (method === 'POST') {
      if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin invites people.');
      const body = await readJson<{ email?: unknown; role?: unknown }>(req, 16 * 1024);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const memberRole: MemberRole = body.role === 'viewer' ? 'viewer' : 'editor';
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (email === admin.email) throw new HttpError(400, 'The admin already owns every project.');
      const invitee = db.ensureUser(email);
      db.upsertMember(siteId, invitee.id, memberRole);
      realtime.refreshMember(siteId, invitee.id);
      const siteName = readSiteMeta(`${access.sitesRoot}/${siteId}`, siteId).name;
      await auth.sendInvite(email, siteName, this.deps.config.adminName ?? admin.name ?? admin.email, memberRole);
      trace.action('api:member-invited', { siteId, email, role: memberRole });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'PATCH') {
      const body = await readJson<{ user_id?: unknown; role?: unknown; color?: unknown }>(req, 16 * 1024);
      const targetId = typeof body.user_id === 'string' ? body.user_id : '';
      if (body.role !== undefined) {
        if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin changes roles.');
        if (body.role !== 'editor' && body.role !== 'viewer') throw new HttpError(400, 'Role must be editor or viewer.');
      }
      if (body.color !== undefined) {
        if (!access.canWrite(role)) throw new HttpError(403, 'Viewers cannot change colours.');
        if (typeof body.color !== 'string' || !COLOR_RE.test(body.color)) throw new HttpError(400, 'Invalid colour.');
      }
      if (targetId === admin.id) {
        if (body.role !== undefined) throw new HttpError(400, 'The owner role cannot change.');
        if (typeof body.color === 'string') db.setOwnerColor(siteId, body.color);
      } else if (!db.updateMember(siteId, targetId, { role: body.role as MemberRole | undefined, color: body.color as string | undefined })) {
        throw new HttpError(404, 'Member not found.');
      }
      if (body.role !== undefined) realtime.refreshMember(siteId, targetId);
      trace.action('api:member-updated', { siteId, targetId, role: body.role, color: body.color });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'DELETE') {
      if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin removes people.');
      const targetId = queryOf(req).get('user_id') ?? '';
      if (targetId === admin.id) throw new HttpError(400, 'The owner cannot be removed.');
      if (!db.removeMember(siteId, targetId)) throw new HttpError(404, 'Member not found.');
      realtime.refreshMember(siteId, targetId);
      trace.action('api:member-removed', { siteId, targetId });
      sendJson(res, 200, { ok: true });
      return;
    }

    throw new HttpError(405, 'Method not allowed');
  }
}
