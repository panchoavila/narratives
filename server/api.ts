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
  createSitesApiMiddleware,
  createWorkspaceApiMiddleware,
  listAllSites,
  readRuntimeRange,
  readSiteMeta,
  readSiteProject,
  writeSiteProject,
} from '../src/server/sites-plugin';
import { SitePublisher, createPublishingMiddleware } from '../src/server/site-publishing';
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
  private readonly runtimeRange: string;

  constructor(private readonly deps: Deps) {
    const root = deps.config.rootDir;
    this.sitesMiddleware = createSitesApiMiddleware(root);
    this.workspaceMiddleware = createWorkspaceApiMiddleware(root);
    // Authorized per route below, before the middleware runs.
    this.publishingMiddleware = createPublishingMiddleware(root, new SitePublisher(root), () => true);
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
    const result = await locks.run(siteId, () => {
      const current = access.siteRow(siteId)?.revision ?? 0;
      if (typeof body.baseRevision !== 'number' || body.baseRevision !== current) {
        trace.action('api:save-conflict', { siteId, userId: user.id, baseRevision: body.baseRevision, current });
        return { conflict: current } as const;
      }
      const { baseRevision: _base, inSync: _inSync, ...envelope } = body;
      const fileCount = writeSiteProject(access.sitesRoot, siteId, envelope, this.runtimeRange);
      const revision = db.bumpRevision(siteId);
      return { fileCount, revision } as const;
    });
    if ('conflict' in result) {
      sendError(res, 409, 'This project changed since your copy was loaded.', { revision: result.conflict });
      return;
    }
    realtime.savedWithoutRoom(siteId);
    realtime.notifySaved(siteId, result.revision, body.inSync === true);
    trace.action('api:saved', { siteId, userId: user.id, revision: result.revision, fileCount: result.fileCount });
    sendJson(res, 200, { ok: true, fileCount: result.fileCount, revision: result.revision });
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
