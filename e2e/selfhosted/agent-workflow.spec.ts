// Agents work on branches, end to end: the CLI and the MCP server
// (briefs/22-11-2026-branch-review-workflow.md, D4–D6).
//
// A temporary workspace plays the developer's machine: the owner creates an
// agent token there (`agent:token`), the CLI pulls the site, edits land on
// the server as a work branch (`branch:push`), and the owner reviews and
// applies it in the hosted editor. The MCP server is driven over stdio the
// way Claude Code drives it.
//
// Failure modes, written before the code (brief numbers in brackets):
//   G1 [37,38] A push without a branch opens `agent-<date>-<slug>`; the next
//              push lands on the same branch.
//   G2 [17]    The owner sees it live; while the agent's lease holds, Apply
//              is disabled; after `branch:done` it applies, and main has the
//              change.
//   G3 [34]    `site:pull` after the apply succeeds and matches main.
//   G4 [36]    `branch:push` with nothing changed pushes nothing.
//   G5 [13]    A page that does not parse is refused locally, nothing sent.
//   G6 [12]    The agent token is refused on a main save, a branch delete,
//              publishing and other sites (403); main is byte-identical.
//   G7 [39]    `agent/write` naming main: refused.
//   G8 [10]    `agent/write` with CMS items that break their schema: 422 with
//              the problem, nothing written.
//   G9 [40]    A second agent token works on its own branch.
//   G10 [51]   `design:push` is retired, in the CLI and on the server (410).
//   G11 [14,15] MCP: no apply/publish/delete tool; a write with a page that
//              does not parse is an error and writes nothing; a valid write
//              lands on a work branch; an unknown site is an error;
//              finish_branch releases it.
//
// Artifact: test-results/selfhosted/agent-workflow/summary.json (written even
// when a step fails), screenshots, the owner's trace and video.

import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN, SITES, signIn, closePerson, openSite, openBranchesPanel, type Person } from './helpers';

const REPO = path.resolve(__dirname, '..', '..');
const SERVER_URL = 'http://127.0.0.1:4334';
const ADMIN_TOKEN = 'e2e-admin-sync-token-0123456789abcdef';
const SITE = 'atlas';
const ARTIFACTS = path.resolve(REPO, 'test-results', 'selfhosted', 'agent-workflow');
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

let workspace = '';

function cli(args: string[], extraEnv: Record<string, string> = {}): { ok: boolean; out: string } {
  try {
    const out = execFileSync(process.execPath, [path.join(REPO, 'server', 'site-sync.mjs'), ...args], {
      cwd: workspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CMS_URL: SERVER_URL, ...extraEnv },
    });
    return { ok: true, out };
  } catch (err: any) {
    return { ok: false, out: `${err?.stdout ?? ''}${err?.stderr ?? ''}` };
  }
}

function envToken(site: string): string {
  const line = fs.readFileSync(path.join(workspace, '.env.local'), 'utf8').split('\n').find((l) => l.startsWith(`CMS_AGENT_TOKEN_${site.toUpperCase()}=`));
  return line ? line.split('=')[1]! : '';
}

const mainPage = () => fs.readFileSync(path.join(SITES, SITE, 'app', 'page.client.tsx'), 'utf8');
const localPage = () => fs.readFileSync(path.join(workspace, 'sites', SITE, 'app', 'page.client.tsx'), 'utf8');

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

/** One MCP session over stdio: send requests, collect responses by id. */
function mcpSession(token: string) {
  const child = spawn(process.execPath, [path.join(REPO, 'server', 'narratives-mcp.mjs')], {
    cwd: workspace,
    env: { ...process.env, CMS_URL: SERVER_URL, [`CMS_AGENT_TOKEN_${SITE.toUpperCase()}`]: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, (v: any) => void>();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  let next = 1;
  const request = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
    const id = next++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 60_000);
  });
  const call = async (name: string, args: unknown) => (await request('tools/call', { name, arguments: args })).result as { content: { text: string }[]; isError?: boolean };
  return { request, call, close: () => child.kill() };
}

test('agents push branches through the CLI and MCP; the owner reviews and applies them', async ({ browser }) => {
  test.setTimeout(300_000);
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'narratives-agent-'));
  fs.mkdirSync(path.join(workspace, 'sites'), { recursive: true });
  const summary: Record<string, unknown> = { site: SITE, result: 'fail' };
  const save = () => fs.writeFileSync(path.join(ARTIFACTS, 'summary.json'), JSON.stringify(summary, null, 2));
  const people: Person[] = [];

  try {
    const owner = await signIn(browser, ADMIN, ARTIFACTS);
    people.push(owner);
    expect((await owner.context.request.post('/api/sites', { data: { name: 'Atlas', id: SITE } })).status()).toBe(201);

    // The owner creates this machine's agent token (owner credentials, once).
    const made = cli(['agent-token', SITE, 'e2e laptop', '--token', ADMIN_TOKEN]);
    expect(made.ok, made.out).toBe(true);
    const token = envToken(SITE);
    expect(token).toMatch(/^nat_/);

    // ── G10: design:push is retired ──
    const retired = cli(['push-design', SITE]);
    expect(retired.ok).toBe(false);
    expect(retired.out).toContain('branch:push');
    const gone = await fetch(`${SERVER_URL}/api/sites/${SITE}/design`, { method: 'POST', headers: { Origin: SERVER_URL, Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' });
    expect(gone.status).toBe(410);

    // ── pull, edit, push (G1) ──
    const firstPull = cli(['pull', SITE]);
    expect(firstPull.ok, firstPull.out).toBe(true);
    expect(localPage()).toBe(mainPage());
    const original = localPage();
    const marker = 'Escrito por el agente';
    const edited = original.replace(/(<h1[^>]*>)([^<]*)(<\/h1>)/, `$1${marker}$3`);
    expect(edited, 'the scaffold page has an h1 to edit').not.toBe(original);
    fs.writeFileSync(path.join(workspace, 'sites', SITE, 'app', 'page.client.tsx'), edited);
    const push1 = cli(['branch-push', SITE, '--title', 'Hero copy']);
    expect(push1.ok, push1.out).toBe(true);
    const branch = `agent-${today}-hero-copy`;
    expect(push1.out).toContain(branch);
    fs.writeFileSync(path.join(workspace, 'sites', SITE, 'app', 'page.client.tsx'), edited.replace(marker, `${marker}, dos veces`));
    const push2 = cli(['branch-push', SITE]);
    expect(push2.ok, push2.out).toBe(true);
    expect(push2.out, 'G1: the second push lands on the same branch').toContain(branch);
    summary.G1 = { branch, push1: push1.out.trim(), push2: push2.out.trim() };
    save();

    // ── G4 ──
    const nothing = cli(['branch-push', SITE]);
    expect(nothing.ok && nothing.out.includes('nothing to push'), nothing.out).toBe(true);

    // ── G5: a page that does not parse never leaves the machine ──
    fs.writeFileSync(path.join(workspace, 'sites', SITE, 'app', 'page.client.tsx'), `${localPage()}\n<div data-id="broken">`);
    const broken = cli(['branch-push', SITE]);
    expect(broken.ok).toBe(false);
    expect(broken.out).toMatch(/oracle|syntax/i);
    fs.writeFileSync(path.join(workspace, 'sites', SITE, 'app', 'page.client.tsx'), edited.replace(marker, `${marker}, dos veces`));
    summary.G5 = broken.out.trim().split('\n').slice(0, 3);

    // ── G6–G8: the agent token's limits ──
    const mainBefore = mainPage();
    const asAgent = (method: string, p: string, body?: unknown) =>
      fetch(`${SERVER_URL}${p}`, { method, headers: { Origin: SERVER_URL, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const g6 = [
      (await asAgent('PUT', `/api/sites/${SITE}`, { files: { 'app/page.client.tsx': '// x' }, baseRevision: 0 })).status,
      (await asAgent('DELETE', `/api/sites/${SITE}/branches/${branch}`)).status,
      (await asAgent('POST', `/api/sites/${SITE}/publish/production`, {})).status,
      (await asAgent('GET', `/api/sites/demo`)).status,
    ];
    summary.G6 = g6;
    expect(g6, 'G6: main save, branch delete, publish, another site → 403').toEqual([403, 403, 403, 403]);
    expect(mainPage()).toBe(mainBefore);
    expect((await asAgent('POST', `/api/sites/${SITE}/agent/write`, { branch: 'main', files: { set: { 'app/page.client.tsx': mainBefore } } })).status, 'G7').toBe(403);
    const entries = JSON.parse(fs.readFileSync(path.join(SITES, SITE, 'cms', 'entries.json'), 'utf8'));
    const badItems = JSON.stringify([{ ...entries[0], title: '' }], null, 2);
    const g8 = await asAgent('POST', `/api/sites/${SITE}/agent/write`, { title: 'bad items', files: { set: { 'cms/entries.json': badItems } } });
    const g8body = await g8.json();
    summary.G8 = { status: g8.status, error: g8body?.error?.message };
    save();
    expect(g8.status, 'G8: invalid items refused').toBe(422);
    expect(fs.existsSync(path.join(SITES, SITE, '_revyme', 'branches', `agent-${today}-bad-items.json`))).toBe(false);

    // ── G2: the owner reviews; the lease holds Apply; branch:done releases it ──
    await openSite(owner.page, SITE);
    await openBranchesPanel(owner.page);
    await expect(owner.page.getByText(branch, { exact: true }).first()).toBeVisible();
    await owner.page.getByText(branch, { exact: true }).first().click({ button: 'right' });
    await owner.page.getByText('Review changes…').click();
    await expect(owner.page.getByTestId('branch-agent-working')).toBeVisible();
    await expect(owner.page.getByTestId('branch-apply')).toBeDisabled();
    await shot(owner.page, 'g2-agent-still-working');
    const done = cli(['branch-done', SITE]);
    expect(done.ok, done.out).toBe(true);
    await expect(owner.page.getByTestId('branch-apply')).toBeEnabled({ timeout: 15_000 });
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-apply')).toHaveCount(0);
    await expect.poll(() => mainPage().includes(`${marker}, dos veces`), { timeout: 30_000, message: 'G2: main has the agent’s change' }).toBe(true);
    await shot(owner.page, 'g2-applied');

    // ── G3: pull after the apply ──
    const pulled = cli(['pull', SITE]);
    expect(pulled.ok, pulled.out).toBe(true);
    expect(localPage()).toBe(mainPage());
    summary.G2G3 = { applied: true, pulledEqualsMain: localPage() === mainPage() };
    save();

    // ── G9: a second agent works on its own branch ──
    expect(cli(['agent-token', SITE, 'second agent', '--token', ADMIN_TOKEN]).ok).toBe(true);
    const token2 = envToken(SITE);
    expect(token2).not.toBe(token);
    const w2 = await fetch(`${SERVER_URL}/api/sites/${SITE}/agent/write`, {
      method: 'POST',
      headers: { Origin: SERVER_URL, Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'second', files: { set: { 'app/page.client.tsx': mainPage().replace(marker, 'Otro agente') } } }),
    });
    const w2body = await w2.json();
    expect(w2.status).toBe(200);
    expect(w2body.branch).toBe(`agent-${today}-second`);

    // ── G11: MCP ──
    const mcp = mcpSession(token2);
    try {
      const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
      expect(init.result.serverInfo.name).toBe('narratives');
      const tools = (await mcp.request('tools/list')).result.tools.map((t: { name: string }) => t.name);
      summary.G11tools = tools;
      expect(tools).toEqual(expect.arrayContaining(['list_sites', 'read_file', 'write_files', 'review_branch', 'finish_branch']));
      expect(tools.some((t: string) => /apply|publish|delete_branch/.test(t)), 'G11: no apply, publish or delete').toBe(false);
      const sites = await mcp.call('list_sites', {});
      expect(sites.content[0].text).toContain(SITE);
      const badWrite = await mcp.call('write_files', { site: SITE, branch: `agent-${today}-second`, files: { 'app/page.client.tsx': '<div data-id="x">' } });
      expect(badWrite.isError, 'G11: a page that does not parse is refused').toBe(true);
      const page2 = (await mcp.call('read_file', { site: SITE, path: 'app/page.client.tsx', branch: `agent-${today}-second` })).content[0].text;
      expect(page2).toContain('Otro agente');
      const goodWrite = await mcp.call('write_files', { site: SITE, branch: `agent-${today}-second`, files: { 'app/page.client.tsx': page2.replace('Otro agente', 'Otro agente vía MCP') } });
      expect(goodWrite.isError ?? false, goodWrite.content[0].text).toBe(false);
      const review = await mcp.call('review_branch', { site: SITE, branch: `agent-${today}-second` });
      expect(review.content[0].text).toContain('app/page.client.tsx');
      const otherSite = await mcp.call('list_files', { site: 'demo' });
      expect(otherSite.isError, 'G11: no token for another site').toBe(true);
      const finished = await mcp.call('finish_branch', { site: SITE, branch: `agent-${today}-second` });
      expect(finished.content[0].text).toContain('ready');
      summary.G11 = { badWrite: badWrite.content[0].text.slice(0, 200), goodWrite: goodWrite.content[0].text, review: review.content[0].text };
    } finally {
      mcp.close();
    }
    expect(mainPage(), 'nothing an agent did reached main without the owner').not.toContain('vía MCP');
    summary.result = 'pass';
  } finally {
    save();
    for (const p of people) await closePerson(p, ARTIFACTS).catch(() => {});
  }
});
