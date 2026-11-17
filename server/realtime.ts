// realtime.ts — Socket.IO rooms for live co-editing, one room per site.
// Implements the protocol the editor's collaboration client speaks
// (src/canvas/collab/CollaborationProvider.tsx, file-sync-engine.ts):
//
//   join        → ack { ok, users, leader, revision, fileSeqs, adoptRevision },
//                 then the server replays EVERY live file of the room to the
//                 joiner (the client's apply is idempotent), so a late joiner
//                 or a reconnecting tab holds the room's content before it
//                 writes. A joiner whose copy predates the room (its
//                 `baseRevision` is older than the revision the room opened
//                 at) is answered `{ ok: false, reload: true }`: nothing in
//                 the room can bring that copy up to date.
//   file-sync   → accepted only on the current per-file sequence (baseSeq);
//                 ALWAYS acked, relayed to the rest of the room with the new
//                 seq. Writes from viewers are acked and dropped (a viewer's
//                 camera pan writes `_meta/page-camera.json`).
//   file-delete, interacting, cursor, selection → relayed, stamped with userId.
//   color-change → echoed to the whole room.
//   save-leader → lexicographically smallest user id among owner/editor members.
//   project-saved → after each save (REST) and each server-side flush.
//
// The room keeps every file written since it opened (`live`) and writes what
// differs from disk a few seconds after the last write (and when the room
// empties or the server stops), bumping the site revision.

import fs from 'node:fs';
import path from 'node:path';
import type { Server, Socket } from 'socket.io';
import type { ServerConfig } from './config';
import type { Db, SiteRole, UserRow } from './db';
import type { Access } from './access';
import type { Auth } from './auth';
import type { SiteLocks } from './site-locks';
import { isManagedProjectPath, walkManagedFiles } from '../src/server/sites-plugin';
import {
  cmsSlugFromDataPath,
  isCmsDataPath,
  parseSchemasFromFiles,
  validateCollectionItemsAgainstSchema,
} from '../src/shared/cms-site-contract';
import { trace } from './trace';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LIVE_FILES = 5_000;
/** Total characters held in one room's live map. */
const MAX_LIVE_BYTES = 200 * 1024 * 1024;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

interface RoomMember {
  socketId: string;
  user: UserRow;
  role: SiteRole;
}

interface LiveFile {
  seq: number;
  /** null = deleted */
  content: string | null;
  lastUserId: string;
}

interface Room {
  siteId: string;
  /** Site revision when the room opened; every content change since then is in `live`. */
  openedAt: number;
  members: Map<string, RoomMember>;
  live: Map<string, LiveFile>;
  liveBytes: number;
  leader: string | null;
  emptyTimer: NodeJS.Timeout | null;
  flushTimer: NodeJS.Timeout | null;
}

interface SocketData {
  user: UserRow;
  siteId?: string;
}

type Ack = (res: Record<string, unknown>) => void;

/** A relayed path must be a plain relative path. Paths outside the managed
 *  folders are relayed (the editor syncs whatever ProjectFS holds) but never
 *  written to disk. */
function safeRelPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (value.includes('\0') || value.includes('\\')) return null;
  const rel = value.replace(/^\/+/, '');
  if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null;
  return rel;
}

export class Realtime {
  private readonly rooms = new Map<string, Room>();
  private closing = false;

  constructor(
    private readonly io: Server,
    private readonly deps: { config: ServerConfig; db: Db; access: Access; auth: Auth; locks: SiteLocks },
  ) {
    io.use((socket, next) => {
      const req = socket.request;
      if (this.closing) {
        next(new Error('server restarting'));
        return;
      }
      if (!deps.access.originAllowed(req)) {
        trace.action('rt:handshake-refused', { reason: 'origin', origin: req.headers.origin });
        next(new Error('forbidden origin'));
        return;
      }
      const user = deps.auth.userFromCookieHeader(req.headers.cookie);
      if (!user) {
        trace.action('rt:handshake-refused', { reason: 'signed out' });
        next(new Error('unauthorized'));
        return;
      }
      (socket.data as SocketData).user = user;
      next();
    });
    io.on('connection', (socket) => this.onConnection(socket));
  }

  private key(siteId: string): string {
    return `site:${siteId}`;
  }

  private colorFor(siteId: string, member: RoomMember): string {
    if (member.role === 'owner') return this.deps.db.getSite(siteId)?.owner_color ?? '#8b5cf6';
    return this.deps.db.getMember(siteId, member.user.id)?.color ?? '#8b5cf6';
  }

  private activeUser(siteId: string, member: RoomMember) {
    return {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name ?? member.user.email.split('@')[0],
      avatar: null,
      role: member.role === 'viewer' ? ('viewer' as const) : ('editor' as const),
      color: this.colorFor(siteId, member),
      source: member.role === 'owner' ? ('owner' as const) : ('collaborator' as const),
      socketId: member.socketId,
    };
  }

  private computeLeader(room: Room): string | null {
    let leader: string | null = null;
    for (const m of room.members.values()) {
      if (!this.deps.access.canWrite(m.role)) continue;
      if (leader === null || m.user.id < leader) leader = m.user.id;
    }
    return leader;
  }

  private updateLeader(room: Room): void {
    const next = this.computeLeader(room);
    if (next === room.leader) return;
    room.leader = next;
    this.io.to(this.key(room.siteId)).emit('save-leader', { leader: next });
    trace.action('rt:leader', { siteId: room.siteId, leader: next });
  }

  /** The room and member for a socket that joined `websiteId`, else null. */
  private joined(socket: Socket, websiteId: unknown): { room: Room; member: RoomMember } | null {
    const data = socket.data as SocketData;
    if (typeof websiteId !== 'string' || data.siteId !== websiteId) return null;
    const room = this.rooms.get(websiteId);
    const member = room?.members.get(socket.id);
    return room && member ? { room, member } : null;
  }

  private readDisk(siteId: string, rel: string): string | null {
    const siteDir = path.join(this.deps.access.sitesRoot, siteId);
    const abs = path.join(siteDir, rel);
    if (!abs.startsWith(siteDir + path.sep)) return null;
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /** Run a socket handler; a throw is traced instead of escaping to the process. */
  private guard<T extends unknown[]>(event: string, fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      try {
        fn(...args);
      } catch (error) {
        trace.error(`rt:${event}`, error);
      }
    };
  }

  private onConnection(socket: Socket): void {
    const user = (socket.data as SocketData).user;
    trace.action('rt:connect', { socketId: socket.id, userId: user.id });

    socket.on('join', (payload: { websiteId?: unknown; baseRevision?: unknown }, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => {};
      try {
        this.join(socket, user, payload, reply);
      } catch (error) {
        reply({ ok: false, error: 'Join failed' });
        trace.error('rt:join', error);
      }
    });

    socket.on('file-sync', (payload: { websiteId?: unknown; path?: unknown; content?: unknown; baseSeq?: unknown }, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => {};
      try {
        this.fileSync(socket, user, payload, reply);
      } catch (error) {
        reply({ ok: false });
        trace.error('rt:file-sync', error);
      }
    });

    socket.on('file-delete', this.guard('file-delete', (payload: { websiteId?: unknown; path?: unknown }) => {
      if (this.closing) return;
      const ctx = this.joined(socket, payload?.websiteId);
      if (!ctx) return;
      const rawPath = payload.path;
      if (!this.deps.access.canWrite(ctx.member.role) || !safeRelPath(rawPath)) {
        trace.action('rt:file-delete-refused', { userId: user.id, role: ctx.member.role, path: rawPath });
        return;
      }
      if (this.deps.access.isCmsOnly(ctx.room.siteId)) {
        trace.action('rt:file-delete-refused', { userId: user.id, role: ctx.member.role, path: rawPath, reason: 'cms-only' });
        return;
      }
      const previous = ctx.room.live.get(rawPath as string);
      const seq = (previous?.seq ?? 0) + 1;
      ctx.room.liveBytes -= previous?.content?.length ?? 0;
      ctx.room.live.set(rawPath as string, { seq, content: null, lastUserId: user.id });
      socket.to(this.key(ctx.room.siteId)).emit('file-delete', { userId: user.id, path: rawPath, seq });
      this.scheduleFlush(ctx.room);
      trace.action('rt:file-delete', { siteId: ctx.room.siteId, userId: user.id, path: rawPath, seq });
    }));

    socket.on('interacting', this.guard('interacting', (payload: { websiteId?: unknown; nodeIds?: unknown; page?: unknown }) => {
      const ctx = this.joined(socket, payload?.websiteId);
      if (!ctx || !this.deps.access.canWrite(ctx.member.role)) return;
      socket.to(this.key(ctx.room.siteId)).emit('interacting', {
        userId: user.id,
        socketId: socket.id,
        nodeIds: Array.isArray(payload.nodeIds) ? payload.nodeIds.filter((id) => typeof id === 'string') : [],
        ...(typeof payload.page === 'string' ? { page: payload.page } : {}),
      });
    }));

    socket.on('cursor', this.guard('cursor', (payload: { websiteId?: unknown; x?: unknown; y?: unknown; page?: unknown }) => {
      const ctx = this.joined(socket, payload?.websiteId);
      if (!ctx || typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      socket.to(this.key(ctx.room.siteId)).emit('cursor', {
        userId: user.id,
        x: payload.x,
        y: payload.y,
        ...(typeof payload.page === 'string' ? { page: payload.page } : {}),
      });
    }));

    socket.on('selection', this.guard('selection', (payload: { websiteId?: unknown; nodeIds?: unknown; page?: unknown }) => {
      const ctx = this.joined(socket, payload?.websiteId);
      if (!ctx) return;
      socket.to(this.key(ctx.room.siteId)).emit('selection', {
        userId: user.id,
        nodeIds: Array.isArray(payload.nodeIds) ? payload.nodeIds.filter((id) => typeof id === 'string') : [],
        ...(typeof payload.page === 'string' ? { page: payload.page } : {}),
      });
    }));

    socket.on('color-change', this.guard('color-change', (payload: { websiteId?: unknown; userId?: unknown; color?: unknown }) => {
      const ctx = this.joined(socket, payload?.websiteId);
      if (!ctx || !this.deps.access.canWrite(ctx.member.role)) return;
      if (typeof payload.userId !== 'string' || typeof payload.color !== 'string' || !COLOR_RE.test(payload.color)) return;
      this.io.to(this.key(ctx.room.siteId)).emit('color-change', { userId: payload.userId, color: payload.color });
    }));

    socket.on('leave', this.guard('leave', () => this.leave(socket)));
    socket.on('disconnect', this.guard('disconnect', (reason: string) => {
      trace.action('rt:disconnect', { socketId: socket.id, userId: user.id, reason });
      this.leave(socket);
    }));
  }

  private join(socket: Socket, user: UserRow, payload: { websiteId?: unknown; baseRevision?: unknown }, reply: Ack): void {
    const siteId = typeof payload?.websiteId === 'string' ? payload.websiteId : '';
    const role = this.deps.access.roleFor(user, siteId);
    if (!role || this.closing) {
      trace.action('rt:join-refused', { socketId: socket.id, userId: user.id, siteId, reason: this.closing ? 'closing' : 'not a member' });
      reply({ ok: false, error: this.closing ? 'Server restarting' : 'You are not a member of this site.' });
      return;
    }
    const revision = this.deps.access.siteRow(siteId)?.revision ?? 0;
    const existing = this.rooms.get(siteId);
    const openedAt = existing?.openedAt ?? revision;
    const baseRevision = typeof payload.baseRevision === 'number' ? payload.baseRevision : null;
    if (baseRevision !== null && baseRevision < openedAt) {
      // The copy predates the room: changes saved before the room opened are
      // not in `live`, so no replay can bring it up to date. Reload instead.
      trace.action('rt:join-stale', { socketId: socket.id, userId: user.id, siteId, baseRevision, openedAt });
      reply({ ok: false, reload: true, error: 'This copy of the project is out of date.' });
      return;
    }

    if ((socket.data as SocketData).siteId) this.leave(socket);
    const room = existing ?? this.openRoom(siteId, revision);
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    const member: RoomMember = { socketId: socket.id, user, role };
    room.members.set(socket.id, member);
    void socket.join(this.key(siteId));
    (socket.data as SocketData).siteId = siteId;

    room.leader = this.computeLeader(room);
    reply({
      ok: true,
      users: [...room.members.values()].map((m) => this.activeUser(siteId, m)),
      leader: room.leader,
      revision,
      fileSeqs: Object.fromEntries([...room.live].map(([p, f]) => [p, f.seq])),
      // The replay below brings this copy to the room's content, which every
      // save since the room opened was taken from: the copy may adopt `revision`.
      adoptRevision: baseRevision !== null && baseRevision !== revision,
    });
    socket.to(this.key(siteId)).emit('user-joined', this.activeUser(siteId, member));
    this.io.to(this.key(siteId)).emit('save-leader', { leader: room.leader });
    trace.action('rt:joined', { socketId: socket.id, userId: user.id, siteId, role, members: room.members.size, leader: room.leader, baseRevision, revision });
    this.replay(socket, room);
  }

  private openRoom(siteId: string, revision: number): Room {
    const room: Room = {
      siteId,
      openedAt: revision,
      members: new Map(),
      live: new Map(),
      liveBytes: 0,
      leader: null,
      emptyTimer: null,
      flushTimer: null,
    };
    this.rooms.set(siteId, room);
    trace.action('rt:room-opened', { siteId, openedAt: revision });
    return room;
  }

  private fileSync(
    socket: Socket,
    user: UserRow,
    payload: { websiteId?: unknown; path?: unknown; content?: unknown; baseSeq?: unknown },
    reply: Ack,
  ): void {
    const ctx = this.joined(socket, payload?.websiteId);
    if (!ctx || this.closing) {
      reply({ ok: false });
      return;
    }
    const { room, member } = ctx;
    const rawPath = payload.path;
    const rel = safeRelPath(rawPath);
    const current = typeof rawPath === 'string' ? room.live.get(rawPath)?.seq ?? 0 : 0;
    if (!this.deps.access.canWrite(member.role)) {
      // Viewers write too (camera pans persist `_meta/page-camera.json`).
      // Ack so their copy stops resending; never store or relay it.
      reply({ ok: true, seq: current });
      trace.action('rt:file-sync-dropped', { userId: user.id, role: member.role, path: rawPath });
      return;
    }
    if (this.deps.access.isCmsOnly(room.siteId) && (!rel || !isCmsDataPath(rel))) {
      // On a `cmsOnly` site, only CMS item data (`cms/<slug>.json`) may be
      // edited on the server; camera pans (`_meta/page-camera.json`) and any
      // attempted design/schema writes are acked and dropped.
      reply({ ok: true, seq: current });
      trace.action('rt:file-sync-dropped', { userId: user.id, role: member.role, path: rawPath, reason: 'cms-only' });
      return;
    }
    const content = payload.content;
    const bytes = typeof content === 'string' ? Buffer.byteLength(content) : 0;
    const previous = typeof rawPath === 'string' ? room.live.get(rawPath) : undefined;
    const chars = typeof content === 'string' ? content.length : 0;
    const overLimit =
      bytes > MAX_FILE_BYTES ||
      (!previous && room.live.size >= MAX_LIVE_FILES) ||
      room.liveBytes - (previous?.content?.length ?? 0) + chars > MAX_LIVE_BYTES;
    if (!rel || typeof content !== 'string' || overLimit) {
      // The client resends while its copy differs from its base, so a refusal
      // it cannot fix ends with a disconnect: on reconnect it joins with its
      // own copy as the base and stops resending.
      reply({ ok: false, seq: current });
      trace.error('rt:file-sync-refused', { userId: user.id, path: rawPath, reason: !rel ? 'path' : typeof content !== 'string' ? 'content' : 'size', bytes });
      socket.disconnect(true);
      return;
    }
    if (typeof payload.baseSeq !== 'number' || payload.baseSeq !== current) {
      reply({ ok: false, seq: current });
      trace.action('rt:file-sync-stale', { userId: user.id, path: rawPath, baseSeq: payload.baseSeq, current });
      return;
    }
    const seq = current + 1;
    room.liveBytes += chars - (previous?.content?.length ?? 0);
    room.live.set(rawPath as string, { seq, content, lastUserId: user.id });
    reply({ ok: true, seq });
    socket.to(this.key(room.siteId)).emit('file-sync', { userId: user.id, path: rawPath, content, seq });
    this.scheduleFlush(room);
    trace.action('rt:file-sync', { siteId: room.siteId, userId: user.id, path: rawPath, seq, bytes });
  }

  /** After the join ack: send the joiner every live file of the room. */
  private replay(socket: Socket, room: Room): void {
    let sent = 0;
    for (const [rawPath, file] of room.live) {
      if (file.content === null) socket.emit('file-delete', { userId: file.lastUserId, path: rawPath, seq: file.seq });
      else socket.emit('file-sync', { userId: file.lastUserId, path: rawPath, content: file.content, seq: file.seq });
      sent += 1;
    }
    if (sent > 0) trace.action('rt:replay', { siteId: room.siteId, socketId: socket.id, files: sent });
  }

  private leave(socket: Socket): void {
    const data = socket.data as SocketData;
    const siteId = data.siteId;
    if (!siteId) return;
    data.siteId = undefined;
    const room = this.rooms.get(siteId);
    if (!room) return;
    const member = room.members.get(socket.id);
    room.members.delete(socket.id);
    void socket.leave(this.key(siteId));
    if (member) this.io.to(this.key(siteId)).emit('user-left', { socketId: socket.id, userId: member.user.id });
    this.updateLeader(room);
    trace.action('rt:left', { siteId, socketId: socket.id, members: room.members.size });
    if (room.members.size === 0) this.scheduleClose(room);
  }

  /** Write live edits to disk a few seconds after the last one. */
  private scheduleFlush(room: Room): void {
    if (room.flushTimer) clearTimeout(room.flushTimer);
    room.flushTimer = setTimeout(() => {
      room.flushTimer = null;
      this.persist(room, 'debounced').catch((error) => trace.error('rt:flush', error));
    }, this.deps.config.roomFlushMs);
    room.flushTimer.unref();
  }

  /** Empty room: after the grace period, write what is left and close it. */
  private scheduleClose(room: Room): void {
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    room.emptyTimer = setTimeout(() => {
      room.emptyTimer = null;
      if (room.members.size > 0) return;
      this.persist(room, 'room-empty')
        .then(() => {
          if (room.members.size === 0 && this.rooms.get(room.siteId) === room) this.dropRoom(room, 'empty');
        })
        .catch((error) => trace.error('rt:close', error));
    }, this.deps.config.roomGraceMs);
    room.emptyTimer.unref();
  }

  private dropRoom(room: Room, reason: string): void {
    if (room.flushTimer) clearTimeout(room.flushTimer);
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    room.flushTimer = null;
    room.emptyTimer = null;
    this.rooms.delete(room.siteId);
    trace.action('rt:room-closed', { siteId: room.siteId, reason });
  }

  /** Write the room's live files that differ from disk; bump the revision if anything changed. */
  private persist(room: Room, reason: string): Promise<number> {
    return this.deps.locks.run(room.siteId, () => {
      if (this.rooms.get(room.siteId) !== room || !this.deps.access.siteExists(room.siteId)) return 0;
      const siteDir = path.join(this.deps.access.sitesRoot, room.siteId);
      const cmsOnly = this.deps.access.isCmsOnly(room.siteId);
      const schemas = cmsOnly ? parseSchemasFromFiles(walkManagedFiles(siteDir)).schemas : null;
      let changed = 0;
      for (const [rawPath, file] of room.live) {
        const rel = safeRelPath(rawPath);
        if (!rel || !isManagedProjectPath(rel)) continue;
        if (cmsOnly && (!isCmsDataPath(rel) || file.content === null)) continue;
        if (file.content === this.readDisk(room.siteId, rel)) continue;
        if (cmsOnly && schemas && file.content !== null) {
          const slug = cmsSlugFromDataPath(rel);
          const schema = slug ? schemas.get(slug) : undefined;
          if (!schema) {
            trace.error('rt:persist-validation-failed', { siteId: room.siteId, path: rel, reason: 'missing-schema' });
            continue;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(file.content);
          } catch {
            trace.error('rt:persist-validation-failed', { siteId: room.siteId, path: rel, reason: 'invalid-json' });
            continue;
          }
          const issues = validateCollectionItemsAgainstSchema(slug!, schema, parsed);
          if (issues.length > 0) {
            trace.error('rt:persist-validation-failed', { siteId: room.siteId, path: rel, issues: issues.map((i) => i.code) });
            continue;
          }
        }
        const abs = path.join(siteDir, rel);
        try {
          if (file.content === null) {
            fs.rmSync(abs, { force: true });
          } else {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, file.content, 'utf8');
          }
          changed += 1;
        } catch (error) {
          trace.error('rt:persist-file', { siteId: room.siteId, path: rel, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (changed > 0) {
        const revision = this.deps.db.bumpRevision(room.siteId);
        // Members hold every relayed write, so their copies are this content.
        this.notifySaved(room.siteId, revision, true);
        trace.action('rt:persisted', { siteId: room.siteId, reason, files: changed, revision });
      }
      return changed;
    });
  }

  /** Flush any pending live CMS edits for `siteId` to disk before a design push or content pull. */
  async flushSite(siteId: string): Promise<number> {
    const room = this.rooms.get(siteId);
    if (!room) return 0;
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }
    return this.persist(room, 'explicit-flush');
  }

  /**
   * Broadcast a local `design:push` into an active room so connected editors
   * receive the updated views, components, and schemas live without losing
   * their CMS edits or hitting a revision conflict.
   */
  applyDesignPush(
    siteId: string,
    updatedFiles: Record<string, string>,
    deletedPaths: string[],
    revision: number,
    adminUserId: string,
  ): void {
    const room = this.rooms.get(siteId);
    if (!room) return;
    if (room.members.size === 0) {
      this.dropRoom(room, 'design-push');
      return;
    }
    for (const [relPath, content] of Object.entries(updatedFiles)) {
      const prev = room.live.get(relPath);
      const seq = (prev?.seq ?? 0) + 1;
      room.liveBytes += content.length - (prev?.content?.length ?? 0);
      room.live.set(relPath, { seq, content, lastUserId: adminUserId });
      this.io.to(this.key(siteId)).emit('file-sync', { userId: adminUserId, path: relPath, content, seq });
    }
    for (const delPath of deletedPaths) {
      const prev = room.live.get(delPath);
      const seq = (prev?.seq ?? 0) + 1;
      room.liveBytes -= prev?.content?.length ?? 0;
      room.live.set(delPath, { seq, content: null, lastUserId: adminUserId });
      this.io.to(this.key(siteId)).emit('file-delete', { userId: adminUserId, path: delPath, seq });
    }
    this.notifySaved(siteId, revision, true);
    trace.action('rt:design-pushed', {
      siteId,
      updated: Object.keys(updatedFiles).length,
      deleted: deletedPaths.length,
      revision,
    });
  }

  /** Broadcast a successful save to the site's room. */
  notifySaved(siteId: string, revision: number, inSync: boolean): void {
    this.io.to(this.key(siteId)).emit('project-saved', { revision, inSync });
  }

  /** A REST save landed while nobody is in the room (the saver's socket is
   *  down). The save is now the newest content: the room's live copy is older
   *  and must not be written back over it. */
  savedWithoutRoom(siteId: string): void {
    const room = this.rooms.get(siteId);
    if (room && room.members.size === 0) this.dropRoom(room, 'superseded by save');
  }

  /** A member was removed or changed role: refresh or drop their sockets. */
  refreshMember(siteId: string, userId: string): void {
    const room = this.rooms.get(siteId);
    if (!room) return;
    for (const member of [...room.members.values()]) {
      if (member.user.id !== userId) continue;
      const role = this.deps.access.roleFor(member.user, siteId);
      const socket = this.io.sockets.sockets.get(member.socketId);
      if (!role) {
        trace.action('rt:member-removed', { siteId, userId, socketId: member.socketId });
        if (socket) {
          this.leave(socket);
          socket.disconnect(true);
        } else {
          room.members.delete(member.socketId);
        }
      } else {
        member.role = role;
      }
    }
    this.updateLeader(room);
  }

  /** Signed out: close every socket of that user. */
  disconnectUser(userId: string): void {
    for (const socket of this.io.sockets.sockets.values()) {
      if ((socket.data as SocketData).user?.id !== userId) continue;
      this.leave(socket);
      socket.disconnect(true);
    }
  }

  /** Shutdown: refuse new writes, then write every room's pending live edits. */
  async close(reason: string): Promise<void> {
    this.closing = true;
    for (const room of [...this.rooms.values()]) {
      try {
        await this.persist(room, reason);
      } catch (error) {
        trace.error('rt:close-persist', { siteId: room.siteId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}
