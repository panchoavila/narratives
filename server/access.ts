// access.ts — Who may do what on which site. One place answers "is this site
// real", "what is this user's role on it" and "which sites may they see", so
// the REST layer, the realtime rooms and the asset servers cannot disagree.
//
// The admin (ADMIN_EMAIL) owns every site. Everyone else reaches a site only
// through a membership row (editor or viewer).

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { SITE_ID_RE } from '../src/server/sites-plugin';
import type { Db, SiteRole, SiteRow, UserRow } from './db';
import type { ServerConfig } from './config';
import { trace } from './trace';

export class Access {
  readonly sitesRoot: string;

  constructor(private readonly db: Db, private readonly config: ServerConfig) {
    this.sitesRoot = path.join(config.rootDir, 'sites');
  }

  admin(): UserRow {
    return this.db.ensureUser(this.config.adminEmail);
  }

  isAdmin(user: UserRow | null): boolean {
    return !!user && user.email === this.config.adminEmail;
  }

  /** A site exists when its folder exists under `sites/` with a valid id. */
  siteExists(siteId: string): boolean {
    if (!SITE_ID_RE.test(siteId)) return false;
    const dir = path.join(this.sitesRoot, siteId);
    try {
      return fs.statSync(dir).isDirectory() && !fs.lstatSync(dir).isSymbolicLink();
    } catch {
      return false;
    }
  }

  /** The site's row, registered on first sight (sites created on disk by the
   *  plugin's `POST /api/sites`, or copied in by a migration). */
  siteRow(siteId: string): SiteRow | null {
    if (!this.siteExists(siteId)) return null;
    return this.db.getSite(siteId) ?? this.db.ensureSite(siteId, this.admin().id);
  }

  /** Register every site folder on disk. Run at boot. */
  syncFromDisk(): void {
    if (!fs.existsSync(this.sitesRoot)) {
      fs.mkdirSync(this.sitesRoot, { recursive: true });
      return;
    }
    const registered: string[] = [];
    for (const entry of fs.readdirSync(this.sitesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SITE_ID_RE.test(entry.name)) continue;
      if (!this.db.getSite(entry.name)) registered.push(entry.name);
      this.siteRow(entry.name);
    }
    trace.action('access:sync-from-disk', { registered });
  }

  roleFor(user: UserRow | null, siteId: string): SiteRole | null {
    if (!user || !this.siteRow(siteId)) return null;
    if (this.isAdmin(user)) return 'owner';
    return this.db.getMember(siteId, user.id)?.role ?? null;
  }

  canWrite(role: SiteRole | null): boolean {
    return role === 'owner' || role === 'editor';
  }

  /** Site ids this user may see; `null` = all (admin). */
  permittedSites(user: UserRow): Set<string> | null {
    if (this.isAdmin(user)) return null;
    return new Set(this.db.siteIdsForUser(user.id));
  }

  /** May this user sign in at all? The admin, or anyone invited to a site. */
  maySignIn(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    if (normalized === this.config.adminEmail) return true;
    const user = this.db.getUserByEmail(normalized);
    return !!user && this.db.hasAnyMembership(user.id);
  }

  /** Same-origin check for writes and socket handshakes. A browser always sends
   *  `Origin` on cross-site writes, so an absent header is a same-origin or
   *  non-browser client (which still needs the session cookie). */
  originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return origin === undefined || origin === this.config.publicOrigin;
  }
}
