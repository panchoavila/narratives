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
  createSitesApiMiddleware,
  createWorkspaceApiMiddleware,
  isManagedProjectPath,
  listAllSites,
  readRuntimeRange,
  readSiteMeta,
  readSiteProject,
  walkManagedFiles,
  writeSiteCmsContent,
  writeSiteProject,
} from '../src/server/sites-plugin';
import {
  isCmsDataPath,
  isContentPublicAssetPath,
  parseSchemasFromFiles,
  validateAllCmsDataFiles,
} from '../src/shared/cms-site-contract';
import {
  MAIN_BRANCH_ID,
  deleteBranchRecord,
  isValidBranchId,
  listBranchRecords,
  listBranchSummaries,
  readBranchMaterialized,
  readBranchRecord,
  setBranchLease,
  writeBranchRecord,
  type BranchChange,
  type FileDeltaBody,
} from '../src/server/branch-records';
import { checkProposedFiles } from '../src/server/branch-check';
import type { AgentPrincipal } from './auth';
import { SitePublisher, createPublishingMiddleware } from '../src/server/site-publishing';
import { createSiteExportAssetsMiddleware } from '../src/server/site-export-assets';
import { trace } from './trace';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

const SAVE_LIMIT_BYTES = 50 * 1024 * 1024;
/** How long an agent holds its work branch after its last write. */
const AGENT_LEASE_MS = 30 * 60 * 1000;

interface AgentWriteBody {
  branch?: unknown;
  title?: unknown;
  base?: Record<string, string>;
  files?: FileDeltaBody;
}
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
      const segments = pathname.split('/').filter(Boolean); // ['api', ...]
      // An agent token (CLI, MCP) is not a user: it reads its site and writes
      // branches, and every other route refuses it.
      const agent = this.deps.auth.agentFor(req);
      if (agent) return await this.agentRequest(req, res, agent, segments);

      const user = this.deps.auth.userFor(req);
      if (!user) throw new HttpError(401, 'Sign in required');

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
    const ALL: SiteRole[] = ['owner', 'editor', 'content', 'viewer'];
    const WRITE: SiteRole[] = ['owner', 'editor'];
    // Saves, media and publishing are open to `content` members too; their
    // saves keep CMS items only (save below).
    const CONTENT: SiteRole[] = ['owner', 'editor', 'content'];

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
        const role = this.requireRole(user, siteId, CONTENT);
        await this.save(req, res, user, siteId, role);
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
      this.requireRole(user, siteId, CONTENT);
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
      else if (method === 'POST' && (action === 'preview' || action === 'production')) this.requireRole(user, siteId, CONTENT);
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
    if (sub === 'branches' && rest.length <= 2) {
      await this.branches(req, res, user, siteId, action);
      return;
    }
    if (sub === 'agent-tokens' && rest.length <= 2) {
      await this.agentTokens(req, res, user, siteId, action);
      return;
    }
    if (sub === 'design' && rest.length === 1 && method === 'POST') {
      // Retired: it wrote design straight into main with no review. Design
      // reaches main only through a branch the owner applies
      // (briefs/22-11-2026-branch-review-workflow.md, D5, Q2).
      throw new HttpError(410, 'design:push is retired — push local work as a branch (npm run branch:push <site>) and apply it in the editor.');
    }
    throw new HttpError(404, 'Not found');
  }

  /**
   * /api/sites/:id/branches[/:branch] — the site's branches as records of
   * their own (src/server/branch-records.ts). Each has its own revision: a
   * write names the revision it is based on and a stale one gets 409. Every
   * change is announced to the site's live room so open editors show it
   * without a reload, and no envelope save can erase it.
   */
  private async branches(req: IncomingMessage, res: ServerResponse, user: UserRow, siteId: string, branchId: string | undefined): Promise<void> {
    const { access, locks, realtime } = this.deps;
    const method = req.method ?? 'GET';
    const siteDir = path.join(access.sitesRoot, siteId);
    const READ: SiteRole[] = ['owner', 'editor', 'content', 'viewer'];
    const WRITE: SiteRole[] = ['owner', 'editor'];

    if (branchId === undefined) {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      this.requireRole(user, siteId, READ);
      sendJson(res, 200, { branches: listBranchSummaries(siteDir) });
      return;
    }
    if (method === 'GET') {
      this.requireRole(user, siteId, READ);
      const branch = readBranchMaterialized(siteDir, branchId);
      if (!branch) throw new HttpError(404, `Branch "${branchId}" not found`);
      sendJson(res, 200, { ...branch.record, base: branch.base, files: branch.files });
      return;
    }
    if (method === 'PUT') {
      this.requireRole(user, siteId, WRITE);
      const body = await readJson<Partial<BranchChange>>(req, SAVE_LIMIT_BYTES);
      const result = await locks.run(siteId, () => writeBranchRecord(siteDir, branchId, {
        baseRevision: typeof body.baseRevision === 'number' ? body.baseRevision : null,
        base: body.base,
        files: body.files,
        meta: body.meta,
      }, { isAllowedPath: isManagedProjectPath, userId: user.id }));
      if (result.kind === 'invalid') throw new HttpError(400, result.message);
      if (result.kind === 'conflict') {
        trace.action('api:branch-conflict', { siteId, branchId, userId: user.id, baseRevision: body.baseRevision, revision: result.revision });
        sendError(res, 409, `Branch "${branchId}" changed since your copy.`, { revision: result.revision });
        return;
      }
      realtime.branchUpdated(siteId, branchId, result.record.revision, user.id);
      trace.action('api:branch-saved', { siteId, branchId, userId: user.id, revision: result.record.revision, created: result.created });
      sendJson(res, 200, { ok: true, revision: result.record.revision, created: result.created });
      return;
    }
    if (method === 'DELETE') {
      this.requireRole(user, siteId, WRITE);
      const deleted = await locks.run(siteId, () => deleteBranchRecord(siteDir, branchId));
      if (!deleted) throw new HttpError(404, `Branch "${branchId}" not found`);
      realtime.branchDeleted(siteId, branchId, user.id);
      trace.action('api:branch-deleted', { siteId, branchId, userId: user.id });
      sendJson(res, 200, { ok: true });
      return;
    }
    throw new HttpError(405, 'Method not allowed');
  }

  // ─── Agents ─────────────────────────────────────────────────────────────
  // An agent (the CLI's branch:push / site:dev, narratives-mcp) authenticates
  // with a per-site token (db agent_tokens). It may read its site's main and
  // branches, and write ONLY through /agent/write, which always lands on a
  // branch — its open work branch, or a new `agent-<date>-<slug>` one — never
  // on main. It cannot apply, publish, delete or change settings
  // (briefs/22-11-2026-branch-review-workflow.md, D4).

  private async agentRequest(req: IncomingMessage, res: ServerResponse, agent: AgentPrincipal, segments: string[]): Promise<void> {
    const { access } = this.deps;
    const method = req.method ?? 'GET';
    if (segments[1] !== 'sites') throw new HttpError(403, 'Agent tokens can only read their site and write branches.');
    if (segments.length === 2 && method === 'GET') {
      const site = listAllSites(access.sitesRoot).filter((s) => s.id === agent.siteId);
      sendJson(res, 200, { sites: site });
      return;
    }
    const siteId = segments[2] ?? '';
    if (siteId !== agent.siteId) throw new HttpError(403, 'This agent token belongs to another site.');
    const siteDir = path.join(access.sitesRoot, siteId);
    const [sub, action] = segments.slice(3);
    if (segments.length === 3 && method === 'GET') {
      const payload = readSiteProject(access.sitesRoot, siteId);
      if (!payload) throw new HttpError(404, 'Site not found');
      sendJson(res, 200, { ...payload, revision: access.siteRow(siteId)?.revision ?? 0, role: 'agent' });
      return;
    }
    if (sub === 'branches' && segments.length <= 5 && method === 'GET') {
      if (action === undefined) {
        sendJson(res, 200, { branches: listBranchSummaries(siteDir) });
        return;
      }
      const branch = readBranchMaterialized(siteDir, action);
      if (!branch) throw new HttpError(404, `Branch "${action}" not found`);
      sendJson(res, 200, { ...branch.record, base: branch.base, files: branch.files });
      return;
    }
    if (sub === 'agent' && segments.length === 5 && method === 'POST') {
      const body = await readJson<AgentWriteBody>(req, SAVE_LIMIT_BYTES);
      if (action === 'write') return await this.agentWrite(res, agent, siteDir, body, false);
      if (action === 'check') return await this.agentWrite(res, agent, siteDir, body, true);
      if (action === 'finish') return await this.agentFinish(res, agent, siteDir, body);
    }
    trace.action('api:agent-refused', { siteId, agent: agent.id, method, path: segments.join('/') });
    throw new HttpError(403, 'Agent tokens can only read the site and write branches. Applying, publishing and settings are the owner\'s.');
  }

  /** The agent's open work branch: created by it, its lease still live. */
  private openWorkBranch(siteDir: string, agent: AgentPrincipal, now: number): string | null {
    const open = listBranchRecords(siteDir).find((r) => r.createdBy === agent.id && r.lease?.holder === agent.id && r.lease.until > now);
    return open?.id ?? null;
  }

  private newWorkBranchId(siteDir: string, title: unknown, now: number): string {
    const day = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
    const slug = (typeof title === 'string' ? title : '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'work';
    const stem = `agent-${day}-${slug}`;
    for (let n = 1; n < 1000; n++) {
      const id = n === 1 ? stem : `${stem}-${n}`;
      if (!readBranchRecord(siteDir, id)) return id;
    }
    throw new HttpError(409, 'Too many work branches with this title today.');
  }

  /**
   * POST /api/sites/:id/agent/write (and /agent/check, which only checks):
   * `{ files: { set, del }, branch?, title?, base? }`. Without `branch`, the
   * agent's open work branch is used, or a new one is created from `base`
   * (the copy the agent worked from) or, without it, from main. The proposed
   * files are checked (src/server/branch-check.ts) before anything is
   * stored: 422 with every problem, nothing written.
   */
  private async agentWrite(res: ServerResponse, agent: AgentPrincipal, siteDir: string, body: AgentWriteBody, dryRun: boolean): Promise<void> {
    const { locks, realtime } = this.deps;
    const now = Date.now();
    const siteId = agent.siteId;
    if (body.branch === MAIN_BRANCH_ID) throw new HttpError(403, 'Agents never write main — omit "branch" to get a work branch.');
    if (body.branch !== undefined && (typeof body.branch !== 'string' || !isValidBranchId(body.branch))) {
      throw new HttpError(400, `Invalid branch id "${String(body.branch)}".`);
    }
    const requested = typeof body.branch === 'string' ? body.branch : undefined;
    const files = body.files ?? {};
    const allowed = (p: string) => isManagedProjectPath(p) && !p.startsWith('_meta/');
    for (const p of [...Object.keys(files.set ?? {}), ...(files.del ?? [])]) {
      if (!allowed(p)) throw new HttpError(400, `Path "${p}" cannot be part of a branch.`);
    }

    const result = await locks.run(siteId, () => {
      let id: string | null = requested ?? this.openWorkBranch(siteDir, agent, now);
      const existing = id ? readBranchMaterialized(siteDir, id) : null;
      if (existing && existing.record.createdBy !== agent.id) {
        throw new HttpError(403, `Branch "${id}" is not this agent's work branch.`);
      }
      const mainFiles = Object.fromEntries(Object.entries(walkManagedFiles(siteDir)).filter(([p]) => allowed(p)));
      const baseFiles = existing
        ? existing.base
        : body.base && typeof body.base === 'object'
          ? Object.fromEntries(Object.entries(body.base).filter(([p, v]) => allowed(p) && typeof v === 'string'))
          : mainFiles;
      const current = existing ? existing.files : baseFiles;
      const proposed: Record<string, string> = { ...current };
      for (const p of files.del ?? []) delete proposed[p];
      for (const [p, v] of Object.entries(files.set ?? {})) proposed[p] = v;
      const changed = [...new Set([...Object.keys(current), ...Object.keys(proposed)])].filter((p) => current[p] !== proposed[p]);
      const problems = checkProposedFiles(proposed, changed);
      if (problems.length > 0 || dryRun) return { kind: 'checked' as const, problems, branch: id };
      if (changed.length === 0 && existing) {
        return { kind: 'ok' as const, branch: existing.record.id, revision: existing.record.revision, created: false, changed: 0 };
      }
      id = id ?? this.newWorkBranchId(siteDir, body.title, now);
      const written = writeBranchRecord(siteDir, id, existing
        ? { baseRevision: existing.record.revision, files: { set: Object.fromEntries(changed.filter((p) => p in proposed).map((p) => [p, proposed[p]!])), del: changed.filter((p) => !(p in proposed)) }, meta: { status: 'dirty', lastEditedAt: now } }
        : { baseRevision: null, base: { set: baseFiles }, files: { set: proposed }, meta: { status: 'dirty', parentId: MAIN_BRANCH_ID, createdAt: now, lastEditedAt: now } },
        { isAllowedPath: allowed, userId: agent.id, now });
      if (written.kind !== 'ok') throw new HttpError(written.kind === 'conflict' ? 409 : 400, written.kind === 'invalid' ? written.message : 'The branch changed meanwhile; retry.');
      setBranchLease(siteDir, id, { holder: agent.id, until: now + AGENT_LEASE_MS });
      return { kind: 'ok' as const, branch: id, revision: written.record.revision, created: written.created, changed: changed.length };
    });

    if (result.kind === 'checked') {
      if (result.problems.length > 0) {
        trace.action('api:agent-write-refused', { siteId, agent: agent.id, problems: result.problems.length, dryRun });
        sendError(res, 422, result.problems[0]!, { problems: result.problems });
        return;
      }
      sendJson(res, 200, { ok: true, problems: [] });
      return;
    }
    realtime.branchUpdated(siteId, result.branch, result.revision, agent.id);
    realtime.branchLease(siteId, result.branch, { holder: agent.id, until: now + AGENT_LEASE_MS });
    trace.action('api:agent-wrote', { siteId, agent: agent.id, branch: result.branch, revision: result.revision, created: result.created, changed: result.changed });
    sendJson(res, 200, { ok: true, branch: result.branch, revision: result.revision, created: result.created, changed: result.changed });
  }

  /** POST /api/sites/:id/agent/finish `{ branch? }` — the agent is done:
   *  its lease ends, the owner can apply, and its next write opens a new branch. */
  private async agentFinish(res: ServerResponse, agent: AgentPrincipal, siteDir: string, body: AgentWriteBody): Promise<void> {
    const id = typeof body.branch === 'string' ? body.branch : this.openWorkBranch(siteDir, agent, Date.now());
    if (!id) {
      sendJson(res, 200, { ok: true, branch: null });
      return;
    }
    const record = readBranchRecord(siteDir, id);
    if (!record) throw new HttpError(404, `Branch "${id}" not found`);
    if (record.createdBy !== agent.id) throw new HttpError(403, `Branch "${id}" is not this agent's work branch.`);
    await this.deps.locks.run(agent.siteId, () => setBranchLease(siteDir, id, null));
    this.deps.realtime.branchLease(agent.siteId, id, null);
    trace.action('api:agent-finished', { siteId: agent.siteId, agent: agent.id, branch: id });
    sendJson(res, 200, { ok: true, branch: id });
  }

  /** /api/sites/:id/agent-tokens[/:tokenId] — the admin creates, lists and revokes agent tokens. */
  private async agentTokens(req: IncomingMessage, res: ServerResponse, user: UserRow, siteId: string, tokenId: string | undefined): Promise<void> {
    const { access, db } = this.deps;
    if (!access.isAdmin(user)) throw new HttpError(403, 'Only the admin manages agent tokens.');
    if (!access.siteExists(siteId)) throw new HttpError(404, 'Site not found');
    access.siteRow(siteId);
    const method = req.method ?? 'GET';
    const shape = (t: { id: string; label: string; created_at: string; revoked_at: string | null }) => ({ id: t.id, label: t.label, createdAt: t.created_at, revokedAt: t.revoked_at });
    if (tokenId === undefined && method === 'GET') {
      sendJson(res, 200, { tokens: db.listAgentTokens(siteId).map(shape) });
      return;
    }
    if (tokenId === undefined && method === 'POST') {
      const body = await readJson<{ label?: unknown }>(req, 4096);
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'agent';
      const token = `nat_${crypto.randomBytes(24).toString('hex')}`;
      const row = db.createAgentToken(siteId, label, crypto.createHash('sha256').update(token).digest('hex'));
      trace.action('api:agent-token-created', { siteId, tokenId: row.id, label });
      sendJson(res, 201, { ...shape(row), token });
      return;
    }
    if (tokenId !== undefined && method === 'DELETE') {
      if (!db.revokeAgentToken(siteId, tokenId)) throw new HttpError(404, 'Token not found');
      trace.action('api:agent-token-revoked', { siteId, tokenId });
      sendJson(res, 200, { ok: true });
      return;
    }
    throw new HttpError(405, 'Method not allowed');
  }

  /** PUT /api/sites/:id — save on the current revision only. */
  private async save(req: IncomingMessage, res: ServerResponse, user: UserRow, siteId: string, role: SiteRole): Promise<void> {
    const { access, db, locks, realtime } = this.deps;
    const body = await readJson<Record<string, unknown>>(req, SAVE_LIMIT_BYTES);
    if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files) || Object.keys(body.files).length === 0) {
      // writeSiteProject deletes every managed file the envelope omits.
      throw new HttpError(400, 'The save has no files.');
    }
    // A `content` member's save keeps CMS items only (D7).
    const cmsOnly = access.isContentOnly(role);
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
        // CMS items in a full save are held to their schemas too (a save is
        // the other way content reaches disk besides the live room).
        const incoming = body.files as Record<string, string>;
        const { schemas } = parseSchemasFromFiles(incoming);
        const cmsData: Record<string, string> = {};
        for (const [p, content] of Object.entries(incoming)) {
          if (isCmsDataPath(p) && typeof content === 'string' && schemas.has(p.slice('cms/'.length, -'.json'.length))) cmsData[p] = content;
        }
        const cmsIssues = validateAllCmsDataFiles(cmsData, schemas);
        if (cmsIssues.length > 0) {
          trace.action('api:save-invalid-cms', { siteId, userId: user.id, issues: cmsIssues.map((i) => i.code) });
          return { kind: 'invalid', issues: cmsIssues };
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
      const memberRole: MemberRole = body.role === 'viewer' || body.role === 'content' ? body.role : 'editor';
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
        if (body.role !== 'editor' && body.role !== 'viewer' && body.role !== 'content') throw new HttpError(400, 'Role must be editor, content or viewer.');
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
