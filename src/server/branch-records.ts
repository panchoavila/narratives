// branch-records.ts — the server's copy of a site's branches.
//
// A branch used to live only inside the editor's save envelope, so it was
// last-writer-wins: a tab that never saw a branch erased it at its next save
// (briefs/22-11-2026-branch-review-workflow.md, facts 3–4). Branches are now
// records of their own, each with its own revision, stored next to the site:
//
//   sites/<id>/_revyme/branches/<branch>.json   path → sha for base and files
//   sites/<id>/_revyme/blobs/<sha256>           each file content, stored once
//
// A record names its merge base and its files by content hash, so it never
// depends on main as saved later (a delta against main would break as soon as
// main moved). Blobs are shared between branches; a branch costs only what it
// changes. `_revyme/` is outside the managed project directories, so none of
// this is published, exported or walked as site source.
//
// Shared by the self-hosted server (server/api.ts) and the local Vite plugin
// (sites-plugin.ts). Node only; no editor imports.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAIN_BRANCH_ID = 'main';
const BRANCH_ID_RE = /^[a-z0-9-]{1,48}$/;

export type BranchStatus = 'clean' | 'dirty' | 'conflict';
const STATUSES: ReadonlySet<string> = new Set(['clean', 'dirty', 'conflict']);

export interface BranchMeta {
  status: BranchStatus;
  parentId: string | null;
  order: number;
  createdAt: number;
  lastEditedAt: number | null;
}

export interface BranchLease {
  holder: string;
  until: number;
}

export interface BranchRecord extends BranchMeta {
  id: string;
  revision: number;
  /** path → sha256 of the merge base. */
  base: Record<string, string>;
  /** path → sha256 of the branch's files. */
  files: Record<string, string>;
  createdBy: string | null;
  lease: BranchLease | null;
}

export interface BranchSummary extends BranchMeta {
  id: string;
  revision: number;
  changedFiles: number;
  createdBy: string | null;
  lease: BranchLease | null;
}

export interface MaterializedBranch {
  record: BranchRecord;
  base: Record<string, string>;
  files: Record<string, string>;
}

/** Changes to a map: contents to set, paths to delete. */
export interface FileDeltaBody {
  set?: Record<string, string>;
  del?: string[];
}

/** One branch write. `baseRevision` is the branch revision the writer last
 *  saw; null creates the branch. A create carries the full maps in `set`. */
export interface BranchChange {
  baseRevision: number | null;
  base?: FileDeltaBody;
  files?: FileDeltaBody;
  meta?: Partial<BranchMeta>;
}

export type WriteBranchResult =
  | { kind: 'ok'; record: BranchRecord; created: boolean }
  | { kind: 'conflict'; revision: number }
  | { kind: 'invalid'; message: string };

export function isValidBranchId(id: string): boolean {
  return id !== MAIN_BRANCH_ID && BRANCH_ID_RE.test(id);
}

function recordsDir(siteDir: string): string {
  return path.join(siteDir, '_revyme', 'branches');
}

function blobsDir(siteDir: string): string {
  return path.join(siteDir, '_revyme', 'blobs');
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Write via a temp file + rename, so a crash never leaves half a file. */
function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function putBlob(siteDir: string, content: string): string {
  const hash = sha256(content);
  const file = path.join(blobsDir(siteDir), hash);
  if (!fs.existsSync(file)) writeAtomic(file, content);
  return hash;
}

function getBlob(siteDir: string, hash: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const file = path.join(blobsDir(siteDir), hash);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

export function readBranchRecord(siteDir: string, id: string): BranchRecord | null {
  if (!isValidBranchId(id)) return null;
  const file = path.join(recordsDir(siteDir), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<BranchRecord>;
    if (!isStringRecord(raw.base) || !isStringRecord(raw.files) || typeof raw.revision !== 'number') return null;
    return {
      id,
      revision: raw.revision,
      base: raw.base,
      files: raw.files,
      status: STATUSES.has(String(raw.status)) ? (raw.status as BranchStatus) : 'dirty',
      parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
      order: typeof raw.order === 'number' ? raw.order : 0,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      lastEditedAt: typeof raw.lastEditedAt === 'number' ? raw.lastEditedAt : null,
      createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : null,
      lease: raw.lease && typeof raw.lease.holder === 'string' && typeof raw.lease.until === 'number' ? raw.lease : null,
    };
  } catch {
    return null;
  }
}

function changedFileCount(record: BranchRecord): number {
  const paths = new Set([...Object.keys(record.base), ...Object.keys(record.files)]);
  let n = 0;
  for (const p of paths) if (record.base[p] !== record.files[p]) n++;
  return n;
}

export function listBranchRecords(siteDir: string): BranchRecord[] {
  const dir = recordsDir(siteDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readBranchRecord(siteDir, f.slice(0, -'.json'.length)))
    .filter((r): r is BranchRecord => r !== null)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function listBranchSummaries(siteDir: string): BranchSummary[] {
  return listBranchRecords(siteDir).map((r) => ({
    id: r.id,
    revision: r.revision,
    status: r.status,
    parentId: r.parentId,
    order: r.order,
    createdAt: r.createdAt,
    lastEditedAt: r.lastEditedAt,
    changedFiles: changedFileCount(r),
    createdBy: r.createdBy,
    lease: r.lease,
  }));
}

/** The record with every file's content, or null when a blob is missing. */
export function readBranchMaterialized(siteDir: string, id: string): MaterializedBranch | null {
  const record = readBranchRecord(siteDir, id);
  if (!record) return null;
  const load = (map: Record<string, string>): Record<string, string> | null => {
    const out: Record<string, string> = {};
    for (const [p, hash] of Object.entries(map)) {
      const content = getBlob(siteDir, hash);
      if (content === null) return null;
      out[p] = content;
    }
    return out;
  };
  const base = load(record.base);
  const files = load(record.files);
  if (!base || !files) return null;
  return { record, base, files };
}

function applyDelta(
  siteDir: string,
  from: Record<string, string>,
  delta: FileDeltaBody | undefined,
): Record<string, string> {
  const out = { ...from };
  for (const p of delta?.del ?? []) delete out[p];
  for (const [p, content] of Object.entries(delta?.set ?? {})) out[p] = putBlob(siteDir, content);
  return out;
}

function checkDelta(delta: unknown, isAllowedPath: (p: string) => boolean, label: string): string | null {
  if (delta === undefined) return null;
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return `${label} must be { set, del }.`;
  const d = delta as { set?: unknown; del?: unknown };
  if (d.set !== undefined && !isStringRecord(d.set)) return `${label}.set must map paths to file contents.`;
  if (d.del !== undefined && (!Array.isArray(d.del) || d.del.some((p) => typeof p !== 'string'))) {
    return `${label}.del must be a list of paths.`;
  }
  const paths = [...Object.keys((d.set as Record<string, string>) ?? {}), ...((d.del as string[]) ?? [])];
  for (const p of paths) {
    // Editor state (`_meta/`) is shared by every branch; it never belongs to one.
    if (p.startsWith('_meta/') || !isAllowedPath(p)) return `Path "${p}" cannot be part of a branch.`;
  }
  return null;
}

/**
 * Create or update a branch. The caller serialises writes per site (site
 * lock) and owns authorisation; this checks the revision, the id and every
 * path, stores the blobs and writes the record. Nothing is written on a
 * conflict or an invalid change.
 */
export function writeBranchRecord(
  siteDir: string,
  id: string,
  change: BranchChange,
  opts: { isAllowedPath: (p: string) => boolean; userId?: string | null; now?: number },
): WriteBranchResult {
  if (!isValidBranchId(id)) {
    return { kind: 'invalid', message: `Invalid branch id "${id}" — lowercase letters, digits and hyphens, 1–48 characters, and never "main".` };
  }
  for (const [label, delta] of [['base', change.base], ['files', change.files]] as const) {
    const problem = checkDelta(delta, opts.isAllowedPath, label);
    if (problem) return { kind: 'invalid', message: problem };
  }
  const meta = change.meta ?? {};
  if (meta.status !== undefined && !STATUSES.has(meta.status)) return { kind: 'invalid', message: `Unknown status "${meta.status}".` };
  if (meta.parentId !== undefined && meta.parentId !== null && meta.parentId !== MAIN_BRANCH_ID && !isValidBranchId(meta.parentId)) {
    return { kind: 'invalid', message: `Invalid parent "${meta.parentId}".` };
  }

  const existing = readBranchRecord(siteDir, id);
  if (existing ? change.baseRevision !== existing.revision : change.baseRevision !== null) {
    return { kind: 'conflict', revision: existing?.revision ?? 0 };
  }
  const now = opts.now ?? Date.now();
  const record: BranchRecord = {
    id,
    revision: (existing?.revision ?? 0) + 1,
    base: applyDelta(siteDir, existing?.base ?? {}, change.base),
    files: applyDelta(siteDir, existing?.files ?? {}, change.files),
    status: meta.status ?? existing?.status ?? 'clean',
    parentId: meta.parentId !== undefined ? meta.parentId : existing?.parentId ?? MAIN_BRANCH_ID,
    order: typeof meta.order === 'number' ? meta.order : existing?.order ?? 0,
    createdAt: existing?.createdAt ?? (typeof meta.createdAt === 'number' ? meta.createdAt : now),
    lastEditedAt: meta.lastEditedAt !== undefined ? meta.lastEditedAt : existing?.lastEditedAt ?? null,
    createdBy: existing?.createdBy ?? opts.userId ?? null,
    lease: existing?.lease ?? null,
  };
  writeAtomic(path.join(recordsDir(siteDir), `${id}.json`), JSON.stringify(record, null, 2) + '\n');
  return { kind: 'ok', record, created: !existing };
}

/** Set or clear a branch's lease (an agent holding the branch while it works). */
export function setBranchLease(siteDir: string, id: string, lease: BranchLease | null): BranchRecord | null {
  const record = readBranchRecord(siteDir, id);
  if (!record) return null;
  const next = { ...record, lease };
  writeAtomic(path.join(recordsDir(siteDir), `${id}.json`), JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** Remove a branch, then any blob no remaining branch references. */
export function deleteBranchRecord(siteDir: string, id: string): boolean {
  if (!isValidBranchId(id)) return false;
  const file = path.join(recordsDir(siteDir), `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  collectBlobs(siteDir);
  return true;
}

function collectBlobs(siteDir: string): void {
  const dir = blobsDir(siteDir);
  if (!fs.existsSync(dir)) return;
  const referenced = new Set<string>();
  for (const r of listBranchRecords(siteDir)) {
    for (const h of Object.values(r.base)) referenced.add(h);
    for (const h of Object.values(r.files)) referenced.add(h);
  }
  for (const name of fs.readdirSync(dir)) {
    if (/^[0-9a-f]{64}$/.test(name) && !referenced.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

// ─── Migration from envelope branches ─────────────────────────────────────

function withoutShared(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, v] of Object.entries(map)) if (!p.startsWith('_meta/')) out[p] = v;
  return out;
}

function applyEnvelopeDelta(from: Record<string, string>, delta: unknown): Record<string, string> | null {
  if (!delta || typeof delta !== 'object') return null;
  const d = delta as { set?: unknown; del?: unknown };
  if (!d.set || typeof d.set !== 'object' || !Array.isArray(d.del)) return null;
  const out = { ...from };
  for (const p of d.del) if (typeof p === 'string') delete out[p];
  for (const [p, v] of Object.entries(d.set as Record<string, unknown>)) if (typeof v === 'string') out[p] = v;
  return out;
}

/**
 * Branches saved by an older editor inside `project-meta.json` (envelope v2:
 * deltas against the main saved with them, or legacy full copies) become
 * records. `mainFiles` is main as saved on disk. Returns the ids migrated;
 * the caller then drops `branches` from the metadata. Malformed entries are
 * skipped, never thrown.
 */
export function migrateEnvelopeBranches(
  siteDir: string,
  rawBranches: unknown,
  mainFiles: Record<string, string>,
  isAllowedPath: (p: string) => boolean,
): string[] {
  if (!rawBranches || typeof rawBranches !== 'object') return [];
  const main = withoutShared(mainFiles);
  const migrated: string[] = [];
  let order = 0;
  for (const [id, raw] of Object.entries(rawBranches as Record<string, unknown>)) {
    if (!isValidBranchId(id) || !raw || typeof raw !== 'object' || readBranchRecord(siteDir, id)) continue;
    const rec = raw as Record<string, unknown>;
    let base: Record<string, string> | null;
    let files: Record<string, string> | null;
    if (rec.baseDelta !== undefined || rec.filesDelta !== undefined) {
      base = applyEnvelopeDelta(main, rec.baseDelta);
      files = base ? applyEnvelopeDelta(base, rec.filesDelta) : null;
    } else {
      base = isStringRecord(rec.baseSnapshot) ? withoutShared(rec.baseSnapshot) : null;
      files = isStringRecord(rec.files) ? withoutShared(rec.files) : null;
    }
    if (!base || !files) continue;
    const keep = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([p]) => isAllowedPath(p)));
    const result = writeBranchRecord(siteDir, id, {
      baseRevision: null,
      base: { set: keep(base) },
      files: { set: keep(files) },
      meta: {
        status: STATUSES.has(String(rec.status)) ? (rec.status as BranchStatus) : 'dirty',
        parentId: typeof rec.parentId === 'string' ? rec.parentId : MAIN_BRANCH_ID,
        order: typeof rec.order === 'number' ? rec.order : order,
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
        lastEditedAt: typeof rec.lastEditedAt === 'number' ? rec.lastEditedAt : null,
      },
    }, { isAllowedPath });
    if (result.kind === 'ok') migrated.push(id);
    order++;
  }
  return migrated;
}
