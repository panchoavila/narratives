// sites-plugin.ts — Disk-backed multi-site API and static-asset middleware for Vite.
//
// Each site lives in `<repoRoot>/sites/<siteId>/` as a real, runnable Next.js
// project ready for Vercel deployment:
//   - ProjectFS files (`app/`, `components/`, `cms/`, `i18n/`, `messages/`,
//     `icons/`, `overrides/`, `plugins/`, `_meta/`) are stored as real files.
//   - Builder envelope metadata (`name`, `format`, `branches`, `activeBranchId`,
//     `mainBranchId`, `settings`, `managedFiles`) lives in `_revyme/project-meta.json`.
//   - Static assets live in `sites/<siteId>/public/` and are served at root paths
//     across the editor (:3333), canvas sandbox (:5174), and preview sandbox (:5175).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { WorkspaceFont } from '../backend/types';
import { inspectFontBinary } from './font-binary-inspector';
import { fetchAdobeTypekitKits, ingestAdobeFontsLowLevel } from './adobe-fonts-lowlevel';
import { createPublishingMiddleware } from './site-publishing';
import {
  generateCmsTypesDts,
  isCmsDataPath,
  parseSchemasFromFiles,
  validateAllCmsDataFiles,
  type CmsContractIssue,
} from '../shared/cms-site-contract';
import { RTL_TEXT_CSS } from '../shared/rtl-text';
import { ADDITIONAL_SOURCE_DIRECTORIES, PROJECT_CONFIG_FILES, SOURCE_FILE_CONTRACT_PATH, SOURCE_FILE_CONTRACT, isAdditionalProjectSourcePath, understandsAdditionalSourceFiles } from '../shared/project-source-files';

const MANAGED_TOP_DIRS = new Set([
  ...ADDITIONAL_SOURCE_DIRECTORIES,
  'app',
  'components',
  'cms',
  'i18n',
  'messages',
  'icons',
  'overrides',
  'plugins',
  '_meta',
]);

export const SITE_ID_RE = /^[a-z0-9][a-z0-9-_]{0,62}$/;

export interface SiteAdobeKitMeta {
  kitId: string;
  input: string;
  preserveSlugAsFamily?: boolean;
  syncedAt: string;
  fonts: WorkspaceFont[];
}

export interface SiteMetaFile {
  id: string;
  name: string;
  format: 'revyme-v1' | 'revyme-v2' | 'canvas-poc-v1';
  /** True when content is 100% CMS-managed on self-hosted servers while design,
   *  views, and schemas are maintained locally. */
  cmsOnly?: boolean;
  branches?: Record<string, unknown>;
  activeBranchId?: string;
  mainBranchId?: string;
  settings?: Record<string, unknown>;
  managedFiles?: string[];
  adobeKit?: SiteAdobeKitMeta | null;
  updatedAt?: string;
}

export interface SiteSummary {
  id: string;
  name: string;
  cmsOnly?: boolean;
  pageCount: number;
  collectionCount: number;
  updatedAt: string;
}

export const MIME_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export function isManagedProjectPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return false;
  if (normalized.split('/').some(part => part.startsWith('.'))) return false;
  if (PROJECT_CONFIG_FILES.has(normalized)) return true;
  const top = normalized.split('/')[0] ?? '';
  return MANAGED_TOP_DIRS.has(top);
}

export function walkManagedFiles(siteDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const topDir of MANAGED_TOP_DIRS) {
    const absTop = path.join(siteDir, topDir);
    if (!fs.existsSync(absTop) || !fs.statSync(absTop).isDirectory()) continue;
    const walk = (dir: string, relPrefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const absChild = path.join(dir, entry.name);
        const relChild = `${relPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(absChild, relChild);
        } else if (entry.isFile()) {
          files[relChild] = fs.readFileSync(absChild, 'utf-8');
        }
      }
    };
    walk(absTop, topDir);
  }
  for (const file of PROJECT_CONFIG_FILES) {
    const absolute = path.join(siteDir, file);
    if (fs.existsSync(absolute) && fs.lstatSync(absolute).isFile()) files[file] = fs.readFileSync(absolute, 'utf8');
  }
  return files;
}

function removeEmptyDirs(dir: string, stopAt: string): void {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }
    const entries = fs.readdirSync(current).filter((e) => e !== '.DS_Store');
    if (entries.length === 0) {
      fs.rmSync(current, { recursive: true, force: true });
      current = path.dirname(current);
    } else {
      break;
    }
  }
}

export function readSiteMeta(siteDir: string, siteId: string): SiteMetaFile {
  const metaPath = path.join(siteDir, '_revyme', 'project-meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SiteMetaFile;
      return {
        id: siteId,
        name: parsed.name || siteId,
        format: parsed.format || 'revyme-v1',
        ...(typeof parsed.cmsOnly === 'boolean' ? { cmsOnly: parsed.cmsOnly } : {}),
        branches: parsed.branches,
        activeBranchId: parsed.activeBranchId,
        mainBranchId: parsed.mainBranchId,
        settings: parsed.settings,
        managedFiles: parsed.managedFiles,
        adobeKit: parsed.adobeKit ?? null,
        updatedAt: parsed.updatedAt,
      };
    } catch {
      // Fall through to default metadata
    }
  }
  return {
    id: siteId,
    name: siteId.charAt(0).toUpperCase() + siteId.slice(1),
    format: 'revyme-v1',
  };
}

export function writeSiteMeta(siteDir: string, meta: SiteMetaFile): void {
  const metaDir = path.join(siteDir, '_revyme');
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(
    path.join(metaDir, 'project-meta.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf-8',
  );
}

export function ensureNextScaffold(siteDir: string, siteId: string, siteName: string, runtimeRange = '^0.0.32'): void {
  const pkgPath = path.join(siteDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    const pkg = {
      name: siteId,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        react: '^19',
        'react-dom': '^19',
        next: '^16',
        'framer-motion': '^12',
        'next-themes': 'latest',
        'next-intl': 'latest',
        '@revyme/runtime': runtimeRange,
        'perfect-freehand': '^1.2',
        lenis: '^1.3.26',
      },
      devDependencies: {
        typescript: '^5',
        '@types/react': '^19',
        '@types/react-dom': '^19',
        '@types/node': '^20',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }

  const nextConfigPath = path.join(siteDir, 'next.config.mjs');
  if (!['next.config.mjs', 'next.config.js', 'next.config.ts'].some(file => fs.existsSync(path.join(siteDir, file)))) {
    fs.writeFileSync(
      nextConfigPath,
      `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n  typescript: { ignoreBuildErrors: false },\n};\n\nexport default nextConfig;\n`,
      'utf-8',
    );
  }

  const tsconfigPath = path.join(siteDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noImplicitAny: false,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'react-jsx',
        incremental: true,
        paths: { '@/*': ['./*'] },
        plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'],
      exclude: ['node_modules'],
    };
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n', 'utf-8');
  }

  const gitignorePath = path.join(siteDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      `node_modules\n/.next\n/out\n/build\n/dist\n.env*.local\n.DS_Store\n*.log\n`,
      'utf-8',
    );
  }

  const readmePath = path.join(siteDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      `# ${siteName}\n\nManaged with Narratives and ready for Vercel deployment.\n`,
      'utf-8',
    );
  }

  fs.mkdirSync(path.join(siteDir, 'public', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(siteDir, 'public', 'uploads'), { recursive: true });
}

/** Regenerate `cms/cms-types.d.ts` on disk whenever `cms/*.schema.json` exists. */
export function syncSiteCmsTypesDts(siteDir: string): string | null {
  const cmsDir = path.join(siteDir, 'cms');
  if (!fs.existsSync(cmsDir) || !fs.statSync(cmsDir).isDirectory()) return null;
  const schemaEntries: Record<string, string> = {};
  for (const entry of fs.readdirSync(cmsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.schema.json')) {
      schemaEntries[`cms/${entry.name}`] = fs.readFileSync(path.join(cmsDir, entry.name), 'utf-8');
    }
  }
  if (Object.keys(schemaEntries).length === 0) return null;
  const { schemas } = parseSchemasFromFiles(schemaEntries);
  if (schemas.size === 0) return null;
  const dts = generateCmsTypesDts(schemas);
  fs.writeFileSync(path.join(cmsDir, 'cms-types.d.ts'), dts, 'utf-8');
  return 'cms/cms-types.d.ts';
}

export function listAllSites(sitesRoot: string): SiteSummary[] {
  if (!fs.existsSync(sitesRoot)) return [];
  const summaries: SiteSummary[] = [];
  for (const entry of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SITE_ID_RE.test(entry.name)) continue;
    const siteId = entry.name;
    const siteDir = path.join(sitesRoot, siteId);
    const meta = readSiteMeta(siteDir, siteId);
    const files = walkManagedFiles(siteDir);
    const paths = Object.keys(files);
    const pageCount = paths.filter((p) => p.startsWith('app/') && p.endsWith('/page.client.tsx') || p === 'app/page.client.tsx').length;
    const collectionCount = paths.filter((p) => p.startsWith('cms/') && p.endsWith('.schema.json')).length;
    const stat = fs.statSync(siteDir);
    summaries.push({
      id: siteId,
      name: meta.name,
      ...(meta.cmsOnly ? { cmsOnly: true } : {}),
      pageCount,
      collectionCount,
      updatedAt: meta.updatedAt || stat.mtime.toISOString(),
    });
  }
  return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export interface WorkspaceConfigFile {
  id: string;
  name: string;
  logoInitial: string;
  logoColor: string;
  accountName: string;
  accountEmail: string;
  plan: string;
  credits: number | null;
  preserveSlugAsFamily: boolean;
  connectedKits: Array<{
    kitId: string;
    syncedAt: string;
    faceCount: number;
    families: string[];
  }>;
  fonts: WorkspaceFont[];
}

function readWorkspaceConfig(sitesRoot: string): WorkspaceConfigFile {
  const wsDir = path.join(sitesRoot, '.workspace');
  const wsFile = path.join(wsDir, 'workspace.json');
  const defaults: WorkspaceConfigFile = {
    id: 'local-workspace',
    name: 'My Workspace',
    logoInitial: 'M',
    logoColor: '#6366f1',
    accountName: '',
    accountEmail: '',
    plan: 'Local mode',
    credits: null,
    preserveSlugAsFamily: false,
    connectedKits: [],
    fonts: [],
  };
  if (!fs.existsSync(wsFile)) return defaults;
  try {
    const parsed = JSON.parse(fs.readFileSync(wsFile, 'utf-8')) as Partial<WorkspaceConfigFile>;
    return {
      ...defaults,
      ...parsed,
      connectedKits: Array.isArray(parsed.connectedKits) ? parsed.connectedKits : defaults.connectedKits,
      fonts: Array.isArray(parsed.fonts) ? parsed.fonts : defaults.fonts,
    };
  } catch {
    return defaults;
  }
}

function writeWorkspaceConfig(sitesRoot: string, config: WorkspaceConfigFile): void {
  const wsDir = path.join(sitesRoot, '.workspace');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'workspace.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function materializeSiteWorkspaceFonts(sitesRoot: string, siteDir: string, incomingFiles: Record<string, string>): void {
  const globalsCss = incomingFiles['app/globals.css'];
  if (!globalsCss || !globalsCss.includes('/workspace-fonts/')) return;
  const wsFontsDir = path.join(sitesRoot, '.workspace', 'fonts');
  if (!fs.existsSync(wsFontsDir)) return;
  const siteFontsDir = path.join(siteDir, 'public', 'workspace-fonts');
  const re = /\/workspace-fonts\/([a-zA-Z0-9._-]+)/g;
  for (const match of globalsCss.matchAll(re)) {
    const fileName = match[1];
    if (!fileName || fileName.includes('..')) continue;
    const srcPath = path.join(wsFontsDir, fileName);
    if (fs.existsSync(srcPath) && fs.statSync(srcPath).isFile()) {
      fs.mkdirSync(siteFontsDir, { recursive: true });
      fs.copyFileSync(srcPath, path.join(siteFontsDir, fileName));
    }
  }
}

export interface StaticAssetOptions {
  /** Which sites' `public/` this request may read. Default: every site (the
   *  single-user local editor). The self-hosted server limits it to the
   *  signed-in member's sites. */
  allowSite?: (req: IncomingMessage, siteId: string) => boolean;
}

export function createStaticAssetMiddleware(repoRoot: string, options: StaticAssetOptions = {}) {
  const sitesRoot = path.join(repoRoot, 'sites');
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rawUrl = req.url ?? '/';
    const pathname = decodeURIComponent(rawUrl.split('?')[0] ?? '/');
    if (
      pathname === '/' ||
      pathname.startsWith('/src/') ||
      pathname.startsWith('/@') ||
      pathname.startsWith('/node_modules/') ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/__') ||
      pathname.includes('..')
    ) {
      return next();
    }

    if (!fs.existsSync(sitesRoot)) return next();

    // Serve shared workspace fonts (/workspace-fonts/<fileName>) across editor, canvas iframe, and preview
    if (pathname.startsWith('/workspace-fonts/')) {
      const fontFile = path.basename(pathname);
      const wsFontCandidate = path.join(sitesRoot, '.workspace', 'fonts', fontFile);
      if (fs.existsSync(wsFontCandidate) && fs.statSync(wsFontCandidate).isFile()) {
        const ext = path.extname(wsFontCandidate).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(wsFontCandidate).pipe(res);
        return;
      }
    }

    for (const entry of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SITE_ID_RE.test(entry.name)) continue;
      if (options.allowSite && !options.allowSite(req, entry.name)) continue;
      const candidate = path.join(sitesRoot, entry.name, 'public', pathname);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const ext = path.extname(candidate).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }
    next();
  };
}

/** `@revyme/runtime` range new site scaffolds depend on: the editor's own. */
export function readRuntimeRange(repoRoot: string): string {
  try {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    if (rootPkg?.dependencies?.['@revyme/runtime']) {
      return rootPkg.dependencies['@revyme/runtime'];
    }
  } catch {
    // keep fallback
  }
  return '^0.0.32';
}

export interface SiteProjectPayload {
  id: string;
  name: string;
  cmsOnly: boolean;
  project: {
    format: SiteMetaFile['format'];
    files: Record<string, string>;
    branches?: Record<string, unknown>;
    activeBranchId?: string;
    mainBranchId?: string;
    settings?: Record<string, unknown>;
  };
}

/** The `GET /api/sites/:id` body, or null when the site does not exist. */
export function readSiteProject(sitesRoot: string, siteId: string): SiteProjectPayload | null {
  if (!SITE_ID_RE.test(siteId)) return null;
  const siteDir = path.join(sitesRoot, siteId);
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) return null;
  const meta = readSiteMeta(siteDir, siteId);
  const files = walkManagedFiles(siteDir);
  files[SOURCE_FILE_CONTRACT_PATH] = SOURCE_FILE_CONTRACT;
  return {
    id: siteId,
    name: meta.name,
    cmsOnly: meta.cmsOnly === true,
    project: {
      format: meta.format || 'revyme-v1',
      files,
      ...(meta.branches ? { branches: meta.branches } : {}),
      ...(meta.activeBranchId ? { activeBranchId: meta.activeBranchId } : {}),
      ...(meta.mainBranchId ? { mainBranchId: meta.mainBranchId } : {}),
      ...(meta.settings ? { settings: meta.settings } : {}),
    },
  };
}

/**
 * Persist a saved project envelope (`PUT /api/sites/:id` body) to disk:
 * writes every managed file, deletes managed files the envelope no longer
 * lists, keeps the scaffold and metadata current. Returns the file count.
 */
export function writeSiteProject(sitesRoot: string, siteId: string, data: any, runtimeRange: string): number {
  if (!SITE_ID_RE.test(siteId)) throw new Error(`Invalid site ID: ${siteId}`);
  const siteDir = path.join(sitesRoot, siteId);
  const incomingFiles: Record<string, string> = data?.files && typeof data.files === 'object' ? data.files : {};
  const supportsAdditionalFiles = understandsAdditionalSourceFiles(incomingFiles);
  fs.mkdirSync(siteDir, { recursive: true });

  const prevMeta = readSiteMeta(siteDir, siteId);
  const existingDiskFiles = walkManagedFiles(siteDir);
  const previousSet = new Set<string>([
    ...(prevMeta.managedFiles ?? []),
    ...Object.keys(existingDiskFiles),
  ]);

  // Write incoming files
  const nextManaged: string[] = [];
  for (const [relPath, content] of Object.entries(incomingFiles)) {
    if (!isManagedProjectPath(relPath)) continue;
    const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absFile = path.join(siteDir, cleanRel);
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, String(content), 'utf-8');
    nextManaged.push(cleanRel);
    previousSet.delete(cleanRel);
  }

  // `cms/cms-types.d.ts` is derived from `cms/*.schema.json`; never delete it
  // just because a browser ProjectFS snapshot omitted it, then regenerate fresh.
  previousSet.delete('cms/cms-types.d.ts');

  // Remove deleted managed files
  for (const removedRel of previousSet) {
    if (!isManagedProjectPath(removedRel)) continue;
    // An older open editor never received these files. Its snapshot cannot
    // delete them, even after a newer tab has adopted the expanded contract.
    if (!supportsAdditionalFiles && (isAdditionalProjectSourcePath(removedRel) || removedRel === SOURCE_FILE_CONTRACT_PATH)) {
      if (fs.existsSync(path.join(siteDir, removedRel))) nextManaged.push(removedRel);
      continue;
    }
    const absRemoved = path.join(siteDir, removedRel);
    if (fs.existsSync(absRemoved) && fs.statSync(absRemoved).isFile()) {
      fs.rmSync(absRemoved, { force: true });
      removeEmptyDirs(path.dirname(absRemoved), siteDir);
    }
  }

  ensureNextScaffold(siteDir, siteId, prevMeta.name, runtimeRange);
  const generatedDts = syncSiteCmsTypesDts(siteDir);
  if (generatedDts && !nextManaged.includes(generatedDts)) {
    nextManaged.push(generatedDts);
  }
  materializeSiteWorkspaceFonts(sitesRoot, siteDir, incomingFiles);
  const cmsOnly = typeof data?.cmsOnly === 'boolean' ? data.cmsOnly : prevMeta.cmsOnly;
  writeSiteMeta(siteDir, {
    id: siteId,
    name: prevMeta.name,
    format: data?.format || prevMeta.format || 'revyme-v1',
    ...(typeof cmsOnly === 'boolean' ? { cmsOnly } : {}),
    branches: data?.branches,
    activeBranchId: data?.activeBranchId,
    mainBranchId: data?.mainBranchId,
    settings: data?.settings,
    managedFiles: nextManaged.sort(),
    adobeKit: prevMeta.adobeKit ?? null,
    updatedAt: new Date().toISOString(),
  });
  return nextManaged.length;
}

/**
 * Self-hosted save path for `cmsOnly` sites: validates and persists ONLY
 * `cms/<slug>.json` data files against the on-disk `cms/<slug>.schema.json`
 * contracts. Design, views (`app/`, `components/`), and schemas are never
 * modified or deleted.
 */
export function writeSiteCmsContent(
  sitesRoot: string,
  siteId: string,
  incomingFiles: Record<string, string>,
): { fileCount: number; writtenPaths: string[]; issues: CmsContractIssue[] } {
  if (!SITE_ID_RE.test(siteId)) throw new Error(`Invalid site ID: ${siteId}`);
  const siteDir = path.join(sitesRoot, siteId);
  const diskFiles = walkManagedFiles(siteDir);
  const { schemas, issues: schemaIssues } = parseSchemasFromFiles(diskFiles);
  if (schemaIssues.length > 0) {
    return { fileCount: 0, writtenPaths: [], issues: schemaIssues };
  }

  const cmsDataIncoming: Record<string, string> = {};
  for (const [relPath, content] of Object.entries(incomingFiles)) {
    if (!isCmsDataPath(relPath)) continue;
    const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    cmsDataIncoming[cleanRel] = String(content);
  }

  const dataIssues = validateAllCmsDataFiles(cmsDataIncoming, schemas);
  if (dataIssues.length > 0) {
    return { fileCount: 0, writtenPaths: [], issues: dataIssues };
  }

  const writtenPaths: string[] = [];
  for (const [cleanRel, content] of Object.entries(cmsDataIncoming)) {
    const absFile = path.join(siteDir, cleanRel);
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, content, 'utf-8');
    writtenPaths.push(cleanRel);
  }

  const prevMeta = readSiteMeta(siteDir, siteId);
  const managedSet = new Set<string>([
    ...(prevMeta.managedFiles ?? []),
    ...Object.keys(diskFiles),
    ...writtenPaths,
  ]);
  writeSiteMeta(siteDir, {
    ...prevMeta,
    managedFiles: [...managedSet].sort(),
    updatedAt: new Date().toISOString(),
  });

  return { fileCount: writtenPaths.length, writtenPaths, issues: [] };
}

/**
 * Scaffold a complete, oracle-clean "100% CMS-first" site (`cmsOnly: true`):
 *   - `cms/site.schema.json` + `cms/site.json` singleton for all site-wide copy
 *   - `cms/entries.schema.json` + `cms/entries.json` starter collection
 *   - `cms/cms-types.d.ts` generated from the schemas
 *   - `app/page.{tsx,client.tsx}` + `app/entries/[slug]/page.{tsx,client.tsx}`
 *     with zero hardcoded prose in JSX and defensive empty-collection handling
 *   - `public/assets/` (design) + `public/uploads/` (CMS uploads)
 */
export function scaffoldCmsFirstSite(
  sitesRoot: string,
  siteId: string,
  siteName: string,
  runtimeRange = '^0.0.32',
): { siteDir: string; managedFiles: string[] } {
  if (!SITE_ID_RE.test(siteId)) throw new Error(`Invalid site ID: ${siteId}`);
  const siteDir = path.join(sitesRoot, siteId);
  fs.mkdirSync(siteDir, { recursive: true });
  ensureNextScaffold(siteDir, siteId, siteName, runtimeRange);

  const stamp = new Date().toISOString();
  const canvasBlock = `/** @canvas ${JSON.stringify({
    viewports: [
      { id: 'desktop', label: 'Desktop', width: 1200, isPrimary: true, order: 0 },
      { id: 'tablet', label: 'Tablet', width: 1199, designWidth: 810, isPrimary: false, order: 1 },
      { id: 'mobile', label: 'Mobile', width: 809, designWidth: 390, isPrimary: false, order: 2 },
    ],
    positions: {
      desktop: { x: 0, y: 0 },
      tablet: { x: 1300, y: 0 },
      mobile: { x: 2210, y: 0 },
    },
  })} */`;

  const siteSchema = {
    name: 'Site Copy',
    slug: 'site',
    fields: [
      { id: 'siteTitle', name: 'Site Title', type: 'text', required: true },
      { id: 'tagline', name: 'Tagline', type: 'textarea' },
      { id: 'entriesHeading', name: 'Entries Heading', type: 'text', required: true },
      { id: 'footerText', name: 'Footer Text', type: 'text' },
    ],
  };

  const siteData = [
    {
      _id: 'item_site_global',
      _slug: 'global',
      _status: 'published',
      _createdAt: stamp,
      _updatedAt: stamp,
      siteTitle: siteName,
      tagline: `Publicación editorial gestionada desde el CMS para ${siteName}.`,
      entriesHeading: 'Entradas recientes',
      footerText: `${siteName} — Contenido gestionado en CMS.`,
    },
  ];

  const entriesSchema = {
    name: 'Entries',
    slug: 'entries',
    fields: [
      { id: 'title', name: 'Title', type: 'text', required: true },
      { id: 'summary', name: 'Summary', type: 'textarea' },
      { id: 'body', name: 'Body', type: 'richtext' },
      { id: 'publishedOn', name: 'Published On', type: 'date' },
      { id: 'image', name: 'Cover Image', type: 'image' },
    ],
  };

  const entriesData = [
    {
      _id: 'item_entry_welcome',
      _slug: 'primera-entrada',
      _status: 'published',
      _createdAt: stamp,
      _updatedAt: stamp,
      title: 'Primera entrada',
      summary: 'Edita este contenido desde el CMS sin tocar las vistas locales.',
      body: 'Todo el contenido vive en colecciones CMS mientras el diseño y los componentes evolucionan en local.',
      publishedOn: stamp.slice(0, 10),
      image: '',
    },
  ];

  const globalsCss = `* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #0f172a;
  font-family: Inter, system-ui, sans-serif;
}
`;

  const layoutTsx = `import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: ${JSON.stringify(siteName)},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`;

  const providersTsx = `'use client';

/** @revyme-providers v4 — GENERATED from i18n/config.json (locales: en).
 *  The editor regenerates this file when locales change. Do not hand-edit. */

import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

const RTL_TEXT_CSS = ${JSON.stringify(RTL_TEXT_CSS)};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <div lang="en" style={{ display: 'contents' }}>
          <style dangerouslySetInnerHTML={{ __html: RTL_TEXT_CSS }} />
          {children}
        </div>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
`;

  const indexServer = `import PageClient from './page.client';

export const metadata = {};

export default function Page() {
  return <PageClient />;
}
`;

  const indexClient = `'use client';

${canvasBlock}

import React from 'react';
import Link from 'next/link';
import site from '@/cms/site.json';
import entries from '@/cms/entries.json';

export default function Page() {
  return (
    <div data-id="root" data-name="Home" style={{
      position: 'relative', width: '100%', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '48px', padding: '64px 32px', backgroundColor: '#ffffff'
    }}>
      <div data-id="shell" data-name="Shell" style={{
        position: 'relative', width: '100%', maxWidth: '960px', height: 'auto',
        order: '0', flex: '0 0 auto',
        display: 'flex', flexDirection: 'column', gap: '48px'
      }}>
        <header data-id="site-header" data-name="Header" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '0', flex: '0 0 auto',
          display: 'flex', flexDirection: 'column', gap: '16px'
        }}>
          {site.slice(0, 1).map((siteItem, idx) => (
            <div data-id="site-copy-row" data-name="Site Copy" key={idx} style={{
              position: 'relative', width: '100%', height: 'auto',
              order: '0', flex: '0 0 auto',
              display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
              <h1 data-id="site-title" data-name="Site Title" style={{
                position: 'relative', width: '100%', height: 'auto',
                order: '0', flex: '0 0 auto',
                fontSize: '44px', fontWeight: '700', lineHeight: '1.1', color: '#0f172a',
                fontFamily: 'Inter, sans-serif', margin: '0px'
              }}>{siteItem.siteTitle}</h1>
              <p data-id="site-tagline" data-name="Tagline" style={{
                position: 'relative', width: '100%', maxWidth: '680px', height: 'auto',
                order: '1', flex: '0 0 auto',
                fontSize: '18px', fontWeight: '400', lineHeight: '1.6', color: '#475569',
                fontFamily: 'Inter, sans-serif', margin: '0px'
              }}>{siteItem.tagline}</p>
              <h2 data-id="entries-heading" data-name="Entries Heading" style={{
                position: 'relative', width: '100%', height: 'auto',
                order: '2', flex: '0 0 auto',
                fontSize: '20px', fontWeight: '600', lineHeight: '1.4', color: '#0f172a',
                fontFamily: 'Inter, sans-serif', margin: '16px 0px 0px 0px'
              }}>{siteItem.entriesHeading}</h2>
            </div>
          ))}
        </header>
        <section data-id="entries-list" data-name="Entries List" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '1', flex: '0 0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px'
        }}>
          {entries.map((item, idx) => (
            <Link data-id="entry-card" data-name="Entry Card" key={idx} data-cms-nav="row" href={\`/entries/\${item?._slug ?? ''}\`} style={{
              position: 'relative', width: '100%', height: 'auto',
              display: 'flex', flexDirection: 'column', gap: '10px',
              padding: '24px', borderRadius: '12px', backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0', textDecoration: 'none', color: 'inherit'
            }}>
              <p data-id="entry-date" data-name="Date" style={{
                position: 'relative', width: '100%', height: 'auto',
                order: '0', flex: '0 0 auto',
                fontSize: '12px', fontWeight: '500', lineHeight: '1.4', color: '#64748b',
                fontFamily: 'Inter, sans-serif', margin: '0px'
              }}>{item.publishedOn}</p>
              <h3 data-id="entry-title" data-name="Title" style={{
                position: 'relative', width: '100%', height: 'auto',
                order: '1', flex: '0 0 auto',
                fontSize: '20px', fontWeight: '600', lineHeight: '1.3', color: '#0f172a',
                fontFamily: 'Inter, sans-serif', margin: '0px'
              }}>{item.title}</h3>
              <p data-id="entry-summary" data-name="Summary" style={{
                position: 'relative', width: '100%', height: 'auto',
                order: '2', flex: '0 0 auto',
                fontSize: '15px', fontWeight: '400', lineHeight: '1.6', color: '#475569',
                fontFamily: 'Inter, sans-serif', margin: '0px'
              }}>{item.summary}</p>
            </Link>
          ))}
        </section>
        <footer data-id="site-footer" data-name="Footer" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '2', flex: '0 0 auto',
          display: 'flex', flexDirection: 'column', paddingTop: '24px',
          borderTop: '1px solid #e2e8f0'
        }}>
          {site.slice(0, 1).map((siteItem, idx) => (
            <div data-id="footer-row" data-name="Footer Row" key={idx} style={{
              position: 'relative', width: '100%', height: 'auto',
              order: '0', flex: '0 0 auto',
              display: 'flex', flexDirection: 'column'
            }}>
              <p data-id="footer-copy" data-name="Footer Copy" style={{
                position: 'relative', width: '100%', height: 'auto',
                order: '0', flex: '0 0 auto',
                fontSize: '13px', fontWeight: '400', lineHeight: '1.5', color: '#64748b',
                fontFamily: 'Inter, sans-serif', margin: '0px'
              }}>{siteItem.footerText}</p>
            </div>
          ))}
        </footer>
      </div>
    </div>
  );
}
`;

  const detailServer = `import PageClient from './page.client';
import entries from '@/cms/entries.json';

const seoDefaults = { title: ${JSON.stringify(siteName)} } as Record<string, string>;

const seoBindings = { title: "title", description: "summary", ogImage: "image" };

export async function generateMetadata({ params }) {
  const resolved = await params;
  const items = Array.isArray(entries) ? entries : [];
  const item = items.find((i) => i && i._slug === resolved?.slug);
  const bound = (slot) => {
    const field = seoBindings[slot];
    if (!field || !item) return undefined;
    const value = item[field];
    return typeof value === 'string' && value ? value : undefined;
  };
  const pick = (slot: string, fallbackSlot?: string) =>
    bound(slot) ?? seoDefaults[slot] ?? (fallbackSlot ? bound(fallbackSlot) ?? seoDefaults[fallbackSlot] : undefined) ?? undefined;

  const title = pick('title');
  const description = pick('description');
  const ogImage = pick('ogImage');
  const twitterImage = pick('twitterImage') ?? ogImage;

  return {
    title,
    description,
    openGraph: {
      title: pick('ogTitle', 'title'),
      description: pick('ogDescription', 'description'),
      images: ogImage ? [ogImage] : [],
    },
    twitter: {
      card: seoDefaults.twitterCard || undefined,
      title: pick('twitterTitle', 'title'),
      description: pick('twitterDescription', 'description'),
      images: twitterImage ? [twitterImage] : [],
    },
    alternates: { canonical: seoDefaults.canonical || undefined },
  };
}

export function generateStaticParams() {
  return (Array.isArray(entries) ? entries : [])
    .filter((i) => i && typeof i._slug === 'string' && i._slug !== '')
    .map((i) => ({ slug: i._slug }));
}

export const dynamicParams = false;

export default function Page() {
  return <PageClient />;
}
`;

  const detailClient = `'use client';

${canvasBlock}

/** @cmsPage {
  "collection": "entries",
  "kind": "detail"
} */

import React from 'react';
import { useParams } from 'next/navigation';
import entries from '@/cms/entries.json';

export default function Page() {
  const params = useParams();
  const item = entries.find((i) => i._slug === params?.slug) ?? entries[0] ?? ({} as Record<string, any>);
  return (
    <div data-id="root" key={String(params?.slug ?? '')} data-name="Entry Detail" style={{
      position: 'relative', width: '100%', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '80px 32px', backgroundColor: '#ffffff'
    }}>
      <article data-id="article-shell" data-name="Article" style={{
        position: 'relative', width: '100%', maxWidth: '720px', height: 'auto',
        order: '0', flex: '0 0 auto',
        display: 'flex', flexDirection: 'column', gap: '20px'
      }}>
        <p data-id="detail-date" data-name="Published On" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '0', flex: '0 0 auto',
          fontSize: '13px', fontWeight: '500', lineHeight: '1.4', color: '#64748b',
          fontFamily: 'Inter, sans-serif', margin: '0px'
        }}>{item.publishedOn}</p>
        <h1 data-id="detail-title" data-name="Title" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '1', flex: '0 0 auto',
          fontSize: '42px', fontWeight: '700', lineHeight: '1.15', color: '#0f172a',
          fontFamily: 'Inter, sans-serif', margin: '0px'
        }}>{item.title}</h1>
        <p data-id="detail-summary" data-name="Summary" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '2', flex: '0 0 auto',
          fontSize: '19px', fontWeight: '400', lineHeight: '1.6', color: '#475569',
          fontFamily: 'Inter, sans-serif', margin: '0px'
        }}>{item.summary}</p>
        <p data-id="detail-body" data-name="Body" style={{
          position: 'relative', width: '100%', height: 'auto',
          order: '3', flex: '0 0 auto',
          fontSize: '16px', fontWeight: '400', lineHeight: '1.75', color: '#1e293b',
          fontFamily: 'Inter, sans-serif', margin: '0px'
        }}>{item.body}</p>
      </article>
    </div>
  );
}
`;

  const starterFiles: Record<string, string> = {
    'app/globals.css': globalsCss,
    'app/layout.tsx': layoutTsx,
    'app/providers.tsx': providersTsx,
    'app/page.tsx': indexServer,
    'app/page.client.tsx': indexClient,
    'app/entries/[slug]/page.tsx': detailServer,
    'app/entries/[slug]/page.client.tsx': detailClient,
    'cms/site.schema.json': JSON.stringify(siteSchema, null, 2) + '\n',
    'cms/site.json': JSON.stringify(siteData, null, 2) + '\n',
    'cms/entries.schema.json': JSON.stringify(entriesSchema, null, 2) + '\n',
    'cms/entries.json': JSON.stringify(entriesData, null, 2) + '\n',
    'i18n/config.json': JSON.stringify({ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] }, null, 2) + '\n',
    'messages/en.json': '{}\n',
  };

  for (const [relPath, content] of Object.entries(starterFiles)) {
    const abs = path.join(siteDir, relPath);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
    }
  }

  const dtsRel = syncSiteCmsTypesDts(siteDir);
  const managedFiles = Object.keys(walkManagedFiles(siteDir));
  if (dtsRel && !managedFiles.includes(dtsRel)) managedFiles.push(dtsRel);
  managedFiles.sort();

  const existingMeta = readSiteMeta(siteDir, siteId);
  writeSiteMeta(siteDir, {
    ...existingMeta,
    id: siteId,
    name: siteName,
    format: 'revyme-v1',
    cmsOnly: true,
    managedFiles,
    updatedAt: stamp,
  });

  return { siteDir, managedFiles };
}

export function createSitesApiMiddleware(repoRoot: string) {
  const sitesRoot = path.join(repoRoot, 'sites');
  const runtimeRange = readRuntimeRange(repoRoot);

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const rawUrl = req.url ?? '/';
    const pathname = decodeURIComponent(rawUrl.split('?')[0] ?? '/');
    if (!pathname.startsWith('/api/sites')) return next();

    const segments = pathname.split('/').filter(Boolean); // ['api', 'sites', :id?, :sub?]

    try {
      // GET /api/sites
      if (segments.length === 2 && req.method === 'GET') {
        const sites = listAllSites(sitesRoot);
        sendJson(res, 200, { sites });
        return;
      }

      // POST /api/sites
      if (segments.length === 2 && req.method === 'POST') {
        const body = await readJsonBody(req);
        const rawName = String(body?.name || 'New Site').trim();
        const rawId = String(body?.id || rawName)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '') || `site-${Date.now()}`;
        if (!SITE_ID_RE.test(rawId)) {
          sendJson(res, 400, { error: 'Invalid site ID' });
          return;
        }
        const siteDir = path.join(sitesRoot, rawId);
        if (body?.cmsOnly === false) {
          fs.mkdirSync(siteDir, { recursive: true });
          ensureNextScaffold(siteDir, rawId, rawName, runtimeRange);
          const existingMeta = readSiteMeta(siteDir, rawId);
          writeSiteMeta(siteDir, {
            ...existingMeta,
            id: rawId,
            name: rawName,
            format: 'revyme-v1',
            cmsOnly: false,
            updatedAt: new Date().toISOString(),
          });
          sendJson(res, 201, { id: rawId, name: rawName, cmsOnly: false });
          return;
        }
        scaffoldCmsFirstSite(sitesRoot, rawId, rawName, runtimeRange);
        sendJson(res, 201, { id: rawId, name: rawName, cmsOnly: true });
        return;
      }

      const siteId = segments[2] ?? '';
      if (!SITE_ID_RE.test(siteId)) {
        sendJson(res, 400, { error: 'Invalid site ID' });
        return;
      }
      const siteDir = path.join(sitesRoot, siteId);

      // GET /api/sites/:id
      if (segments.length === 3 && req.method === 'GET') {
        const payload = readSiteProject(sitesRoot, siteId);
        if (!payload) {
          sendJson(res, 404, { error: 'Site not found' });
          return;
        }
        sendJson(res, 200, payload);
        return;
      }

      // PUT /api/sites/:id
      if (segments.length === 3 && req.method === 'PUT') {
        const data = await readJsonBody(req);
        const fileCount = writeSiteProject(sitesRoot, siteId, data, runtimeRange);
        sendJson(res, 200, { ok: true, fileCount });
        return;
      }

      // PATCH /api/sites/:id (rename)
      if (segments.length === 3 && req.method === 'PATCH') {
        if (!fs.existsSync(siteDir)) {
          sendJson(res, 404, { error: 'Site not found' });
          return;
        }
        const body = await readJsonBody(req);
        const name = String(body?.name || '').trim();
        if (!name) {
          sendJson(res, 400, { error: 'Name required' });
          return;
        }
        const meta = readSiteMeta(siteDir, siteId);
        writeSiteMeta(siteDir, {
          ...meta,
          name,
          updatedAt: new Date().toISOString(),
        });
        sendJson(res, 200, { ok: true, name });
        return;
      }

      // POST /api/sites/:id/assets
      if (segments.length === 4 && segments[3] === 'assets' && req.method === 'POST') {
        const rawFilename = String(req.headers['x-asset-filename'] || 'asset.bin');
        const safeName = rawFilename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset.bin';
        const finalName = `${Date.now()}-${safeName}`;
        const uploadsDir = path.join(siteDir, 'public', 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        const bytes = await readRawBody(req);
        fs.writeFileSync(path.join(uploadsDir, finalName), bytes);
        sendJson(res, 200, { url: `/uploads/${finalName}` });
        return;
      }

      // GET /api/sites/:id/fonts — Per-project font configuration (1 Adobe Fonts kit per project)
      if (segments.length === 4 && segments[3] === 'fonts' && req.method === 'GET') {
        if (!fs.existsSync(siteDir)) {
          sendJson(res, 404, { error: 'Site not found' });
          return;
        }
        const meta = readSiteMeta(siteDir, siteId);
        sendJson(res, 200, {
          adobeKit: meta.adobeKit ?? null,
          fonts: meta.adobeKit?.fonts ?? [],
        });
        return;
      }

      // POST /api/sites/:id/fonts/adobe — Sync/replace the project's Adobe Fonts kit (1 kit per project)
      if (segments.length === 5 && segments[3] === 'fonts' && segments[4] === 'adobe' && req.method === 'POST') {
        if (!fs.existsSync(siteDir)) {
          sendJson(res, 404, { error: 'Site not found' });
          return;
        }
        const body = await readJsonBody(req);
        const input = String(body?.input || '').trim();
        if (!input) {
          sendJson(res, 400, { error: 'Adobe Fonts Kit ID, URL, or @font-face CSS is required.' });
          return;
        }
        const preserveSlugAsFamily = Boolean(body?.preserveSlugAsFamily);
        const siteFontsDir = path.join(siteDir, 'public', 'fonts');
        fs.mkdirSync(siteFontsDir, { recursive: true });

        // Remove previous Adobe kit binaries for this project so only the active kit remains
        for (const existing of fs.readdirSync(siteFontsDir)) {
          if (existing.startsWith('adobe-')) {
            fs.rmSync(path.join(siteFontsDir, existing), { force: true });
          }
        }

        const { kitId, faces } = await ingestAdobeFontsLowLevel({
          input,
          workspaceFontsDir: siteFontsDir,
          preserveSlugAsFamily,
          familyNameMap: body?.familyNameMap && typeof body.familyNameMap === 'object' ? body.familyNameMap : undefined,
        });

        const siteScopedFaces: WorkspaceFont[] = faces.map((f) => ({
          ...f,
          url: `/fonts/${f.fileName}`,
        }));

        const meta = readSiteMeta(siteDir, siteId);
        const adobeKit: SiteAdobeKitMeta = {
          kitId,
          input: input.length > 240 ? `Kit ${kitId} (@font-face CSS)` : input,
          preserveSlugAsFamily,
          syncedAt: new Date().toISOString(),
          fonts: siteScopedFaces,
        };
        writeSiteMeta(siteDir, {
          ...meta,
          adobeKit,
          updatedAt: new Date().toISOString(),
        });

        sendJson(res, 200, {
          adobeKit,
          fonts: siteScopedFaces,
        });
        return;
      }

      // DELETE /api/sites/:id/fonts/adobe — Remove the project's Adobe Fonts kit
      if (segments.length === 5 && segments[3] === 'fonts' && segments[4] === 'adobe' && req.method === 'DELETE') {
        if (!fs.existsSync(siteDir)) {
          sendJson(res, 404, { error: 'Site not found' });
          return;
        }
        const siteFontsDir = path.join(siteDir, 'public', 'fonts');
        if (fs.existsSync(siteFontsDir)) {
          for (const existing of fs.readdirSync(siteFontsDir)) {
            if (existing.startsWith('adobe-')) {
              fs.rmSync(path.join(siteFontsDir, existing), { force: true });
            }
          }
        }
        const meta = readSiteMeta(siteDir, siteId);
        writeSiteMeta(siteDir, {
          ...meta,
          adobeKit: null,
          updatedAt: new Date().toISOString(),
        });
        sendJson(res, 200, { adobeKit: null, fonts: [] });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };
}

export function createWorkspaceApiMiddleware(repoRoot: string) {
  const sitesRoot = path.join(repoRoot, 'sites');
  const wsFontsDir = path.join(sitesRoot, '.workspace', 'fonts');

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const rawUrl = req.url ?? '/';
    const [rawPath, rawQuery = ''] = rawUrl.split('?');
    const pathname = decodeURIComponent(rawPath ?? '/');
    if (!pathname.startsWith('/api/workspace')) return next();

    const segments = pathname.split('/').filter(Boolean); // ['api', 'workspace', ...]

    try {
      // GET /api/workspace
      if (segments.length === 2 && req.method === 'GET') {
        const config = readWorkspaceConfig(sitesRoot);
        sendJson(res, 200, config);
        return;
      }

      // PATCH /api/workspace
      if (segments.length === 2 && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const current = readWorkspaceConfig(sitesRoot);
        const nextConfig: WorkspaceConfigFile = {
          ...current,
          ...(typeof body?.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(typeof body?.logoInitial === 'string' && body.logoInitial.trim()
            ? { logoInitial: body.logoInitial.trim().slice(0, 2).toUpperCase() }
            : {}),
          ...(typeof body?.logoColor === 'string' && body.logoColor.trim() ? { logoColor: body.logoColor.trim() } : {}),
          ...(typeof body?.accountName === 'string'
            ? { accountName: body.accountName.trim() }
            : {}),
          ...(typeof body?.accountEmail === 'string'
            ? { accountEmail: body.accountEmail.trim() }
            : {}),
          ...(typeof body?.preserveSlugAsFamily === 'boolean'
            ? { preserveSlugAsFamily: body.preserveSlugAsFamily }
            : {}),
        };
        writeWorkspaceConfig(sitesRoot, nextConfig);
        sendJson(res, 200, nextConfig);
        return;
      }

      // GET /api/workspace/fonts
      if (segments.length === 3 && segments[2] === 'fonts' && req.method === 'GET') {
        const config = readWorkspaceConfig(sitesRoot);
        sendJson(res, 200, { fonts: config.fonts });
        return;
      }

      // POST /api/workspace/fonts/upload
      if (segments.length === 4 && segments[2] === 'fonts' && segments[3] === 'upload' && req.method === 'POST') {
        const rawFilename = decodeURIComponent(String(req.headers['x-font-filename'] || 'custom-font.woff2'));
        const bytes = await readRawBody(req);
        if (bytes.length === 0) {
          sendJson(res, 400, { error: 'Empty font file' });
          return;
        }
        const inspected = inspectFontBinary(bytes, rawFilename);
        const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8);
        const safeBase = rawFilename
          .replace(/\.(woff2|woff|otf|ttf)$/i, '')
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'font';
        const finalFileName = `${safeBase}-${hash}.${inspected.ext}`;

        fs.mkdirSync(wsFontsDir, { recursive: true });
        fs.writeFileSync(path.join(wsFontsDir, finalFileName), bytes);

        const fontEntry: WorkspaceFont = {
          id: `upload-${hash}`,
          family: inspected.family,
          weight: inspected.weight,
          style: inspected.style,
          ext: inspected.ext,
          fileName: finalFileName,
          size: bytes.length,
          url: `/workspace-fonts/${finalFileName}`,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'Workspace Admin',
          isVariable: inspected.isVariable,
          ...(inspected.weightRange ? { weightRange: inspected.weightRange } : {}),
          source: inspected.source,
          provider: 'upload',
          sfntTables: inspected.sfntTables,
          sfntFlavor: inspected.sfntFlavor,
        };

        const config = readWorkspaceConfig(sitesRoot);
        const existingIdx = config.fonts.findIndex((f) => f.id === fontEntry.id);
        if (existingIdx >= 0) {
          config.fonts[existingIdx] = fontEntry;
        } else {
          config.fonts.push(fontEntry);
        }
        writeWorkspaceConfig(sitesRoot, config);
        sendJson(res, 201, { font: fontEntry, fonts: config.fonts });
        return;
      }

      // POST /api/workspace/fonts/adobe
      if (segments.length === 4 && segments[2] === 'fonts' && segments[3] === 'adobe' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const input = String(body?.input || '').trim();
        if (!input) {
          sendJson(res, 400, { error: 'Adobe Fonts Kit ID, URL, or @font-face CSS is required.' });
          return;
        }
        const config = readWorkspaceConfig(sitesRoot);
        const preserveSlugAsFamily =
          typeof body?.preserveSlugAsFamily === 'boolean'
            ? body.preserveSlugAsFamily
            : config.preserveSlugAsFamily;

        const { kitId, faces } = await ingestAdobeFontsLowLevel({
          input,
          workspaceFontsDir: wsFontsDir,
          preserveSlugAsFamily,
          familyNameMap: body?.familyNameMap && typeof body.familyNameMap === 'object' ? body.familyNameMap : undefined,
        });

        const byId = new Map<string, WorkspaceFont>();
        for (const f of config.fonts) byId.set(f.id, f);
        for (const f of faces) byId.set(f.id, f);
        config.fonts = Array.from(byId.values());

        const families = Array.from(new Set(faces.map((f) => f.family)));
        const nextKits = config.connectedKits.filter((k) => k.kitId !== kitId);
        nextKits.unshift({
          kitId,
          syncedAt: new Date().toISOString(),
          faceCount: faces.length,
          families,
        });
        config.connectedKits = nextKits;
        writeWorkspaceConfig(sitesRoot, config);

        sendJson(res, 200, {
          kitId,
          addedFaces: faces,
          fonts: config.fonts,
          connectedKits: config.connectedKits,
        });
        return;
      }

      // POST /api/workspace/fonts/adobe/kits
      if (
        segments.length === 5 &&
        segments[2] === 'fonts' &&
        segments[3] === 'adobe' &&
        segments[4] === 'kits' &&
        req.method === 'POST'
      ) {
        const body = await readJsonBody(req);
        const apiToken = String(body?.apiToken || '').trim();
        const kits = await fetchAdobeTypekitKits(apiToken);
        sendJson(res, 200, { kits });
        return;
      }

      // DELETE /api/workspace/fonts/:id (or DELETE /api/workspace/fonts?family=...)
      if (segments[2] === 'fonts' && req.method === 'DELETE') {
        const params = new URLSearchParams(rawQuery);
        const familyFilter = params.get('family');
        const kitFilter = params.get('kitId');
        const fontId = segments[3] ? decodeURIComponent(segments[3]) : null;

        const config = readWorkspaceConfig(sitesRoot);
        const toRemove = config.fonts.filter((f) => {
          if (fontId && f.id === fontId) return true;
          if (familyFilter && f.family === familyFilter) return true;
          if (kitFilter && f.adobeKitId === kitFilter) return true;
          return false;
        });

        for (const rem of toRemove) {
          const fileCandidate = path.join(wsFontsDir, rem.fileName);
          if (fs.existsSync(fileCandidate)) {
            fs.rmSync(fileCandidate, { force: true });
          }
        }

        const removeIds = new Set(toRemove.map((f) => f.id));
        config.fonts = config.fonts.filter((f) => !removeIds.has(f.id));
        if (kitFilter) {
          config.connectedKits = config.connectedKits.filter((k) => k.kitId !== kitFilter);
        }
        writeWorkspaceConfig(sitesRoot, config);
        sendJson(res, 200, { fonts: config.fonts, connectedKits: config.connectedKits });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export function sitesApiPlugin(repoRoot: string): Plugin {
  return {
    name: 'websites-sites-api',
    config() {
      return { server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.revyme-local/**'] } } };
    },
    configureServer(server) {
      server.middlewares.use(createPublishingMiddleware(repoRoot));
      server.middlewares.use(createWorkspaceApiMiddleware(repoRoot));
      server.middlewares.use(createSitesApiMiddleware(repoRoot));
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createPublishingMiddleware(repoRoot));
      server.middlewares.use(createWorkspaceApiMiddleware(repoRoot));
      server.middlewares.use(createSitesApiMiddleware(repoRoot));
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
  };
}

export function sitesStaticAssetsPlugin(repoRoot: string): Plugin {
  return {
    name: 'websites-static-assets',
    config() {
      return { server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.revyme-local/**'] } } };
    },
    configureServer(server) {
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
  };
}
