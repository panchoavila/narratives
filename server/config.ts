// config.ts — Self-hosted collaboration server settings, read from the
// environment once at boot. Every value the server depends on is validated
// here so a misconfigured deploy fails on start, not on the first request.

import path from 'node:path';
import { trace } from './trace';

export interface ServerConfig {
  /** Holds `sites/`, `.revyme-local/` (publisher state), `packages/revyme-runtime-scene`
   *  and `.selfhosted/` (database, mail outbox). The plugin and publisher use it as their repo root. */
  rootDir: string;
  /** Editor build: `index.html` at the top, `sandbox/` and `preview-sandbox/` beside it. */
  distDir: string;
  /** `rootDir/.selfhosted` — database file and the `file` mail transport's outbox. */
  dataDir: string;
  host: string;
  portEditor: number;
  portSandbox: number;
  portPreview: number;
  /** Origin the editor is served from, e.g. `https://cms.example.com`. Used for
   *  magic links and to refuse cross-origin writes and socket handshakes. */
  publicOrigin: string;
  adminEmail: string;
  /** Optional Bearer token (`ADMIN_API_TOKEN`) for CLI `design:push` / `content:pull`, authenticating as the admin. */
  adminApiToken: string | null;
  /** How invitation mails name the admin ("Ana te invitó…"); falls back to the email. */
  adminName: string | null;
  mailTransport: 'file' | 'resend';
  resendApiKey: string | null;
  mailFrom: string;
  /** `Secure` session cookie: only when the public origin is HTTPS. */
  cookieSecure: boolean;
  /** How long an empty room waits before its live edits are written to disk. */
  roomGraceMs: number;
  /** Live edits are written to disk this long after the last one (crash safety). */
  roomFlushMs: number;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rootDir = path.resolve(env.ROOT_DIR ?? process.cwd());
  const distDir = path.resolve(env.DIST_DIR ?? path.join(rootDir, 'dist'));

  const publicOriginRaw = env.PUBLIC_ORIGIN;
  if (!publicOriginRaw) throw new Error('PUBLIC_ORIGIN is required (e.g. https://cms.example.com)');
  const publicUrl = new URL(publicOriginRaw);
  const publicOrigin = publicUrl.origin;

  const adminEmail = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!adminEmail || !adminEmail.includes('@')) throw new Error('ADMIN_EMAIL is required');
  const adminApiToken = env.ADMIN_API_TOKEN?.trim() || null;
  if (adminApiToken !== null && adminApiToken.length < 24) {
    throw new Error('ADMIN_API_TOKEN must be at least 24 characters when set');
  }

  const mailTransport = (env.MAIL_TRANSPORT ?? 'file') as ServerConfig['mailTransport'];
  if (mailTransport !== 'file' && mailTransport !== 'resend') {
    throw new Error(`MAIL_TRANSPORT must be "file" or "resend", got "${mailTransport}"`);
  }
  const resendApiKey = env.RESEND_API_KEY?.trim() || null;
  const mailFrom = env.MAIL_FROM?.trim() || '';
  if (mailTransport === 'resend' && (!resendApiKey || !mailFrom)) {
    throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM');
  }

  const config: ServerConfig = {
    rootDir,
    distDir,
    dataDir: path.join(rootDir, '.selfhosted'),
    host: env.HOST ?? '127.0.0.1',
    portEditor: int(env, 'PORT_EDITOR', 8090),
    portSandbox: int(env, 'PORT_SANDBOX', 8091),
    portPreview: int(env, 'PORT_PREVIEW', 8092),
    publicOrigin,
    adminEmail,
    adminApiToken,
    adminName: env.ADMIN_NAME?.trim() || null,
    mailTransport,
    resendApiKey,
    mailFrom: mailFrom || 'CMS <no-reply@localhost>',
    cookieSecure: publicUrl.protocol === 'https:',
    roomGraceMs: int(env, 'ROOM_GRACE_MS', 30_000),
    roomFlushMs: int(env, 'ROOM_FLUSH_MS', 5_000),
  };
  trace.action('config:loaded', {
    rootDir: config.rootDir,
    distDir: config.distDir,
    host: config.host,
    ports: [config.portEditor, config.portSandbox, config.portPreview],
    publicOrigin: config.publicOrigin,
    mailTransport: config.mailTransport,
    cookieSecure: config.cookieSecure,
    roomGraceMs: config.roomGraceMs,
    roomFlushMs: config.roomFlushMs,
  });
  return config;
}
