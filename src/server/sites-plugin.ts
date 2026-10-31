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

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const MANAGED_TOP_DIRS = new Set([
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

const SITE_ID_RE = /^[a-z0-9][a-z0-9-_]{0,62}$/;

export interface SiteMetaFile {
  id: string;
  name: string;
  format: 'revyme-v1' | 'revyme-v2' | 'canvas-poc-v1';
  branches?: Record<string, unknown>;
  activeBranchId?: string;
  mainBranchId?: string;
  settings?: Record<string, unknown>;
  managedFiles?: string[];
  updatedAt?: string;
}

export interface SiteSummary {
  id: string;
  name: string;
  pageCount: number;
  collectionCount: number;
  updatedAt: string;
}

const MIME_TYPES: Record<string, string> = {
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

function isManagedProjectPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return false;
  const top = normalized.split('/')[0] ?? '';
  return MANAGED_TOP_DIRS.has(top);
}

function walkManagedFiles(siteDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const topDir of MANAGED_TOP_DIRS) {
    const absTop = path.join(siteDir, topDir);
    if (!fs.existsSync(absTop) || !fs.statSync(absTop).isDirectory()) continue;
    const walk = (dir: string, relPrefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
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

function readSiteMeta(siteDir: string, siteId: string): SiteMetaFile {
  const metaPath = path.join(siteDir, '_revyme', 'project-meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SiteMetaFile;
      return {
        id: siteId,
        name: parsed.name || siteId,
        format: parsed.format || 'revyme-v1',
        branches: parsed.branches,
        activeBranchId: parsed.activeBranchId,
        mainBranchId: parsed.mainBranchId,
        settings: parsed.settings,
        managedFiles: parsed.managedFiles,
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

function writeSiteMeta(siteDir: string, meta: SiteMetaFile): void {
  const metaDir = path.join(siteDir, '_revyme');
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(
    path.join(metaDir, 'project-meta.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf-8',
  );
}

function ensureNextScaffold(siteDir: string, siteId: string, siteName: string, runtimeRange = '^0.0.32'): void {
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
  if (!fs.existsSync(nextConfigPath)) {
    fs.writeFileSync(
      nextConfigPath,
      `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n  typescript: { ignoreBuildErrors: true },\n};\n\nexport default nextConfig;\n`,
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
      `# ${siteName}\n\nManaged with the Websites local Revyme harness and ready for Vercel deployment.\n`,
      'utf-8',
    );
  }

  fs.mkdirSync(path.join(siteDir, 'public'), { recursive: true });
}

function listAllSites(sitesRoot: string): SiteSummary[] {
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

function createStaticAssetMiddleware(repoRoot: string) {
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
    for (const entry of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SITE_ID_RE.test(entry.name)) continue;
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

function createSitesApiMiddleware(repoRoot: string) {
  const sitesRoot = path.join(repoRoot, 'sites');
  let runtimeRange = '^0.0.32';
  try {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    if (rootPkg?.dependencies?.['@revyme/runtime']) {
      runtimeRange = rootPkg.dependencies['@revyme/runtime'];
    }
  } catch {
    // keep fallback
  }

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
        fs.mkdirSync(siteDir, { recursive: true });
        ensureNextScaffold(siteDir, rawId, rawName, runtimeRange);
        const existingMeta = readSiteMeta(siteDir, rawId);
        writeSiteMeta(siteDir, {
          ...existingMeta,
          id: rawId,
          name: rawName,
          format: 'revyme-v1',
          updatedAt: new Date().toISOString(),
        });
        sendJson(res, 201, { id: rawId, name: rawName });
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
        if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
          sendJson(res, 404, { error: 'Site not found' });
          return;
        }
        const meta = readSiteMeta(siteDir, siteId);
        const files = walkManagedFiles(siteDir);
        sendJson(res, 200, {
          id: siteId,
          name: meta.name,
          project: {
            format: meta.format || 'revyme-v1',
            files,
            ...(meta.branches ? { branches: meta.branches } : {}),
            ...(meta.activeBranchId ? { activeBranchId: meta.activeBranchId } : {}),
            ...(meta.mainBranchId ? { mainBranchId: meta.mainBranchId } : {}),
            ...(meta.settings ? { settings: meta.settings } : {}),
          },
        });
        return;
      }

      // PUT /api/sites/:id
      if (segments.length === 3 && req.method === 'PUT') {
        const data = await readJsonBody(req);
        const incomingFiles: Record<string, string> = data?.files && typeof data.files === 'object' ? data.files : {};
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

        // Remove deleted managed files
        for (const removedRel of previousSet) {
          if (!isManagedProjectPath(removedRel)) continue;
          const absRemoved = path.join(siteDir, removedRel);
          if (fs.existsSync(absRemoved) && fs.statSync(absRemoved).isFile()) {
            fs.rmSync(absRemoved, { force: true });
            removeEmptyDirs(path.dirname(absRemoved), siteDir);
          }
        }

        ensureNextScaffold(siteDir, siteId, prevMeta.name, runtimeRange);
        writeSiteMeta(siteDir, {
          id: siteId,
          name: prevMeta.name,
          format: data?.format || prevMeta.format || 'revyme-v1',
          branches: data?.branches,
          activeBranchId: data?.activeBranchId,
          mainBranchId: data?.mainBranchId,
          settings: data?.settings,
          managedFiles: nextManaged.sort(),
          updatedAt: new Date().toISOString(),
        });

        sendJson(res, 200, { ok: true, fileCount: nextManaged.length });
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

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };
}

export function sitesApiPlugin(repoRoot: string): Plugin {
  return {
    name: 'websites-sites-api',
    configureServer(server) {
      server.middlewares.use(createSitesApiMiddleware(repoRoot));
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createSitesApiMiddleware(repoRoot));
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
  };
}

export function sitesStaticAssetsPlugin(repoRoot: string): Plugin {
  return {
    name: 'websites-static-assets',
    configureServer(server) {
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createStaticAssetMiddleware(repoRoot));
    },
  };
}
