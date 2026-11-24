import { collectCmsDetailRoutes } from '../code/project/cms-detail-route';
// site-cli.ts — Local CLI for the CMS-only remote / local-design workflow:
//   npm run site:new <siteId> [Site Name]
//   npm run site:check [siteId] [--strict-oracle]
//   npm run design:push <siteId> [--url <origin>] [--token <adminToken>]
//   npm run content:pull <siteId> [--url <origin>] [--token <adminToken>]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import {
  SITE_ID_RE,
  listAllSites,
  readRuntimeRange,
  readSiteMeta,
  scaffoldCmsFirstSite,
  syncSiteCmsTypesDts,
  walkManagedFiles,
  writeSiteMeta,
} from './sites-plugin';
import { readEnvFiles } from './site-publishing';
import {
  isCmsDataPath,
  isContentPublicAssetPath,
  validateFullCmsSite,
} from '../shared/cms-site-contract';
import { checkFile, type FileKind } from '../code/oracle/check-file';
import { cmdAgentToken, cmdBranchDone, cmdBranchPush, cmdDev, cmdPull } from './branch-cli';
import { isCodeComponentSource } from '../code/oracle/checks/shared';

interface CliFlags {
  positional: string[];
  url?: string;
  token?: string;
  cookie?: string;
  branch?: string;
  title?: string;
  strictOracle: boolean;
}

interface DesignPushResponse {
  ok?: boolean;
  revision?: number;
  designFileCount?: number;
  reconciledCollections?: string[];
  error?: { message?: string } | string;
}

function parseArgs(argv: string[]): CliFlags {
  const positional: string[] = [];
  let url: string | undefined;
  let token: string | undefined;
  let cookie: string | undefined;
  let branch: string | undefined;
  let title: string | undefined;
  let strictOracle = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--url' && argv[i + 1]) {
      url = argv[++i];
    } else if (a === '--token' && argv[i + 1]) {
      token = argv[++i];
    } else if (a === '--cookie' && argv[i + 1]) {
      cookie = argv[++i];
    } else if (a === '--branch' && argv[i + 1]) {
      branch = argv[++i];
    } else if (a === '--title' && argv[i + 1]) {
      title = argv[++i];
    } else if (a === '--strict-oracle') {
      strictOracle = true;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  return { positional, url, token, cookie, branch, title, strictOracle };
}

export interface SiteCheckReport {
  siteId: string;
  ok: boolean;
  collections: number;
  dtsUpdated: boolean;
  errors: string[];
}

export function checkOneSite(repoRoot: string, siteId: string, strictOracle = false): SiteCheckReport {
  const sitesRoot = path.join(repoRoot, 'sites');
  const siteDir = path.join(sitesRoot, siteId);
  if (!SITE_ID_RE.test(siteId) || !fs.existsSync(siteDir)) {
    return { siteId, ok: false, collections: 0, dtsUpdated: false, errors: [`Site "${siteId}" does not exist under sites/.`] };
  }

  const prevDtsPath = path.join(siteDir, 'cms', 'cms-types.d.ts');
  const prevDts = fs.existsSync(prevDtsPath) ? fs.readFileSync(prevDtsPath, 'utf-8') : null;
  const dtsRel = syncSiteCmsTypesDts(siteDir);
  const nextDts = dtsRel && fs.existsSync(prevDtsPath) ? fs.readFileSync(prevDtsPath, 'utf-8') : null;
  const dtsUpdated = prevDts !== nextDts;

  const files = walkManagedFiles(siteDir);
  const errors: string[] = [];

  // 1. Parse-check every TS/TSX file in app/ and components/.
  for (const [relPath, code] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?)$/.test(relPath)) continue;
    try {
      parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch (err) {
      errors.push(`${relPath}: syntax error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Full CMS contract check (Schemas + Data ↔ Schema + AST View ↔ Schema + seoBindings).
  const { schemas, issues } = validateFullCmsSite(files);
  for (const issue of issues) {
    errors.push(`[${issue.code}] ${issue.message}`);
  }

  // 3. Optional strict Oracle check across all page/component surfaces.
  if (strictOracle) {
    for (const [relPath, code] of Object.entries(files)) {
      let kind: FileKind | null = null;
      if (relPath.startsWith('app/') && relPath.endsWith('page.client.tsx')) kind = 'page';
      else if (relPath.startsWith('app/') && relPath.endsWith('LayoutClient.tsx')) kind = 'template';
      else if (relPath.startsWith('components/') && relPath.endsWith('.tsx')) {
        kind = isCodeComponentSource(code) ? 'code-component' : 'component';
      }
      if (!kind) continue;
      for (const v of checkFile(code, { kind, path: relPath, schemas, cmsRoutes: collectCmsDetailRoutes(files), readProjectFile: p => files[p] })) {
        errors.push(`[ORACLE:${v.code}:tier${v.tier}] ${relPath}${v.line ? `:${v.line}` : ''} — ${v.message}`);
      }
    }
  }

  return {
    siteId,
    ok: errors.length === 0,
    collections: schemas.size,
    dtsUpdated,
    errors,
  };
}

function resolveRemoteAuth(repoRoot: string, flags: CliFlags): {
  origin: string;
  headers: Record<string, string>;
} {
  const fileEnv = readEnvFiles(repoRoot, 'CMS_');
  const rawUrl = flags.url || process.env.CMS_URL || fileEnv.CMS_URL || '';
  if (!rawUrl) {
    throw new Error('Missing CMS_URL. Set it in .env.local (the origin of your self-hosted CMS) or pass --url <origin>.');
  }
  const origin = new URL(rawUrl).origin;
  const token = flags.token || process.env.CMS_ADMIN_TOKEN || fileEnv.CMS_ADMIN_TOKEN || '';
  const cookie = flags.cookie || process.env.CMS_COOKIE || fileEnv.CMS_COOKIE || '';
  if (!token && !cookie) {
    throw new Error(
      'Missing CMS credentials. Set CMS_ADMIN_TOKEN in .env.local (matching ADMIN_API_TOKEN on the server) or pass --token <token>.',
    );
  }
  const headers: Record<string, string> = { Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  return { origin, headers };
}

async function cmdNew(repoRoot: string, flags: CliFlags): Promise<void> {
  const rawId = flags.positional[1];
  if (!rawId) {
    throw new Error('Usage: npm run site:new <site-id> [Site Name]');
  }
  const siteId = rawId.trim().toLowerCase();
  if (!SITE_ID_RE.test(siteId)) {
    throw new Error(`Invalid site id "${siteId}" (use lowercase letters, numbers, hyphens).`);
  }
  const siteName = flags.positional.slice(2).join(' ').trim() || siteId.charAt(0).toUpperCase() + siteId.slice(1);
  const sitesRoot = path.join(repoRoot, 'sites');
  const siteDir = path.join(sitesRoot, siteId);
  if (fs.existsSync(siteDir) && fs.readdirSync(siteDir).length > 0) {
    throw new Error(`sites/${siteId} already exists and is not empty.`);
  }
  const runtimeRange = readRuntimeRange(repoRoot);
  const { managedFiles } = scaffoldCmsFirstSite(sitesRoot, siteId, siteName, runtimeRange);
  const report = checkOneSite(repoRoot, siteId, true);
  if (!report.ok) {
    throw new Error(`Scaffold verification failed:\n  ${report.errors.join('\n  ')}`);
  }
  console.log(`Created CMS-first site "${siteName}" at sites/${siteId} (${managedFiles.length} managed files, oracle + contract clean).`);
}

async function cmdCheck(repoRoot: string, flags: CliFlags): Promise<void> {
  const sitesRoot = path.join(repoRoot, 'sites');
  const targetId = flags.positional[1];
  const ids = targetId ? [targetId] : listAllSites(sitesRoot).map((s) => s.id);
  if (ids.length === 0) {
    console.log('No sites found under sites/.');
    return;
  }
  let failed = false;
  for (const id of ids) {
    const rep = checkOneSite(repoRoot, id, flags.strictOracle);
    if (rep.ok) {
      console.log(`✓ ${id}: OK (${rep.collections} CMS collections${rep.dtsUpdated ? ', regenerated cms/cms-types.d.ts' : ''})`);
    } else {
      failed = true;
      console.error(`✗ ${id}: ${rep.errors.length} issue(s):`);
      for (const e of rep.errors) console.error(`  - ${e}`);
    }
  }
  if (failed) process.exitCode = 1;
}

async function cmdPullContent(repoRoot: string, flags: CliFlags): Promise<void> {
  const siteId = flags.positional[1];
  if (!siteId) throw new Error('Usage: npm run content:pull <site-id> [--url <origin>] [--token <token>]');
  if (!SITE_ID_RE.test(siteId)) throw new Error(`Invalid site id "${siteId}".`);

  const { origin, headers } = resolveRemoteAuth(repoRoot, flags);
  const res = await fetch(`${origin}/api/sites/${encodeURIComponent(siteId)}/content`, {
    method: 'GET',
    headers,
  });
  const payload = (await res.json().catch(() => null)) as {
    id?: string;
    name?: string;
    revision?: number;
    cmsFiles?: Record<string, string>;
    mediaFiles?: Array<{ path: string; size: number; sha1: string }>;
    error?: { message?: string } | string;
  } | null;

  if (!res.ok || !payload) {
    const msg = typeof payload?.error === 'string' ? payload.error : payload?.error?.message || `HTTP ${res.status}`;
    throw new Error(`content:pull failed (${res.status}): ${msg}`);
  }

  const sitesRoot = path.join(repoRoot, 'sites');
  const siteDir = path.join(sitesRoot, siteId);
  if (!fs.existsSync(siteDir)) {
    throw new Error(`Local sites/${siteId} does not exist. Create or clone the local site design first.`);
  }

  let writtenCms = 0;
  for (const [relPath, content] of Object.entries(payload.cmsFiles ?? {})) {
    if (!isCmsDataPath(relPath)) continue;
    const abs = path.join(siteDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    writtenCms++;
  }

  let downloadedMedia = 0;
  const publicDir = path.join(siteDir, 'public');
  for (const media of payload.mediaFiles ?? []) {
    if (!isContentPublicAssetPath(media.path)) continue;
    const abs = path.resolve(publicDir, media.path);
    if (!abs.startsWith(publicDir + path.sep)) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const localSha = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
      if (localSha === media.sha1) continue;
    }
    const assetRes = await fetch(
      `${origin}/api/sites/${encodeURIComponent(siteId)}/content/asset?path=${encodeURIComponent(media.path)}`,
      { method: 'GET', headers },
    );
    if (!assetRes.ok) {
      throw new Error(`Failed to download media "${media.path}" (${assetRes.status}).`);
    }
    const bytes = Buffer.from(await assetRes.arrayBuffer());
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
    downloadedMedia++;
  }

  // Update managedFiles list in local _revyme/project-meta.json without touching views or schemas.
  const prevMeta = readSiteMeta(siteDir, siteId);
  const managedFiles = Object.keys(walkManagedFiles(siteDir)).sort();
  writeSiteMeta(siteDir, {
    ...prevMeta,
    managedFiles,
    updatedAt: new Date().toISOString(),
  });

  const postCheck = checkOneSite(repoRoot, siteId, false);
  if (!postCheck.ok) {
    console.warn(`⚠ Pulled content has contract warnings against local schemas:\n  ${postCheck.errors.join('\n  ')}`);
  }

  console.log(
    `✓ Pulled content for "${siteId}" ← ${origin} (revision ${payload.revision ?? 0}, ${writtenCms} CMS files, ${downloadedMedia} new/updated media files). Local views & schemas untouched.`,
  );
}

export async function main(argv = process.argv.slice(2), repoRoot = process.cwd()): Promise<void> {
  const flags = parseArgs(argv);
  const cmd = flags.positional[0];
  switch (cmd) {
    case 'new':
      await cmdNew(repoRoot, flags);
      return;
    case 'check':
      await cmdCheck(repoRoot, flags);
      return;
    case 'push-design':
      // Retired: design reached the server's main with no review. Local work
      // now goes to a branch the owner reviews and applies
      // (briefs/22-11-2026-branch-review-workflow.md, D5).
      throw new Error(`design:push is retired. Push local work as a branch instead: npm run branch:push ${flags.positional[1] ?? '<site-id>'} (or keep it in sync with npm run site:dev).`);
    case 'pull-content':
      await cmdPullContent(repoRoot, flags);
      return;
    case 'pull':
      await cmdPull(repoRoot, flags);
      return;
    case 'branch-push':
      await cmdBranchPush(repoRoot, flags);
      return;
    case 'branch-done':
      await cmdBranchDone(repoRoot, flags);
      return;
    case 'dev':
      await cmdDev(repoRoot, flags);
      return;
    case 'agent-token':
      await cmdAgentToken(repoRoot, flags);
      return;
    default:
      throw new Error(
        'Usage: site-sync <new|check|pull|branch-push|branch-done|dev|agent-token|pull-content> [siteId] [--url <origin>] [--token <token>] [--title <text>] [--strict-oracle]',
      );
  }
}

if (process.env.REVYME_SITE_CLI_RUN === '1') {
  void main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
