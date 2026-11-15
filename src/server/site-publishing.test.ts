// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { SitePublisher, collectSiteSource, createPublishingMiddleware } from './site-publishing';

let root: string, site: string;
const token = 'test-secret-never-returned';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function write(file: string, content: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-publishing-test-')); site = path.join(root, 'sites', 'canvas');
  write(path.join(site, 'package.json'), JSON.stringify({ scripts: { build: 'next build' } }));
  write(path.join(site, 'app/page.tsx'), 'export default function Page() { return <div>Canvas</div> }');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function provider() {
  let next = 0;
  const deployments = new Map<string, any>();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.vercel.com');
    expect((init?.headers as any).Authorization).toBe(`Bearer ${token}`);
    if (url.pathname === '/v9/projects/canvas') return response({ id: 'prj_canvas', name: 'canvas', accountId: 'team_test' });
    expect(url.searchParams.get('teamId')).toBe('team_test');
    if (url.pathname === '/v2/files') {
      const bytes = Buffer.from(init!.body as Uint8Array);
      expect((init?.headers as any)['x-vercel-digest']).toBe(crypto.createHash('sha1').update(bytes).digest('hex'));
      return new Response('');
    }
    if (url.pathname === '/v13/deployments') {
      const body = JSON.parse(String(init?.body)); const id = `dpl_${++next}`;
      const deployment = { id, projectId: 'prj_canvas', readyState: 'BUILDING', url: `canvas-${next}.vercel.app`, inspectorUrl: `https://vercel.com/team/canvas/${id}`, ...body };
      deployments.set(id, deployment); return response(deployment);
    }
    const deployment = deployments.get(url.pathname.split('/').pop()!);
    if (deployment) return response(deployment);
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  });
  const publisher = new SitePublisher(root, fetch, { VERCEL_TOKEN: token });
  return { publisher, fetch, deployments };
}

describe('local Vercel publisher', () => {
  it('includes the current runtime when an object uses Glitch without altering the saved site', () => {
    write(path.join(site, 'app/revyme-glitch-runtime.tsx'), '// @revyme-glitch-runtime-v1');
    write(path.join(site, 'vendor/revyme-runtime/dist/index.js'), 'obsolete');
    const payload = collectSiteSource(process.cwd(), site);
    const runtime = payload.find(file => file.file === 'vendor/revyme-runtime/dist/index.js');
    expect(runtime?.data.toString()).toContain('attachGlitchElements');
    const pkg = JSON.parse(payload.find(file => file.file === 'package.json')!.data.toString());
    expect(pkg.dependencies['@revyme/runtime']).toBe('file:./vendor/revyme-runtime');
    expect(fs.readFileSync(path.join(site, 'vendor/revyme-runtime/dist/index.js'), 'utf8')).toBe('obsolete');
  });
  it('retries a transient connection failure during a file upload', async () => {
    const { publisher, fetch } = provider();
    await publisher.connect('canvas', { project: 'canvas' });
    fetch.mockImplementationOnce(async () => { throw new TypeError('fetch failed'); });
    const result = await publisher.publish('canvas', 'preview');
    expect(result.deployment?.state).toBe('BUILDING');
    expect(fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v2/files')).toHaveLength(3);
  });

  it('uploads the saved site and runtime, omits secrets/editor metadata, and waits for READY before exposing a preview', async () => {
    write(path.join(site, '.env'), 'SECRET=never-upload');
    write(path.join(site, '_revyme/project-meta.json'), 'private-editor-state');
    write(path.join(site, 'public/image.png'), 'image');
    write(path.join(site, 'vendor/revyme-runtime/dist/index.js'), 'export const Displacement = true;');
    write(path.join(site, 'vendor/revyme-runtime/node_modules/private/index.js'), 'excluded');
    const { publisher, fetch, deployments } = provider();
    const connected = await publisher.connect('canvas', { project: 'canvas', token });
    expect(JSON.stringify(connected)).not.toContain(token);
    const started = await publisher.publish('canvas', 'preview');
    expect(started.preview).toBeUndefined(); expect(started.deployment?.state).toBe('BUILDING');
    const body = JSON.parse(String(fetch.mock.calls.find(([url]) => new URL(String(url)).pathname === '/v13/deployments')![1]!.body));
    expect(body.target).toBeUndefined(); expect(body.project).toBe('prj_canvas');
    expect(body.files.map((file: any) => file.file)).toEqual(['app/page.tsx', 'package.json', 'public/image.png', 'vendor/revyme-runtime/dist/index.js']);
    deployments.get(started.deployment!.id).readyState = 'READY';
    const ready = await publisher.status('canvas');
    expect(ready.preview?.url).toBe('https://canvas-1.vercel.app'); expect(ready.production).toBeUndefined();
    // Server restart retains the connection and successful URL, never the secret in its API.
    const restored = await new SitePublisher(root, fetch, {}).status('canvas');
    expect(restored.preview).toEqual(ready.preview); expect(JSON.stringify(restored)).not.toContain(token);
    expect(fs.statSync(path.join(root, '.revyme-local/publishing/canvas.json')).mode & 0o777).toBe(0o600);
  });

  it('promotes only the tested preview source, even after the editor files change', async () => {
    const { publisher, fetch, deployments } = provider();
    await publisher.connect('canvas', { project: 'canvas' });
    await expect(publisher.publish('canvas', 'production', 'dpl_other')).rejects.toThrow('ready preview');
    const started = await publisher.publish('canvas', 'preview');
    await expect(publisher.publish('canvas', 'preview')).rejects.toThrow('already in progress');
    deployments.get(started.deployment!.id).readyState = 'READY'; await publisher.status('canvas');
    write(path.join(site, 'app/page.tsx'), 'changed after preview');
    await expect(publisher.publish('canvas', 'production', 'dpl_other')).rejects.toThrow('ready preview');
    const result = await publisher.publish('canvas', 'production', started.deployment!.id);
    const creates = fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v13/deployments');
    expect(JSON.parse(String(creates[1][1]!.body))).toEqual({ name: 'canvas', project: 'prj_canvas', deploymentId: started.deployment!.id, target: 'production' });
    expect(result.production).toBeUndefined();
    deployments.get(result.deployment!.id).readyState = 'READY';
    expect((await publisher.status('canvas')).production?.url).toBe('https://canvas-2.vercel.app');
  });

  it('keeps the last ready preview if a later build fails and supports retry', async () => {
    const { publisher, deployments } = provider(); await publisher.connect('canvas', { project: 'canvas' });
    const first = await publisher.publish('canvas', 'preview'); deployments.get(first.deployment!.id).readyState = 'READY';
    const ready = await publisher.status('canvas'); const second = await publisher.publish('canvas', 'preview');
    Object.assign(deployments.get(second.deployment!.id), { readyState: 'ERROR', errorMessage: 'Build failed' });
    const failed = await publisher.status('canvas'); expect(failed.preview).toEqual(ready.preview); expect(failed.deployment?.error).toBe('Build failed');
    expect((await publisher.publish('canvas', 'preview')).deployment?.state).toBe('BUILDING');
  });

  it('rejects a mismatched deployment project without replacing the ready URL', async () => {
    const { publisher, deployments } = provider(); await publisher.connect('canvas', { project: 'canvas' });
    const started = await publisher.publish('canvas', 'preview');
    Object.assign(deployments.get(started.deployment!.id), { readyState: 'READY', projectId: 'prj_other' });
    await expect(publisher.status('canvas')).rejects.toThrow('different project');
  });

  it('does not create a Vercel project unless explicitly requested', async () => {
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => init?.method === 'POST' ? response({ id: 'prj_new', name: 'canvas' }) : response({ error: { message: 'Project not found' } }, 404));
    const publisher = new SitePublisher(root, fetch, { VERCEL_TOKEN: token });
    await expect(publisher.connect('canvas', { project: 'canvas' })).rejects.toThrow('Project not found');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await publisher.connect('canvas', { project: 'canvas', create: true })).connected).toBe(true);
    expect(String(fetch.mock.calls[2][0])).toContain('/v11/projects');
  });

  it('redacts a provider error containing the token and does not save failed credentials', async () => {
    const fetch = vi.fn(async () => response({ error: { message: `Invalid credential ${token}` } }, 401));
    const publisher = new SitePublisher(root, fetch, {});
    await expect(publisher.connect('canvas', { project: 'canvas', token })).rejects.toThrow('Invalid credential [redacted]');
    expect(fs.existsSync(path.join(root, '.revyme-local/publishing/canvas.json'))).toBe(false);
  });

  it('rejects concurrent uploads and recovers interrupted uploads after restart', async () => {
    const { publisher, fetch } = provider(); await publisher.connect('canvas', { project: 'canvas' });
    let finish!: () => void;
    fetch.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return response({}); });
    const first = publisher.publish('canvas', 'preview');
    await expect(publisher.publish('canvas', 'preview')).rejects.toThrow('already in progress');
    expect((await publisher.status('canvas')).deployment?.state).toBe('UPLOADING');
    finish(); await first;
    const file = path.join(root, '.revyme-local/publishing/canvas.json'); const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.deployment.state = 'UPLOADING'; data.deployment.id = ''; write(file, JSON.stringify(data));
    expect((await new SitePublisher(root, fetch, {}).status('canvas')).deployment?.error).toContain('interrupted');
  });

  it('copies referenced workspace fonts and rejects symlinks outside the site', () => {
    write(path.join(root, 'sites/.workspace/fonts/font.woff2'), 'font-bytes');
    write(path.join(site, 'app/globals.css'), '@font-face { src: url("/workspace-fonts/font.woff2") }');
    expect(collectSiteSource(root, site).find(file => file.file === 'public/workspace-fonts/font.woff2')?.data.toString()).toBe('font-bytes');
    fs.symlinkSync(path.join(root, 'sites/.workspace/fonts/font.woff2'), path.join(site, 'app/secret'));
    expect(() => collectSiteSource(root, site)).toThrow('symbolic link');
  });

  it('contains real Canvas pages and the bundled Displacement runtime', () => {
    const files = collectSiteSource(process.cwd(), path.join(process.cwd(), 'sites/canvas'));
    expect(files.map(file => file.file)).toEqual(expect.arrayContaining(['app/page.client.tsx', 'app/espacio/page.client.tsx', 'app/page-effects.ts', 'vendor/revyme-runtime/dist/index.js']));
    expect(files.every(file => !file.file.includes('node_modules') && !file.file.includes('_revyme') && !file.file.includes('_meta'))).toBe(true);
  });

  it('configures only the linked project production domain and reports ownership and DNS separately', async () => {
    let verified = false, configured = false;
    const calls: Array<{ path: string; body?: any }> = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: url.pathname, body });
      if (url.pathname === '/v9/projects/canvas') return response({ id: 'prj_canvas', name: 'canvas', accountId: 'team_test' });
      expect(url.searchParams.get('teamId')).toBe('team_test');
      if (url.pathname === '/v10/projects/prj_canvas/domains') { expect(body).toEqual({ name: 'www.example.com' }); return response({ name: body.name }); }
      if (url.pathname.endsWith('/verify')) { verified = true; return response({ verified }); }
      if (url.pathname === '/v9/projects/prj_canvas/domains') {
        expect(url.searchParams.get('production')).toBe('true');
        return response({ domains: [{ name: 'www.example.com', apexName: 'example.com', verified, verification: verified ? [] : [{ type: 'TXT', domain: '_vercel.example.com', value: 'ownership-code' }] }] });
      }
      if (url.pathname === '/v6/domains/www.example.com/config') return response({ misconfigured: !configured, recommendedCNAME: [{ rank: 1, value: 'project.vercel-dns.example' }] });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    const publisher = new SitePublisher(root, fetch, { VERCEL_TOKEN: token });
    await publisher.connect('canvas', { project: 'canvas' });
    const pending = await publisher.domains('canvas', 'add', 'WWW.EXAMPLE.COM');
    expect(pending.domains[0]).toMatchObject({ verified: false, configured: false, records: [{ type: 'TXT', name: '_vercel.example.com', value: 'ownership-code' }, { type: 'CNAME', name: 'www.example.com', value: 'project.vercel-dns.example' }] });
    expect((await publisher.domains('canvas', 'verify', 'www.example.com')).domains[0]).toMatchObject({ verified: true, configured: false });
    configured = true;
    expect((await publisher.domains('canvas')).domains[0]).toMatchObject({ verified: true, configured: true, records: [] });
    await expect(publisher.domains('canvas', 'add', 'https://www.example.com/path')).rejects.toThrow('domain name');
    expect(calls.some(call => call.path.includes('/deployments'))).toBe(false);
  });
});

describe('local publishing HTTP boundary', () => {
  async function call(headers: Record<string, string>, action = '', input?: unknown) {
    const { publisher } = provider(); const middleware = createPublishingMiddleware(root, publisher);
    const req: any = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
    req.url = `/api/sites/canvas/publish${action}`; req.method = input === undefined ? 'GET' : 'POST';
    req.headers = { host: 'localhost:3333', ...headers }; req.socket = { remoteAddress: '::1' };
    let text = ''; const res: any = { statusCode: 200, setHeader() {}, end(value: string) { text = value; } };
    await middleware(req, res, () => { throw new Error('Unexpected fallthrough'); });
    return { status: res.statusCode, body: JSON.parse(text) };
  }
  it('returns disconnected status and rejects foreign origins, hosts and non-JSON mutations', async () => {
    expect((await call({})).body.connected).toBe(false);
    expect((await call({ origin: 'https://other.example' })).status).toBe(403);
    expect((await call({ host: 'other.example' })).status).toBe(403);
    expect((await call({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call({ 'content-type': 'text/plain' }, '/preview', {})).status).toBe(415);
  });
});
