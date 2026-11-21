// Publish the saved site source through Vercel, independently of Revyme Cloud.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv } from 'node:util';
import { deploymentPending, type LocalPublishingState, type SiteDeployment, type PublishingDomain } from '../shared/local-publishing';
import { needsWorkspaceRuntime } from '../shared/workspace-runtime';
import { projectPublishedCms } from '../shared/cms-publication';

const API = 'https://api.vercel.com';
const SITE_ID = /^[a-z0-9][a-z0-9-_]{0,62}$/;
const SOURCE_DIRS = new Set(['app', 'pages', 'components', 'cms', 'i18n', 'messages', 'icons', 'overrides', 'plugins', 'public', 'vendor', 'src', 'lib', 'styles']);
const SOURCE_FILES = /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|next\.config\.(mjs|js|ts)|next-env\.d\.ts|tsconfig\.json|jsconfig\.json|postcss\.config\.(mjs|js|cjs)|tailwind\.config\.(js|ts)|middleware\.(ts|js)|instrumentation\.(ts|js)|vercel\.json)$/;
const EXCLUDED = /^(node_modules|\.next|\.git|\.vercel|\.revyme-local|\.env.*|_meta|_revyme|\.DS_Store)$/;

class PublishingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
interface StoredState extends Omit<LocalPublishingState, 'connected' | 'hasCredentials'> { token?: string }
interface SourceFile { file: string; data: Buffer; sha: string; size: number }

/** `.env` values with `prefix`, in Vite's development precedence (later files
 *  win). Read with `node:util` so the publisher also runs outside Vite (the
 *  self-hosted server bundles this module without a `vite` dependency). */
export function readEnvFiles(root: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    let raw: string;
    try { raw = fs.readFileSync(path.join(root, name), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const [key, value] of Object.entries(parseEnv(raw))) {
      if (key.startsWith(prefix) && typeof value === 'string') out[key] = value;
    }
  }
  return out;
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** All bytes are captured before uploading; edits during a build belong to the next publish. */
export function collectSiteSource(repoRoot: string, siteDir: string): SourceFile[] {
  const files: SourceFile[] = [];
  let total = 0;
  const add = (absolute: string, relative: string) => {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new PublishingError(`Cannot publish symbolic link: ${relative}`);
    if (!stat.isFile()) return;
    total += stat.size;
    if (total > 100 * 1024 * 1024 || files.length >= 15000) throw new PublishingError('This site exceeds the local publisher limit (100 MB / 15,000 files).');
    const data = fs.readFileSync(absolute);
    files.push({ file: relative, data, size: data.length, sha: crypto.createHash('sha1').update(data).digest('hex') });
  };
  const walk = (absolute: string, relative: string) => {
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new PublishingError(`Cannot publish symbolic link: ${relative}`);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (EXCLUDED.test(entry.name) || entry.name.startsWith('.')) continue;
      const rel = `${relative}/${entry.name}`, abs = path.join(absolute, entry.name);
      if (entry.isDirectory()) walk(abs, rel); else add(abs, rel);
    }
  };
  for (const entry of fs.readdirSync(siteDir, { withFileTypes: true })) {
    const abs = path.join(siteDir, entry.name);
    if (SOURCE_DIRS.has(entry.name)) walk(abs, entry.name);
    else if (SOURCE_FILES.test(entry.name)) add(abs, entry.name);
  }
  if (!files.some(file => file.file === 'package.json')) throw new PublishingError('The site has no package.json. Save it as a local site before publishing.');
  // Remove drafts before the JSON can become a public client bundle. Rendering
  // filters alone leave the original records downloadable from the JavaScript.
  const publicCms = projectPublishedCms(Object.fromEntries(files.filter(file => file.file.startsWith('cms/')).map(file => [file.file, file.data.toString()])));
  for (const file of files) {
    if (publicCms[file.file] === undefined) continue;
    const data = Buffer.from(publicCms[file.file]);
    total += data.length - file.size;
    file.data = data; file.size = data.length; file.sha = crypto.createHash('sha1').update(data).digest('hex');
  }
  // Fonts shared by the local editor must also exist at their runtime URLs.
  const references = files.filter(file => /\.(css|tsx?|jsx?|json)$/.test(file.file)).map(file => file.data.toString()).join('\n');
  // Generated GPU effects ship the workspace runtime with the upload snapshot.
  // The site's saved files are left untouched; exports and publishing use the
  // same locally built runtime even if an older vendor copy exists on disk.
  if (needsWorkspaceRuntime(references)) {
    for (let index = files.length - 1; index >= 0; index--) {
      if (!files[index].file.startsWith('vendor/revyme-runtime/')) continue;
      total -= files[index].size;
      files.splice(index, 1);
    }
    const runtimeRoot = path.join(repoRoot, 'packages/revyme-runtime-scene');
    const runtimeFiles = ['package.json', 'build.mjs', 'THREE-LICENSE', 'RICH-CONTENT-LICENSES', 'QR-CODE-LICENSE', 'tsconfig.build.json', 'HTML-TO-IMAGE-LICENSE', 'LIQUIDGL-LICENSE', 'PRETEXT-LICENSE', 'HYPHEN-LICENSE', 'EXPERIMENT.md'];
    const removeFile = (name: string) => {
      const index = files.findIndex(file => file.file === name);
      if (index !== -1) { total -= files[index].size; files.splice(index, 1); }
    };
    const addRuntime = (absolute: string, relative: string) => {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const source = path.join(absolute, entry.name), dest = `${relative}/${entry.name}`;
        if (entry.isDirectory()) addRuntime(source, dest);
        else { removeFile(dest); add(source, dest); }
      }
    };
    for (const file of runtimeFiles) { const dest = `vendor/revyme-runtime/${file}`; removeFile(dest); add(path.join(runtimeRoot, file), dest); }
    for (const dir of ['src', 'dist']) addRuntime(path.join(runtimeRoot, dir), `vendor/revyme-runtime/${dir}`);
    const packageFile = files.find(file => file.file === 'package.json')!;
    const pkg = JSON.parse(packageFile.data.toString());
    pkg.dependencies = { ...pkg.dependencies, '@revyme/runtime': 'file:./vendor/revyme-runtime' };
    const data = Buffer.from(JSON.stringify(pkg, null, 2));
    total += data.length - packageFile.size;
    packageFile.data = data; packageFile.size = data.length; packageFile.sha = crypto.createHash('sha1').update(data).digest('hex');
    if (total > 100 * 1024 * 1024) throw new PublishingError('This site exceeds the local publisher limit (100 MB / 15,000 files).');
  }
  const fonts = new Set([...references.matchAll(/\/workspace-fonts\/([a-zA-Z0-9_.-]+)/g)].map(match => match[1]));
  for (const font of fonts) {
    const dest = `public/workspace-fonts/${font}`;
    if (files.some(file => file.file === dest)) continue;
    const source = path.join(repoRoot, 'sites', '.workspace', 'fonts', font);
    if (!fs.existsSync(source)) throw new PublishingError(`Missing shared font: ${font}`);
    add(source, dest);
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

export class SitePublisher {
  private readonly locks = new Set<string>();
  constructor(private readonly root: string, private readonly request: typeof fetch = fetch,
    private readonly env: Record<string, string | undefined> = { ...readEnvFiles(root, 'VERCEL_'), ...process.env }) {}

  private siteDir(id: string): string {
    if (!SITE_ID.test(id)) throw new PublishingError('Invalid site ID');
    const dir = path.join(this.root, 'sites', id);
    if (!fs.existsSync(dir)) throw new PublishingError('Site not found', 404);
    if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) throw new PublishingError('Invalid site directory');
    return dir;
  }
  private stateFile(id: string): string { return path.join(this.root, '.revyme-local', 'publishing', `${id}.json`); }
  private read(id: string): StoredState { this.siteDir(id); return readJson(this.stateFile(id)) ?? {}; }
  private write(id: string, state: StoredState) {
    const file = this.stateFile(id);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  private token(state: StoredState): string | undefined {
    if (state.token || this.env.VERCEL_TOKEN) return state.token || this.env.VERCEL_TOKEN;
    // Reuse an explicit local Vercel CLI login; never borrow another app's MCP credentials.
    for (const rel of ['Library/Application Support/com.vercel.cli/auth.json', '.local/share/com.vercel.cli/auth.json', '.config/vercel/auth.json']) {
      const token = readJson(path.join(os.homedir(), rel))?.token;
      if (typeof token === 'string' && token) return token;
    }
  }
  private async api(state: StoredState, endpoint: string, init: RequestInit = {}) {
    const token = this.token(state);
    if (!token) throw new PublishingError('Connect Vercel before publishing.', 401);
    const url = new URL(endpoint, API);
    if (state.project?.teamId) url.searchParams.set('teamId', state.project.teamId);
    const response = await this.request(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(60000) });
    const raw = await response.text();
    let data: any;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      const message = typeof data.error?.message === 'string' ? data.error.message : `Vercel returned ${response.status}.`;
      throw new PublishingError(message.replaceAll(token, '[redacted]'), response.status);
    }
    return data;
  }
  private publicState(state: StoredState): LocalPublishingState {
    return { connected: !!state.project && !!this.token(state), hasCredentials: !!this.token(state), project: state.project, deployment: state.deployment, preview: state.preview, production: state.production };
  }
  private acceptDeployment(state: StoredState, data: any, previous: SiteDeployment): StoredState {
    if (typeof data.id !== 'string') throw new PublishingError('Vercel did not return a deployment ID.', 502);
    if (data.projectId && data.projectId !== state.project?.id) throw new PublishingError('Vercel returned a deployment for a different project.', 502);
    const status = data.readyState ?? data.status;
    if (!['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED'].includes(status)) throw new PublishingError('Vercel returned an unknown deployment state.', 502);
    const host = typeof data.url === 'string' && /^[a-zA-Z0-9.-]+\.vercel\.app$/.test(data.url) ? data.url : undefined;
    const productionAlias = previous.target === 'production' && status === 'READY' && Array.isArray(data.alias)
      ? data.alias.find((alias: unknown) => typeof alias === 'string' && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(alias)) : undefined;
    const deployment: SiteDeployment = { ...previous, id: data.id, state: status, url: productionAlias ? `https://${productionAlias}` : host ? `https://${host}` : previous.url,
      inspectorUrl: typeof data.inspectorUrl === 'string' && data.inspectorUrl.startsWith('https://vercel.com/') ? data.inspectorUrl : previous.inspectorUrl,
      error: typeof data.errorMessage === 'string' ? data.errorMessage.replaceAll(this.token(state)!, '[redacted]') : undefined };
    if (status === 'READY' && !deployment.url) throw new PublishingError('Vercel finished without returning a deployment URL.', 502);
    return { ...state, deployment, ...(status === 'READY' ? { [deployment.target]: deployment } : {}) };
  }

  async status(id: string): Promise<LocalPublishingState> {
    let state = this.read(id);
    if (state.deployment?.state === 'UPLOADING' && !this.locks.has(id)) {
      state.deployment = { ...state.deployment, state: 'ERROR', error: 'Upload interrupted. Publish again to retry.' };
      this.write(id, state);
    } else if (deploymentPending(state.deployment) && state.deployment?.id && !this.locks.has(id)) {
      const previous = state.deployment;
      const remote = await this.api(state, `/v13/deployments/${encodeURIComponent(previous.id)}`);
      // A refresh must not overwrite a newer action that finished during the request.
      state = this.read(id);
      if (state.deployment?.id === previous.id && !this.locks.has(id)) {
        state = this.acceptDeployment(state, remote, previous); this.write(id, state);
      }
    }
    return this.publicState(state);
  }

  async connect(id: string, input: { token?: string; project: string; teamId?: string; create?: boolean }): Promise<LocalPublishingState> {
    return this.exclusive(id, async () => {
      const current = this.read(id);
      if (!input.project || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.project)) throw new PublishingError('Enter a Vercel project name or ID.');
      if (input.teamId && !/^[a-zA-Z0-9_-]{1,100}$/.test(input.teamId)) throw new PublishingError('Invalid Vercel team ID.');
      const state: StoredState = { token: input.token?.trim() || current.token, project: { id: '', name: input.project, teamId: input.teamId || undefined } };
      let project;
      try { project = await this.api(state, `/v9/projects/${encodeURIComponent(input.project)}`); }
      catch (error) {
        if (!(error instanceof PublishingError) || error.status !== 404 || !input.create) throw error;
        project = await this.api(state, '/v11/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.project, framework: 'nextjs' }) });
      }
      if (!project.id || !project.name) throw new PublishingError('Vercel did not return a project.', 502);
      if (deploymentPending(current.deployment) && current.project?.id !== project.id) throw new PublishingError('Wait for the current deployment before changing projects.', 409);
      if (project.rootDirectory) throw new PublishingError('Choose a Vercel project without a Root Directory: the publisher uploads this site as the project root.');
      state.project = { id: project.id, name: project.name, teamId: project.accountId?.startsWith('team_') ? project.accountId : input.teamId || undefined };
      const next = current.project?.id === project.id ? { ...current, ...state } : state;
      this.write(id, next);
      return this.publicState(next);
    });
  }

  async publish(id: string, target: 'preview' | 'production', previewId?: string): Promise<LocalPublishingState> {
    return this.exclusive(id, async () => {
      let state = this.read(id);
      if (!state.project || !this.token(state)) throw new PublishingError('Connect Vercel before publishing.', 401);
      if (deploymentPending(state.deployment)) throw new PublishingError('A deployment is already in progress.', 409);
      let files: SourceFile[] = [];
      let sourceHash: string | undefined;
      if (target === 'production') {
        if (!previewId || state.preview?.id !== previewId || state.preview.state !== 'READY') throw new PublishingError('Choose the ready preview before deploying to production.', 409);
        sourceHash = state.preview.sourceHash;
      } else {
        files = collectSiteSource(this.root, this.siteDir(id));
        sourceHash = crypto.createHash('sha256').update(files.map(file => `${file.file}:${file.sha}`).join('\n')).digest('hex');
      }
      state.deployment = { id: '', target, state: 'UPLOADING', createdAt: new Date().toISOString(), sourceHash };
      this.write(id, state);
      try {
        let index = 0;
        // Bound concurrency; no shell, CLI prompts or repository push are needed.
        await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
          while (index < files.length) {
            const file = files[index++];
            for (let attempt = 0; ; attempt++) {
              try {
                await this.api(state, '/v2/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': file.sha, 'Content-Length': String(file.size) }, body: new Uint8Array(file.data) });
                break;
              } catch (error) {
                const transient = error instanceof TypeError || error instanceof PublishingError && (error.status === 429 || error.status >= 500);
                if (!transient || attempt >= 4) throw error;
                await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
              }
            }
          }
        }));
        const body = target === 'production'
          ? { name: state.project.name, project: state.project.id, deploymentId: previewId, target: 'production' }
          : { name: state.project.name, project: state.project.id, files: files.map(({ file, sha, size }) => ({ file, sha, size })), projectSettings: { framework: 'nextjs' } };
        // Omitting target is Vercel's documented Preview mode. Production can
        // only redeploy the exact tested preview, with production environment settings.
        const remote = await this.api(state, '/v13/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        state = this.acceptDeployment(state, remote, state.deployment!);
        this.write(id, state);
        return this.publicState(state);
      } catch (error) {
        state.deployment = { ...state.deployment!, state: 'ERROR', error: error instanceof Error ? error.message : 'Deployment failed.' };
        this.write(id, state); throw error;
      }
    });
  }
  async domains(id: string, action?: 'add' | 'verify', input?: string): Promise<{ domains: PublishingDomain[] }> {
    const state = this.read(id);
    if (!state.project || !this.token(state)) throw new PublishingError('Connect Vercel before configuring domains.', 401);
    const project = encodeURIComponent(state.project.id);
    if (action) {
      const name = typeof input === 'string' ? input.trim().toLowerCase() : '';
      if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) throw new PublishingError('Enter a domain name without https:// or a path.');
      if (action === 'add') await this.api(state, `/v10/projects/${project}/domains`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      else await this.api(state, `/v9/projects/${project}/domains/${encodeURIComponent(name)}/verify`, { method: 'POST' });
    }
    const rows: any[] = [];
    let until: number | undefined;
    do {
      const page = await this.api(state, `/v9/projects/${project}/domains?production=true&limit=100${until ? `&until=${until}` : ''}`);
      rows.push(...(page.domains ?? []));
      until = typeof page.pagination?.next === 'number' ? page.pagination.next : undefined;
    } while (until && rows.length < 1000);
    const domains: PublishingDomain[] = [];
    for (const row of rows) {
      const records: PublishingDomain['records'] = (row.verification ?? []).filter((record: any) => record.type && record.domain && record.value)
        .map((record: any) => ({ type: String(record.type), name: String(record.domain), value: String(record.value) }));
      let configured: boolean | null = null, error: string | undefined;
      try {
        const config = await this.api(state, `/v6/domains/${encodeURIComponent(row.name)}/config?projectIdOrName=${project}`);
        configured = config.misconfigured === false;
        if (!configured) {
          const cname = [...(config.recommendedCNAME ?? [])].sort((a: any, b: any) => a.rank - b.rank)[0]?.value;
          const ips = [...(config.recommendedIPv4 ?? [])].sort((a: any, b: any) => a.rank - b.rank)[0]?.value;
          if (cname && row.apexName !== row.name) records.push({ type: 'CNAME', name: row.name, value: String(cname) });
          else if (Array.isArray(ips)) for (const ip of ips) records.push({ type: 'A', name: row.name, value: String(ip) });
        }
      } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not check DNS.'; }
      domains.push({ name: row.name, verified: row.verified === true, configured, records, error });
    }
    return { domains };
  }

  private async exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
    this.siteDir(id);
    if (this.locks.has(id)) throw new PublishingError('A publishing operation is already in progress.', 409);
    this.locks.add(id);
    try { return await run(); } finally { this.locks.delete(id); }
  }
}

function localRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname)) return false;
  const peer = req.socket.remoteAddress;
  if (peer && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return false;
  return req.headers['sec-fetch-site'] !== 'cross-site';
}
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new PublishingError('Expected application/json.', 415);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new PublishingError('Request too large.', 413); }
  try { return JSON.parse(raw || '{}'); } catch { throw new PublishingError('Invalid JSON.'); }
}
/** `authorize` defaults to the local-editor guard. The self-hosted server
 *  passes its own check: it authorizes each publishing route per site role
 *  before this middleware runs, behind a real hostname. */
export function createPublishingMiddleware(
  root: string,
  publisher = new SitePublisher(root),
  authorize: (req: IncomingMessage) => boolean = localRequest,
) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? '').split('?')[0];
    const match = /^\/api\/sites\/([^/]+)\/publish(?:\/(connect|preview|production|domains|verify-domain))?$/.exec(pathname);
    if (!match) return next();
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    try {
      if (!authorize(req)) throw new PublishingError('Publishing is only available from the local editor.', 403);
      let result: LocalPublishingState | { domains: PublishingDomain[] };
      const id = decodeURIComponent(match[1]), action = match[2];
      if (req.method === 'GET' && !action) result = await publisher.status(id);
      else if (req.method === 'GET' && action === 'domains') result = await publisher.domains(id);
      else if (req.method === 'POST') {
        const input = await body(req);
        if (action === 'connect') result = await publisher.connect(id, input);
        else if (action === 'preview') result = await publisher.publish(id, 'preview');
        else if (action === 'production') result = await publisher.publish(id, 'production', input.previewId);
        else if (action === 'domains') result = await publisher.domains(id, 'add', input.name);
        else if (action === 'verify-domain') result = await publisher.domains(id, 'verify', input.name);
        else throw new PublishingError('Unknown publishing action.', 404);
      } else throw new PublishingError('Method not allowed.', 405);
      res.statusCode = 200; res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof PublishingError ? error.status : 500;
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Publishing failed.' } }));
    }
  };
}
