// branch-sync.ts — keeps the editor's branches equal to the server's records.
//
// On the sites backend (the local Vite plugin and the self-hosted server) a
// branch is a record of its own with its own revision (server side:
// src/server/branch-records.ts), not part of the save envelope. This module:
//   · loads every record into ProjectFS when the project opens;
//   · saves each branch the editor changes (ProjectFS branch change feed),
//     debounced, as deltas against the last state both sides agreed on, naming
//     that revision — a stale save gets 409 and is merged, never forced;
//   · applies records other people or agents changed (`branch-updated` /
//     `branch-deleted` from the live room, and the revisions in its join ack);
//   · flushes pending saves when the tab closes.
// The envelope then carries main only (autosave.ts), so no save of main can
// erase a branch (briefs/22-11-2026-branch-review-workflow.md, D2).

import { toast } from 'sonner';
import { projectFS, projectVersionAtom, MAIN_BRANCH_ID, type BranchRecordData } from '@/code/project/project-fs';
import { setServerBranchSyncActive } from './branch-sync-flag';
import { mergeFile } from '@/code/branching/merge';
import { switchBranchFile } from '@/code/branching/switch-workspace';
import { flushNow, getCurrentCode, getQueueActiveFilePath, setForceRender, syncQueueCode } from '@/code/mutation/mutation-queue';
import { bumpProjectVersion } from '@/code/project/modify-file';
import { clearBridgeReadCaches } from '@/canvas/canvas-bridge';
import { getDefaultStore } from 'jotai';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { trace } from '@/shared/debug-trace';

const SAVE_DEBOUNCE_MS = 400;

type Meta = Omit<BranchRecordData, 'files' | 'base'>;

interface Known {
  revision: number;
  base: Map<string, string>;
  files: Map<string, string>;
  meta: Meta;
}

interface Lease {
  holder: string;
  until: number;
}

interface ServerBranch extends Meta {
  id: string;
  revision: number;
  base: Record<string, string>;
  files: Record<string, string>;
  lease?: Lease | null;
}

let siteId: string | null = null;
const known = new Map<string, Known>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();
const again = new Set<string>();
/** Remote revisions announced while our own save of that branch was in flight. */
const remoteWhileSaving = new Map<string, number>();
/** Agents holding a branch while they work (server lease). */
const leases = new Map<string, Lease>();
let unsubscribeFeed: (() => void) | null = null;
let unloadHandler: (() => void) | null = null;


function url(branch?: string): string {
  const base = `/api/sites/${encodeURIComponent(siteId ?? '')}/branches`;
  return branch === undefined ? base : `${base}/${encodeURIComponent(branch)}`;
}

function toMap(record: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(record));
}

function delta(from: Map<string, string>, to: Map<string, string>): { set: Record<string, string>; del: string[] } {
  const set: Record<string, string> = {};
  const del: string[] = [];
  for (const [p, v] of to) if (from.get(p) !== v) set[p] = v;
  for (const p of from.keys()) if (!to.has(p)) del.push(p);
  return { set, del };
}

const emptyDelta = (d: { set: Record<string, string>; del: string[] }) => Object.keys(d.set).length === 0 && d.del.length === 0;
const sameMeta = (a: Meta, b: Meta) =>
  a.status === b.status && a.parentId === b.parentId && a.order === b.order && a.lastEditedAt === b.lastEditedAt;

function errorText(payload: unknown, status: number): string {
  const p = payload as { error?: string | { message?: string } } | null;
  const message = typeof p?.error === 'string' ? p.error : p?.error?.message;
  return message || `HTTP ${status}`;
}

function revisionOf409(payload: unknown): number | null {
  const p = payload as { revision?: unknown; error?: { details?: { revision?: unknown } } } | null;
  const r = p?.error?.details?.revision ?? p?.revision;
  return typeof r === 'number' ? r : null;
}

async function fetchBranch(id: string): Promise<ServerBranch | null> {
  const res = await fetch(url(id), { credentials: 'same-origin' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET branch ${id}: HTTP ${res.status}`);
  return (await res.json()) as ServerBranch;
}

/** Panels derive the branch list from the project version (branch-store.ts). */
function pulse(): void {
  getDefaultStore().set(projectVersionAtom, (v: number) => v + 1);
}

/** Re-render when the branch on screen was replaced underneath the canvas. */
function refreshIfActive(id: string): void {
  if (projectFS.getActiveBranchId() !== id) return;
  const activeFile = getDefaultStore().get(activeFilePathAtom);
  const code = activeFile ? projectFS.readFile(activeFile) : null;
  if (code !== null) syncQueueCode(code);
  setForceRender();
  clearBridgeReadCaches();
  bumpProjectVersion();
}

function applyServer(server: ServerBranch): void {
  const rec: BranchRecordData = {
    files: toMap(server.files),
    base: toMap(server.base),
    status: server.status,
    parentId: server.parentId,
    order: server.order,
    createdAt: server.createdAt,
    lastEditedAt: server.lastEditedAt,
  };
  const refusal = projectFS.syncBranchRecord(server.id, rec);
  if (refusal) {
    trace.error('branch-sync:apply-refused', { branch: server.id, refusal });
    return;
  }
  known.set(server.id, { revision: server.revision, base: rec.base, files: rec.files, meta: projectFS.readBranchMeta(server.id)! });
  if (server.lease) leases.set(server.id, server.lease);
  else leases.delete(server.id);
  pulse();
  refreshIfActive(server.id);
}

function removeLocally(id: string, why: string): void {
  if (projectFS.getActiveBranchId() === id) {
    const refusal = switchBranchFile(MAIN_BRANCH_ID);
    if (refusal) {
      trace.error('branch-sync:leave-removed-branch-refused', { branch: id, refusal });
      return;
    }
    toast(`Branch "${id}" was deleted — you are back on main.`);
  }
  projectFS.syncBranchRecord(id, null);
  known.delete(id);
  leases.delete(id);
  pulse();
  trace.action('branch-sync:removed', { branch: id, why });
}

/** Does this tab hold edits of `id` the server has not stored yet? */
function hasLocalEdits(id: string): boolean {
  const k = known.get(id);
  const files = projectFS.readBranchFiles(id);
  const base = projectFS.readBranchBase(id);
  const meta = projectFS.readBranchMeta(id);
  if (!files || !base || !meta) return false;
  if (!k) return true;
  return !emptyDelta(delta(k.files, files)) || !emptyDelta(delta(k.base, base)) || !sameMeta(k.meta, meta);
}

/**
 * Another writer stored `server` while this tab has unsaved edits of the same
 * branch: 3-way merge each file (base = the last state both sides agreed on),
 * keep the result locally, then save it on the server's revision.
 * Where one region was changed both ways, this tab's version — the one on the
 * user's screen — is kept and the overwritten files are reported.
 */
function mergeInto(id: string, server: ServerBranch): void {
  const k = known.get(id);
  const local = projectFS.readBranchFiles(id) ?? new Map<string, string>();
  const ancestor = k?.files ?? new Map<string, string>();
  const theirs = toMap(server.files);
  const merged = new Map<string, string>();
  const overwritten: string[] = [];
  for (const p of new Set([...ancestor.keys(), ...local.keys(), ...theirs.keys()])) {
    const result = mergeFile(ancestor.get(p) ?? null, local.get(p) ?? null, theirs.get(p) ?? null, { path: p });
    if (result.status === 'clean') {
      if (result.merged !== null) merged.set(p, result.merged);
    } else {
      overwritten.push(p);
      const ours = local.get(p);
      if (ours !== undefined) merged.set(p, ours);
    }
  }
  const meta = projectFS.readBranchMeta(id);
  const localBase = projectFS.readBranchBase(id) ?? toMap(server.base);
  projectFS.syncBranchRecord(id, {
    files: merged,
    // A rebase on either side moves the base; the server's wins unless only we moved it.
    base: k && emptyDelta(delta(k.base, localBase)) ? toMap(server.base) : localBase,
    status: meta?.status ?? server.status,
    parentId: server.parentId,
    order: server.order,
    createdAt: server.createdAt,
    lastEditedAt: Date.now(),
  });
  // The merge is based on the server's copy now; what differs from it is ours to save.
  known.set(id, { revision: server.revision, base: toMap(server.base), files: theirs, meta: { status: server.status, parentId: server.parentId, order: server.order, createdAt: server.createdAt, lastEditedAt: server.lastEditedAt } });
  pulse();
  refreshIfActive(id);
  trace.action('branch-sync:merged', { branch: id, revision: server.revision, overwritten });
  if (overwritten.length > 0) {
    toast(`Branch "${id}" also changed elsewhere. Your version was kept in ${overwritten.join(', ')}.`);
  }
  schedule(id);
}

async function push(id: string): Promise<void> {
  if (!siteId) return;
  if (inflight.has(id)) {
    again.add(id);
    return;
  }
  inflight.add(id);
  try {
    const files = projectFS.readBranchFiles(id);
    const k = known.get(id);
    if (!files) {
      if (!k) return;
      const res = await fetch(url(id), { method: 'DELETE', credentials: 'same-origin' });
      if (res.ok || res.status === 404) known.delete(id);
      else trace.error('branch-sync:delete-failed', { branch: id, status: res.status });
      return;
    }
    const base = projectFS.readBranchBase(id)!;
    const meta = projectFS.readBranchMeta(id)!;
    let body: object;
    if (k) {
      const baseDelta = delta(k.base, base);
      const filesDelta = delta(k.files, files);
      if (emptyDelta(baseDelta) && emptyDelta(filesDelta) && sameMeta(k.meta, meta)) return;
      body = { baseRevision: k.revision, base: baseDelta, files: filesDelta, meta };
    } else {
      body = { baseRevision: null, base: { set: Object.fromEntries(base) }, files: { set: Object.fromEntries(files) }, meta };
    }
    const res = await fetch(url(id), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (res.ok) {
      const revision = (payload as { revision?: number } | null)?.revision ?? (k?.revision ?? 0) + 1;
      known.set(id, { revision, base, files, meta });
      trace.action('branch-sync:saved', { branch: id, revision });
      return;
    }
    if (res.status === 409) {
      trace.action('branch-sync:stale', { branch: id, mine: k?.revision ?? null, server: revisionOf409(payload) });
      const server = await fetchBranch(id);
      if (server) mergeInto(id, server);
      else {
        // Deleted on the server while we edited it: our copy recreates it.
        known.delete(id);
        schedule(id);
      }
      return;
    }
    trace.error('branch-sync:save-failed', { branch: id, status: res.status, error: errorText(payload, res.status) });
    toast.error(`Branch "${id}" could not be saved: ${errorText(payload, res.status)}`);
  } catch (err) {
    trace.error('branch-sync:save-threw', { branch: id, error: String(err) });
  } finally {
    inflight.delete(id);
    const announced = remoteWhileSaving.get(id);
    remoteWhileSaving.delete(id);
    if (again.delete(id)) schedule(id);
    else if (announced !== undefined && announced > (known.get(id)?.revision ?? 0)) void onRemoteBranchUpdated(id, announced);
  }
}

function schedule(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    void push(id);
  }, SAVE_DEBOUNCE_MS));
}

/** Closing the tab: send every pending branch save now (keepalive outlives the page). */
function flushOnUnload(): void {
  try {
    flushNow();
  } catch (err) {
    trace.error('branch-sync:unload-flush-queue-threw', { error: String(err) });
  }
  // The queue hands its code to ProjectFS asynchronously (a render callback),
  // so the latest edit of the file on screen may exist only in the queue:
  // take it from there for the branch on screen.
  const active = projectFS.getActiveBranchId();
  const queuePath = getQueueActiveFilePath();
  const queueCode = getCurrentCode();
  const onScreen = active !== MAIN_BRANCH_ID && queuePath && queueCode.trim() !== '' ? { path: queuePath, code: queueCode } : null;
  const ids = new Set(timers.keys());
  if (onScreen && projectFS.readBranchFiles(active)?.get(onScreen.path) !== onScreen.code) ids.add(active);
  for (const id of ids) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    const files = projectFS.readBranchFiles(id);
    const k = known.get(id);
    if (!files || !k) continue; // creates and deletes need a reply; they are rare at unload
    if (onScreen && id === active) files.set(onScreen.path, onScreen.code);
    const base = projectFS.readBranchBase(id)!;
    const meta = projectFS.readBranchMeta(id)!;
    void fetch(url(id), {
      method: 'PUT',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: k.revision, base: delta(k.base, base), files: delta(k.files, files), meta }),
    });
    trace.action('branch-sync:unload-flush', { branch: id });
  }
  timers.clear();
}

/** Start syncing `id`'s branches: load every record, then follow edits. */
export async function startServerBranchSync(id: string): Promise<void> {
  stopServerBranchSync();
  siteId = id;
  setServerBranchSyncActive(true);
  try {
    const res = await fetch(url(), { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { branches } = (await res.json()) as { branches: { id: string }[] };
    for (const b of branches) {
      const server = await fetchBranch(b.id);
      if (server) applyServer(server);
    }
    trace.action('branch-sync:loaded', { site: id, branches: branches.length });
  } catch (err) {
    trace.error('branch-sync:load-failed', { site: id, error: String(err) });
  }
  unsubscribeFeed = projectFS.subscribeBranchChanges((e) => schedule(e.id));
  unloadHandler = flushOnUnload;
  window.addEventListener('pagehide', unloadHandler);
}

export function stopServerBranchSync(): void {
  unsubscribeFeed?.();
  unsubscribeFeed = null;
  if (unloadHandler) window.removeEventListener('pagehide', unloadHandler);
  unloadHandler = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  known.clear();
  inflight.clear();
  again.clear();
  remoteWhileSaving.clear();
  leases.clear();
  siteId = null;
  setServerBranchSyncActive(false);
}

/** The room announced a newer revision of `branch` (another tab, person or agent). */
export async function onRemoteBranchUpdated(branch: string, revision: number): Promise<void> {
  if (!siteId) return;
  if (revision <= (known.get(branch)?.revision ?? 0)) return;
  if (inflight.has(branch)) {
    remoteWhileSaving.set(branch, Math.max(revision, remoteWhileSaving.get(branch) ?? 0));
    return;
  }
  try {
    const server = await fetchBranch(branch);
    if (!server) return removeLocally(branch, 'gone-on-fetch');
    if (hasLocalEdits(branch)) mergeInto(branch, server);
    else applyServer(server);
    trace.action('branch-sync:remote-applied', { branch, revision: server.revision });
  } catch (err) {
    trace.error('branch-sync:remote-fetch-failed', { branch, error: String(err) });
  }
}

/** The agent working on `branch`, while its lease is live; null otherwise. */
export function branchLease(branch: string): Lease | null {
  const lease = leases.get(branch);
  return lease && lease.until > Date.now() ? lease : null;
}

/** The room announced an agent took, renewed or released `branch`. */
export function onRemoteBranchLease(branch: string, lease: Lease | null): void {
  if (lease) leases.set(branch, lease);
  else leases.delete(branch);
  pulse();
}

/** The room announced `branch` was deleted. */
export function onRemoteBranchDeleted(branch: string): void {
  if (!siteId || !projectFS.readBranchFiles(branch)) return;
  removeLocally(branch, 'deleted-remotely');
}

/** Join ack: the server's branch revisions. Catch up on what changed while away. */
export function reconcileBranchRevisions(revisions: Record<string, number> | undefined): void {
  if (!siteId || !revisions) return;
  for (const [branch, revision] of Object.entries(revisions)) void onRemoteBranchUpdated(branch, revision);
  for (const branch of [...known.keys()]) {
    if (!(branch in revisions) && !hasLocalEdits(branch)) removeLocally(branch, 'missing-on-join');
  }
}
