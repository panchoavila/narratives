// db.ts — SQLite store for the self-hosted server (built-in `node:sqlite`, no
// native module). Holds identity and access only: users, sessions, one-time
// sign-in tokens, sites (owner, save revision, owner colour) and per-site
// members. Project files stay on disk under `sites/<id>/`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { trace } from './trace';

export type MemberRole = 'editor' | 'viewer';
export type SiteRole = 'owner' | MemberRole;

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface SiteRow {
  id: string;
  owner_id: string;
  revision: number;
  owner_color: string;
  created_at: string;
}

export interface MemberRow {
  site_id: string;
  user_id: string;
  role: MemberRole;
  color: string;
  invited_at: string;
  email: string;
  name: string | null;
  last_login_at: string | null;
}

/** Collaborator colours, assigned in order to a site's new members. */
export const MEMBER_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#ec4899', '#eab308', '#14b8a6', '#a855f7', '#ef4444'];
export const OWNER_COLOR = '#8b5cf6';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  return_to TEXT
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  revision INTEGER NOT NULL DEFAULT 0,
  owner_color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  color TEXT NOT NULL,
  invited_at TEXT NOT NULL,
  PRIMARY KEY (site_id, user_id)
);
`;

const now = () => new Date().toISOString();

export class Db {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    trace.action('db:open', { file });
  }

  close(): void {
    this.db.close();
  }

  // ─── Users ────────────────────────────────────────────────────────────

  getUserByEmail(email: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined) ?? null;
  }

  getUserById(id: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
  }

  ensureUser(email: string): UserRow {
    const normalized = email.trim().toLowerCase();
    const existing = this.getUserByEmail(normalized);
    if (existing) return existing;
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, NULL, ?)').run(id, normalized, now());
    trace.action('db:user-created', { id, email: normalized });
    return this.getUserById(id)!;
  }

  markLogin(userId: string): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
  }

  // ─── Sessions ─────────────────────────────────────────────────────────

  createSession(tokenHash: string, userId: string, ttlMs: number): void {
    const created = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, new Date(created).toISOString(), new Date(created + ttlMs).toISOString());
  }

  getSessionUser(tokenHash: string): UserRow | null {
    const row = this.db
      .prepare(
        `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(tokenHash, now()) as UserRow | undefined;
    return row ?? null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  // ─── One-time sign-in tokens ──────────────────────────────────────────

  createLoginToken(tokenHash: string, email: string, ttlMs: number, returnTo: string): void {
    this.db
      .prepare('INSERT INTO login_tokens (token_hash, email, expires_at, return_to) VALUES (?, ?, ?, ?)')
      .run(tokenHash, email, new Date(Date.now() + ttlMs).toISOString(), returnTo);
  }

  /** Marks the token used and returns it — exactly once, and only before it expires. */
  consumeLoginToken(tokenHash: string): { email: string; returnTo: string } | null {
    const stamp = now();
    const result = this.db
      .prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .run(stamp, tokenHash, stamp);
    if (Number(result.changes) !== 1) return null;
    const row = this.db.prepare('SELECT email, return_to FROM login_tokens WHERE token_hash = ?').get(tokenHash) as
      | { email: string; return_to: string | null }
      | undefined;
    return row ? { email: row.email, returnTo: row.return_to ?? '/dashboard' } : null;
  }

  /** Is this token still usable? (Shown on the confirm page before it is consumed.) */
  loginTokenUsable(tokenHash: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(tokenHash, now());
    return !!row;
  }

  purgeExpired(): void {
    const stamp = now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(stamp);
    this.db.prepare('DELETE FROM login_tokens WHERE expires_at <= ?').run(stamp);
  }

  // ─── Sites ────────────────────────────────────────────────────────────

  ensureSite(id: string, ownerId: string): SiteRow {
    this.db
      .prepare('INSERT OR IGNORE INTO sites (id, owner_id, revision, owner_color, created_at) VALUES (?, ?, 0, ?, ?)')
      .run(id, ownerId, OWNER_COLOR, now());
    return this.getSite(id)!;
  }

  getSite(id: string): SiteRow | null {
    return (this.db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as SiteRow | undefined) ?? null;
  }

  bumpRevision(id: string): number {
    this.db.prepare('UPDATE sites SET revision = revision + 1 WHERE id = ?').run(id);
    return this.getSite(id)!.revision;
  }

  setOwnerColor(id: string, color: string): void {
    this.db.prepare('UPDATE sites SET owner_color = ? WHERE id = ?').run(color, id);
  }

  // ─── Members ──────────────────────────────────────────────────────────

  getMember(siteId: string, userId: string): MemberRow | null {
    return (
      (this.db
        .prepare(
          `SELECT members.*, users.email, users.name, users.last_login_at FROM members
           JOIN users ON users.id = members.user_id WHERE members.site_id = ? AND members.user_id = ?`,
        )
        .get(siteId, userId) as MemberRow | undefined) ?? null
    );
  }

  listMembers(siteId: string): MemberRow[] {
    return this.db
      .prepare(
        `SELECT members.*, users.email, users.name, users.last_login_at FROM members
         JOIN users ON users.id = members.user_id WHERE members.site_id = ? ORDER BY members.invited_at`,
      )
      .all(siteId) as unknown as MemberRow[];
  }

  siteIdsForUser(userId: string): string[] {
    return (this.db.prepare('SELECT site_id FROM members WHERE user_id = ?').all(userId) as Array<{ site_id: string }>).map(
      (r) => r.site_id,
    );
  }

  hasAnyMembership(userId: string): boolean {
    return !!this.db.prepare('SELECT 1 AS ok FROM members WHERE user_id = ? LIMIT 1').get(userId);
  }

  /** Adds the member with the first colour the site does not use yet; an existing member keeps its colour. */
  upsertMember(siteId: string, userId: string, role: MemberRole): MemberRow {
    const existing = this.getMember(siteId, userId);
    if (existing) {
      this.db.prepare('UPDATE members SET role = ? WHERE site_id = ? AND user_id = ?').run(role, siteId, userId);
    } else {
      const used = new Set(this.listMembers(siteId).map((m) => m.color));
      const color = MEMBER_COLORS.find((c) => !used.has(c)) ?? MEMBER_COLORS[used.size % MEMBER_COLORS.length];
      this.db
        .prepare('INSERT INTO members (site_id, user_id, role, color, invited_at) VALUES (?, ?, ?, ?, ?)')
        .run(siteId, userId, role, color, now());
    }
    return this.getMember(siteId, userId)!;
  }

  updateMember(siteId: string, userId: string, patch: { role?: MemberRole; color?: string }): boolean {
    if (!this.getMember(siteId, userId)) return false;
    if (patch.role) this.db.prepare('UPDATE members SET role = ? WHERE site_id = ? AND user_id = ?').run(patch.role, siteId, userId);
    if (patch.color) this.db.prepare('UPDATE members SET color = ? WHERE site_id = ? AND user_id = ?').run(patch.color, siteId, userId);
    return true;
  }

  removeMember(siteId: string, userId: string): boolean {
    const result = this.db.prepare('DELETE FROM members WHERE site_id = ? AND user_id = ?').run(siteId, userId);
    return Number(result.changes) === 1;
  }
}
