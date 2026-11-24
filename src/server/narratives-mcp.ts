// narratives-mcp.ts — an MCP server (stdio) that lets an agent such as Claude
// Code work on a hosted Narratives project the way Framer's external agents
// do: it reads the site and writes BRANCHES, and the owner reviews and applies
// them in the editor (briefs/22-11-2026-branch-review-workflow.md, D6).
//
// It speaks to the self-hosted server's HTTP API with per-site agent tokens
// (`CMS_AGENT_TOKEN_<SITE>`, created by the owner with `npm run agent:token`),
// which the server lets read the site and write branches and nothing else.
// There is no tool to apply, publish or delete: those are the owner's.
//
// Protocol: JSON-RPC 2.0, one message per line on stdin/stdout (MCP stdio
// transport). Started by server/narratives-mcp.mjs; configure it in an MCP
// client as `node server/narratives-mcp.mjs` from the repository root, with
// CMS_URL and the agent tokens in the environment or .env.local.

import readline from 'node:readline';
import { readEnvFiles } from './site-publishing';
import { oracleProblems } from './branch-oracle-check';
import { describeFileChanges } from '../code/branching/describe-changes';

const SERVER_NAME = 'narratives';
const SERVER_VERSION = '1.0.0';

type Json = Record<string, unknown>;

const env = { ...readEnvFiles(process.cwd(), 'CMS_'), ...process.env } as Record<string, string | undefined>;
const ORIGIN = env.CMS_URL ? new URL(env.CMS_URL).origin : '';

function tokenFor(site: string): string {
  return env[`CMS_AGENT_TOKEN_${site.toUpperCase().replace(/-/g, '_')}`] || env.CMS_AGENT_TOKEN || '';
}

function sitesWithTokens(): string[] {
  return Object.keys(env)
    .filter((k) => k.startsWith('CMS_AGENT_TOKEN_') && env[k])
    .map((k) => k.slice('CMS_AGENT_TOKEN_'.length).toLowerCase().replace(/_/g, '-'));
}

class ToolError extends Error {}

async function api(site: string, pathname: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  if (!ORIGIN) throw new ToolError('CMS_URL is not set (the origin of the self-hosted server).');
  const token = tokenFor(site);
  if (!token) throw new ToolError(`No agent token for "${site}". The owner creates one with \`npm run agent:token ${site}\`.`);
  const res = await fetch(`${ORIGIN}${pathname}`, {
    method: init.method ?? 'GET',
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (payload as { error?: unknown } | null)?.error;
    const message = typeof e === 'string' ? e : (e as { message?: string } | undefined)?.message || `HTTP ${res.status}`;
    const problems = (e as { details?: { problems?: string[] } } | undefined)?.details?.problems;
    throw new ToolError(problems?.length ? `${message}\n${problems.map((p) => `- ${p}`).join('\n')}` : message);
  }
  return payload;
}

const site = (args: Json) => {
  const s = args.site;
  if (typeof s !== 'string' || !/^[a-z0-9-]+$/.test(s)) throw new ToolError('"site" is required (a site id, see list_sites).');
  return s;
};
const optString = (args: Json, key: string) => (typeof args[key] === 'string' && args[key] ? (args[key] as string) : undefined);
const website = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith('_meta/')));

async function mainFiles(s: string): Promise<Record<string, string>> {
  const body = await api(s, `/api/sites/${s}`);
  return website(body.project?.files ?? {});
}

async function branchOf(s: string, branch: string): Promise<{ base: Record<string, string>; files: Record<string, string>; revision: number; lease: unknown }> {
  return api(s, `/api/sites/${s}/branches/${encodeURIComponent(branch)}`);
}

async function filesOf(s: string, branch?: string): Promise<Record<string, string>> {
  return branch ? (await branchOf(s, branch)).files : mainFiles(s);
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run(args: Json): Promise<string>;
}

const siteProp = { site: { type: 'string', description: 'Site id (see list_sites).' } };

const TOOLS: Tool[] = [
  {
    name: 'list_sites',
    description: 'The sites this machine has an agent token for.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const out: unknown[] = [];
      for (const s of sitesWithTokens()) {
        const body = await api(s, '/api/sites');
        out.push(...(body.sites ?? []));
      }
      return JSON.stringify(out, null, 2);
    },
  },
  {
    name: 'list_files',
    description: "The site's files — main (the published truth) by default, or a branch's.",
    inputSchema: { type: 'object', properties: { ...siteProp, branch: { type: 'string', description: 'Branch id; omit for main.' } }, required: ['site'] },
    async run(args) {
      return Object.keys(await filesOf(site(args), optString(args, 'branch'))).sort().join('\n');
    },
  },
  {
    name: 'read_file',
    description: "One file's content, from main by default or from a branch.",
    inputSchema: { type: 'object', properties: { ...siteProp, path: { type: 'string' }, branch: { type: 'string' } }, required: ['site', 'path'] },
    async run(args) {
      const p = optString(args, 'path');
      if (!p) throw new ToolError('"path" is required.');
      const files = await filesOf(site(args), optString(args, 'branch'));
      if (!(p in files)) throw new ToolError(`No file "${p}".`);
      return files[p]!;
    },
  },
  {
    name: 'list_branches',
    description: 'The branches of a site, with their revision, status and whether an agent is working on them.',
    inputSchema: { type: 'object', properties: siteProp, required: ['site'] },
    async run(args) {
      return JSON.stringify((await api(site(args), `/api/sites/${site(args)}/branches`)).branches, null, 2);
    },
  },
  {
    name: 'write_files',
    description:
      'Write files to a BRANCH (never main). Without `branch`, they go to your open work branch, or a new one named after `title`. '
      + 'Every change is checked first (oracle, syntax, CMS contract); problems come back as the error and nothing is written. '
      + 'The owner reviews and applies the branch in the editor; call finish_branch when your work is ready.',
    inputSchema: {
      type: 'object',
      properties: {
        ...siteProp,
        files: { type: 'object', additionalProperties: { type: 'string' }, description: 'path → full new content.' },
        delete: { type: 'array', items: { type: 'string' }, description: 'Paths to delete.' },
        branch: { type: 'string', description: 'Your work branch; omit to use the open one or start one.' },
        title: { type: 'string', description: 'What this work is about (names a new branch).' },
      },
      required: ['site'],
    },
    async run(args) {
      const s = site(args);
      const set = (args.files && typeof args.files === 'object' ? args.files : {}) as Record<string, string>;
      const del = Array.isArray(args.delete) ? (args.delete as string[]) : [];
      const branch = optString(args, 'branch');
      const current = branch ? await branchOf(s, branch) : null;
      const base = current ? current.base : await mainFiles(s);
      const proposed = { ...(current ? current.files : base) };
      for (const p of del) delete proposed[p];
      for (const [p, c] of Object.entries(set)) proposed[p] = String(c);
      const changed = [...new Set([...Object.keys(set), ...del])];
      const problems = oracleProblems(proposed, base, changed);
      if (problems.length > 0) throw new ToolError(`Nothing written — the oracle refuses:\n${problems.map((p) => `- ${p}`).join('\n')}`);
      const res = await api(s, `/api/sites/${s}/agent/write`, {
        method: 'POST',
        body: { ...(branch ? { branch } : {}), ...(optString(args, 'title') ? { title: optString(args, 'title') } : {}), files: { set, del } },
      });
      return JSON.stringify({ branch: res.branch, revision: res.revision, created: res.created, changed: res.changed, next: 'Keep writing to this branch, then call finish_branch. The owner applies it.' });
    },
  },
  {
    name: 'review_branch',
    description: 'What a branch changed against the version it was cut from, per file and per node or CMS item — what the owner sees in review.',
    inputSchema: { type: 'object', properties: { ...siteProp, branch: { type: 'string' } }, required: ['site', 'branch'] },
    async run(args) {
      const b = await branchOf(site(args), optString(args, 'branch') ?? '');
      const lines: string[] = [];
      for (const p of [...new Set([...Object.keys(b.base), ...Object.keys(b.files)])].sort()) {
        if (b.base[p] === b.files[p]) continue;
        const status = !(p in b.base) ? 'added' : !(p in b.files) ? 'removed' : 'changed';
        lines.push(`${p} (${status})`);
        if (status === 'changed') {
          for (const c of describeFileChanges(b.base[p] ?? null, b.files[p] ?? null).changes) {
            lines.push(`  ${c.kind} ${c.title}${c.props.length ? ': ' + c.props.map((x) => `${x.label} ${x.before || '—'} → ${x.after || '—'}`).join(', ') : ''}`);
          }
        }
      }
      return lines.length ? lines.join('\n') : 'No changes on this branch.';
    },
  },
  {
    name: 'check_site',
    description: 'Check proposed changes without writing them (oracle, syntax, CMS contract). Same input as write_files.',
    inputSchema: {
      type: 'object',
      properties: { ...siteProp, files: { type: 'object', additionalProperties: { type: 'string' } }, delete: { type: 'array', items: { type: 'string' } }, branch: { type: 'string' } },
      required: ['site'],
    },
    async run(args) {
      const s = site(args);
      const set = (args.files && typeof args.files === 'object' ? args.files : {}) as Record<string, string>;
      const del = Array.isArray(args.delete) ? (args.delete as string[]) : [];
      const branch = optString(args, 'branch');
      const current = branch ? await branchOf(s, branch) : null;
      const base = current ? current.base : await mainFiles(s);
      const proposed = { ...(current ? current.files : base) };
      for (const p of del) delete proposed[p];
      for (const [p, c] of Object.entries(set)) proposed[p] = String(c);
      const problems = oracleProblems(proposed, base, [...new Set([...Object.keys(set), ...del])]);
      if (problems.length > 0) return `Problems:\n${problems.map((p) => `- ${p}`).join('\n')}`;
      await api(s, `/api/sites/${s}/agent/check`, { method: 'POST', body: { ...(branch ? { branch } : {}), files: { set, del } } });
      return 'No problems.';
    },
  },
  {
    name: 'finish_branch',
    description: 'Your work on the branch is done: the owner can now apply it, and your next write starts a new branch.',
    inputSchema: { type: 'object', properties: { ...siteProp, branch: { type: 'string' } }, required: ['site'] },
    async run(args) {
      const s = site(args);
      const res = await api(s, `/api/sites/${s}/agent/finish`, { method: 'POST', body: optString(args, 'branch') ? { branch: optString(args, 'branch') } : {} });
      return res.branch ? `Branch "${res.branch}" is ready for the owner's review.` : 'No open work branch.';
    },
  },
];

function send(message: Json): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(msg: Json): Promise<void> {
  const id = msg.id as string | number | undefined;
  const method = msg.method as string | undefined;
  const params = (msg.params ?? {}) as Json;
  if (id === undefined) return; // notifications (initialized, cancelled) need no reply
  const reply = (result: unknown) => send({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      reply({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Work on hosted Narratives sites. You write branches only: write_files puts your changes on your work branch, '
          + 'checked first by the oracle; the owner reviews and applies it in the editor. Read before you write, and call finish_branch when done.',
      });
      return;
    case 'ping':
      reply({});
      return;
    case 'tools/list':
      reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      return;
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool "${String(params.name)}".`);
      try {
        const text = await tool.run((params.arguments ?? {}) as Json);
        reply({ content: [{ type: 'text', text }] });
      } catch (err) {
        reply({ content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true });
      }
      return;
    }
    default:
      fail(-32601, `Method not found: ${String(method)}`);
  }
}

export function startMcpServer(): void {
  // stdout is the protocol channel: anything else printed there (a trace, a
  // library's console.log) would corrupt it, so it goes to stderr.
  const toStderr = (...parts: unknown[]) => process.stderr.write(`${parts.map(String).join(' ')}\n`);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    void handle(msg);
  });
}

if (process.env.NARRATIVES_MCP_RUN === '1') startMcpServer();
