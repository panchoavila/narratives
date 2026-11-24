// branch-cli.ts — local work reaches the server as a branch, never as main
// (briefs/22-11-2026-branch-review-workflow.md, D4–D5).
//
//   npm run site:pull <site>        server main → sites/<site> (the working copy)
//   npm run branch:push <site>      working copy → the agent's work branch
//   npm run site:dev <site>         branch:push on every change, while it runs
//   npm run branch:done <site>      the work is done: the owner may apply it
//   npm run agent:token <site>      (owner) create this machine's agent token
//
// A linked site (`sites/<site>/_revyme/remote.json`) is a working copy of the
// server project. Its state — the main revision it was pulled at, those
// files (the base) and what was last pushed — lives in
// node_modules/.cache/narratives-sites/<site>/state.json. Pushes authenticate
// with an agent token, which the server only lets write branches; the oracle
// runs here before anything is sent, the server checks syntax and the CMS
// contract, and the owner applies the branch in the hosted editor.

import fs from 'node:fs';
import path from 'node:path';
import { walkManagedFiles, isManagedProjectPath, SITE_ID_RE } from './sites-plugin';
import { readEnvFiles } from './site-publishing';
import { oracleProblems } from './branch-oracle-check';

export interface BranchCliFlags {
  positional: string[];
  url?: string;
  token?: string;
  branch?: string;
  title?: string;
}

interface SiteState {
  origin: string;
  siteId: string;
  mainRevision: number;
  /** Server main's website files at the last pull: the base of new branches. */
  base: Record<string, string>;
  /** The working copy as last pushed to `branch`; null before any push. */
  pushed: Record<string, string> | null;
  branch: string | null;
}

const websitePath = (p: string) => isManagedProjectPath(p) && !p.startsWith('_meta/');

function websiteFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([p]) => websitePath(p)));
}

function siteDirOf(repoRoot: string, siteId: string | undefined, usage: string): { siteId: string; siteDir: string } {
  if (!siteId || !SITE_ID_RE.test(siteId)) throw new Error(usage);
  return { siteId, siteDir: path.join(repoRoot, 'sites', siteId) };
}

function statePath(repoRoot: string, siteId: string): string {
  return path.join(repoRoot, 'node_modules', '.cache', 'narratives-sites', siteId, 'state.json');
}

function loadState(repoRoot: string, siteId: string): SiteState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(repoRoot, siteId), 'utf8')) as SiteState;
  } catch {
    return null;
  }
}

function saveState(repoRoot: string, state: SiteState): void {
  const file = statePath(repoRoot, state.siteId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
}

function changedPaths(from: Record<string, string>, to: Record<string, string>): string[] {
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((p) => from[p] !== to[p]).sort();
}

function envVar(repoRoot: string, names: string[]): string {
  const fileEnv = readEnvFiles(repoRoot, 'CMS_');
  for (const n of names) {
    const v = process.env[n] || fileEnv[n];
    if (v) return v;
  }
  return '';
}

function originOf(repoRoot: string, flags: BranchCliFlags): string {
  const raw = flags.url || envVar(repoRoot, ['CMS_URL']);
  if (!raw) throw new Error('Missing CMS_URL. Set it in .env.local (the origin of your self-hosted server) or pass --url <origin>.');
  return new URL(raw).origin;
}

/** The agent token for `siteId`: CMS_AGENT_TOKEN_<SITE>, else CMS_AGENT_TOKEN. */
function agentHeaders(repoRoot: string, siteId: string, flags: BranchCliFlags, origin: string): Record<string, string> {
  const key = `CMS_AGENT_TOKEN_${siteId.toUpperCase().replace(/-/g, '_')}`;
  const token = flags.token || envVar(repoRoot, [key, 'CMS_AGENT_TOKEN']);
  if (!token) {
    throw new Error(`Missing an agent token for "${siteId}". The owner creates one with \`npm run agent:token ${siteId}\` (it is saved as ${key} in .env.local).`);
  }
  return { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function request(url: string, init: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function errorOf(body: any, status: number): string {
  const e = body?.error;
  return (typeof e === 'string' ? e : e?.message) || `HTTP ${status}`;
}

async function fetchMain(origin: string, siteId: string, headers: Record<string, string>): Promise<{ revision: number; files: Record<string, string> }> {
  const res = await request(`${origin}/api/sites/${encodeURIComponent(siteId)}`, { headers });
  if (res.status !== 200) throw new Error(`Could not read "${siteId}" from ${origin}: ${errorOf(res.body, res.status)}`);
  return { revision: res.body.revision ?? 0, files: websiteFiles(res.body.project?.files ?? {}) };
}

function writeWorkingCopy(siteDir: string, files: Record<string, string>): void {
  const local = websiteFiles(walkManagedFiles(siteDir));
  for (const p of Object.keys(local)) {
    if (!(p in files)) fs.rmSync(path.join(siteDir, p), { force: true });
  }
  for (const [p, content] of Object.entries(files)) {
    const abs = path.join(siteDir, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

function linkSite(siteDir: string, origin: string, siteId: string): void {
  const file = path.join(siteDir, '_revyme', 'remote.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ url: origin, siteId }, null, 2) + '\n');
}

/** `site:pull <site>` — refuses when the working copy holds work that was not pushed. */
export async function cmdPull(repoRoot: string, flags: BranchCliFlags): Promise<void> {
  const { siteId, siteDir } = siteDirOf(repoRoot, flags.positional[1], 'Usage: npm run site:pull <site-id>');
  const origin = originOf(repoRoot, flags);
  const headers = agentHeaders(repoRoot, siteId, flags, origin);
  const main = await fetchMain(origin, siteId, headers);
  const state = loadState(repoRoot, siteId);
  const local = fs.existsSync(siteDir) ? websiteFiles(walkManagedFiles(siteDir)) : {};
  // Work this copy holds that the server lacks. With a pull state, any
  // difference from what was last pulled or pushed (a deletion too); without
  // one, only local files that differ from main (an empty copy holds nothing).
  const unpushed = state
    ? changedPaths(state.pushed ?? state.base, local).filter((p) => local[p] !== main.files[p])
    : Object.keys(local).filter((p) => local[p] !== main.files[p]).sort();
  if (unpushed.length > 0) {
    throw new Error(
      `sites/${siteId} has work that is not on the server (${unpushed.length} file(s)):\n  ${unpushed.slice(0, 20).join('\n  ')}\n`
      + `Push it as a branch first: npm run branch:push ${siteId}`,
    );
  }
  writeWorkingCopy(siteDir, main.files);
  linkSite(siteDir, origin, siteId);
  saveState(repoRoot, { origin, siteId, mainRevision: main.revision, base: main.files, pushed: null, branch: null });
  console.log(`✓ ${siteId}: pulled main (revision ${main.revision}, ${Object.keys(main.files).length} files) from ${origin}.`);
}

/** One push of the working copy to the work branch. Returns false when there was nothing to push. */
async function pushOnce(repoRoot: string, siteId: string, siteDir: string, flags: BranchCliFlags, quiet = false): Promise<boolean> {
  const origin = originOf(repoRoot, flags);
  const headers = agentHeaders(repoRoot, siteId, flags, origin);
  let state = loadState(repoRoot, siteId);
  if (!state) {
    // First push of a site never pulled here: its base is the server's main now.
    const main = await fetchMain(origin, siteId, headers);
    state = { origin, siteId, mainRevision: main.revision, base: main.files, pushed: null, branch: null };
    linkSite(siteDir, origin, siteId);
  }
  if (state.branch) {
    const res = await request(`${origin}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(state.branch)}`, { headers });
    if (res.status === 404) {
      throw new Error(`Branch "${state.branch}" is gone from the server (applied or deleted). Run \`npm run site:pull ${siteId}\` to continue from the current main.`);
    }
  }
  const local = websiteFiles(walkManagedFiles(siteDir));
  const reference = state.pushed ?? state.base;
  const delta = changedPaths(reference, local);
  if (delta.length === 0) {
    if (!quiet) console.log(`${siteId}: nothing to push.`);
    return false;
  }
  const problems = oracleProblems(local, state.base, changedPaths(state.base, local));
  if (problems.length > 0) {
    throw new Error(`Not pushed — the oracle refuses ${problems.length} change(s):\n  ${problems.slice(0, 20).join('\n  ')}`);
  }
  const res = await request(`${origin}/api/sites/${encodeURIComponent(siteId)}/agent/write`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(state.branch ? { branch: state.branch } : flags.branch ? { branch: flags.branch } : {}),
      ...(flags.title ? { title: flags.title } : {}),
      ...(state.branch ? {} : { base: state.base }),
      files: {
        set: Object.fromEntries(delta.filter((p) => p in local).map((p) => [p, local[p]!])),
        del: delta.filter((p) => !(p in local)),
      },
    }),
  });
  if (res.status === 422) {
    const list: string[] = res.body?.error?.details?.problems ?? [errorOf(res.body, res.status)];
    throw new Error(`Not pushed — the server refuses ${list.length} problem(s):\n  ${list.slice(0, 20).join('\n  ')}`);
  }
  if (res.status !== 200) throw new Error(`Push failed: ${errorOf(res.body, res.status)}`);
  saveState(repoRoot, { ...state, branch: res.body.branch, pushed: local });
  console.log(`✓ ${siteId}: ${delta.length} file(s) on branch "${res.body.branch}" (revision ${res.body.revision}). The owner reviews and applies it in the editor.`);
  return true;
}

/** `branch:push <site> [--title "…"] [--branch <id>]` */
export async function cmdBranchPush(repoRoot: string, flags: BranchCliFlags): Promise<void> {
  const { siteId, siteDir } = siteDirOf(repoRoot, flags.positional[1], 'Usage: npm run branch:push <site-id> [--title "what changed"]');
  await pushOnce(repoRoot, siteId, siteDir, flags);
}

/** `branch:done <site>` — releases the work branch so the owner can apply it. */
export async function cmdBranchDone(repoRoot: string, flags: BranchCliFlags): Promise<void> {
  const { siteId } = siteDirOf(repoRoot, flags.positional[1], 'Usage: npm run branch:done <site-id>');
  const state = loadState(repoRoot, siteId);
  const origin = originOf(repoRoot, flags);
  const headers = agentHeaders(repoRoot, siteId, flags, origin);
  const res = await request(`${origin}/api/sites/${encodeURIComponent(siteId)}/agent/finish`, {
    method: 'POST',
    headers,
    body: JSON.stringify(state?.branch ? { branch: state.branch } : {}),
  });
  if (res.status !== 200) throw new Error(`Could not finish: ${errorOf(res.body, res.status)}`);
  if (state) saveState(repoRoot, { ...state, branch: null });
  console.log(res.body.branch ? `✓ ${siteId}: branch "${res.body.branch}" is ready for review.` : `${siteId}: no open work branch.`);
}

/** `site:dev <site>` — push the working copy to the work branch on every change. */
export async function cmdDev(repoRoot: string, flags: BranchCliFlags): Promise<void> {
  const { siteId, siteDir } = siteDirOf(repoRoot, flags.positional[1], 'Usage: npm run site:dev <site-id>');
  if (!fs.existsSync(siteDir)) throw new Error(`sites/${siteId} does not exist — run \`npm run site:pull ${siteId}\` first.`);
  console.log(`Watching sites/${siteId}: every change goes to its work branch on the server (Ctrl+C to stop).`);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      await pushOnce(repoRoot, siteId, siteDir, flags, true);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
      if (again) { again = false; void run(); }
    }
  };
  fs.watch(siteDir, { recursive: true }, (_event, file) => {
    const rel = String(file ?? '').replace(/\\/g, '/');
    if (!rel || !websitePath(rel)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), 1500);
  });
  await run();
  await new Promise<never>(() => {});
}

/** `agent:token <site> [label]` — the owner creates an agent token (admin credentials) and saves it to .env.local. */
export async function cmdAgentToken(repoRoot: string, flags: BranchCliFlags): Promise<void> {
  const { siteId } = siteDirOf(repoRoot, flags.positional[1], 'Usage: npm run agent:token <site-id> [label]');
  const origin = originOf(repoRoot, flags);
  const admin = flags.token || envVar(repoRoot, ['CMS_ADMIN_TOKEN']);
  if (!admin) throw new Error('Creating an agent token takes the owner\'s credentials: pass --token <admin token> (or set CMS_ADMIN_TOKEN for this command only).');
  const label = flags.positional[2] || `cli ${new Date().toISOString().slice(0, 10)}`;
  const res = await request(`${origin}/api/sites/${encodeURIComponent(siteId)}/agent-tokens`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (res.status !== 201) throw new Error(`Could not create the token: ${errorOf(res.body, res.status)}`);
  const key = `CMS_AGENT_TOKEN_${siteId.toUpperCase().replace(/-/g, '_')}`;
  const envFile = path.join(repoRoot, '.env.local');
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => !l.startsWith(`${key}=`)) : [];
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.push(`${key}=${res.body.token}`, '');
  fs.writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
  console.log(`✓ ${siteId}: agent token "${label}" created and saved to .env.local as ${key}. It can read the site and write branches only.`);
}
