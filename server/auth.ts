// auth.ts — Magic-link sign-in and cookie sessions.
//
//   GET  /auth                 sign-in page (email form)
//   POST /auth/request         { email, returnTo } → mails a one-time link
//   GET  /auth/verify?token=   confirm page; a button POSTs the token. Mail
//                              scanners that prefetch links only GET, so they
//                              cannot burn the single-use token.
//   POST /auth/verify          consumes the token, opens a session, redirects
//   POST /auth/logout          ends the session
//   GET  /api/auth/session     { user } for the editor (null when signed out)
//
// Only the admin and people invited to at least one site receive a link; the
// response is identical either way so the form does not reveal who is invited.

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from './config';
import type { Db, UserRow } from './db';
import type { Mailer } from './mail';
import type { Access } from './access';
import {
  HttpError,
  escapeHtml,
  parseCookies,
  pathnameOf,
  queryOf,
  randomToken,
  readBody,
  redirect,
  safeReturnTo,
  sendFailure,
  sendHtml,
  sendJson,
  serializeCookie,
  sha256,
} from './http';
import { trace } from './trace';

/** How the instance names itself in pages and mail (the owner's brand; "Revyme" is a trademark). */
const BRAND = 'REAL es TODO';

export const SESSION_COOKIE = 'sh_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_PER_EMAIL = 5;
const RATE_PER_IP = 20;

export class Auth {
  private readonly attempts = new Map<string, number[]>();
  /** Set by the server: close a user's live sockets when they sign out. */
  onLogout: ((userId: string) => void) | null = null;

  constructor(
    private readonly config: ServerConfig,
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly access: Access,
  ) {}

  /** The signed-in user for a raw `Cookie` header (HTTP requests and socket handshakes). */
  userFromCookieHeader(header: string | undefined): UserRow | null {
    const token = parseCookies(header)[SESSION_COOKIE];
    if (!token) return null;
    return this.db.getSessionUser(sha256(token));
  }

  userFor(req: IncomingMessage): UserRow | null {
    const cookieUser = this.userFromCookieHeader(req.headers.cookie);
    if (cookieUser) return cookieUser;
    if (this.config.adminApiToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const provided = authHeader.slice('Bearer '.length).trim();
        if (provided.length > 0) {
          const expectedBuf = Buffer.from(sha256(this.config.adminApiToken), 'utf8');
          const actualBuf = Buffer.from(sha256(provided), 'utf8');
          if (expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf)) {
            return this.access.admin();
          }
        }
      }
    }
    return null;
  }

  sessionPayload(user: UserRow | null) {
    if (!user) return { user: null };
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? user.email.split('@')[0],
        image: null,
        isAdmin: this.access.isAdmin(user),
      },
    };
  }

  /** Handles `/auth*` and `/api/auth/session`; returns false for any other path. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const pathname = pathnameOf(req);
    try {
      if (pathname === '/api/auth/session' && req.method === 'GET') {
        sendJson(res, 200, this.sessionPayload(this.userFor(req)));
        return true;
      }
      if (pathname === '/auth' && req.method === 'GET') {
        sendHtml(res, 200, signInPage(safeReturnTo(queryOf(req).get('returnTo'))));
        return true;
      }
      if (pathname === '/auth/request' && req.method === 'POST') {
        await this.request(req, res);
        return true;
      }
      if (pathname === '/auth/verify' && req.method === 'GET') {
        const token = queryOf(req).get('token') ?? '';
        const usable = token.length > 0 && this.db.loginTokenUsable(sha256(token));
        sendHtml(res, usable ? 200 : 410, usable ? confirmPage(token) : expiredPage());
        return true;
      }
      if (pathname === '/auth/verify' && req.method === 'POST') {
        await this.verify(req, res);
        return true;
      }
      if (pathname === '/auth/logout' && req.method === 'POST') {
        if (!this.access.originAllowed(req)) throw new HttpError(403, 'Cross-origin request refused');
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (token) {
          const user = this.db.getSessionUser(sha256(token));
          this.db.deleteSession(sha256(token));
          if (user) this.onLogout?.(user.id);
        }
        res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: this.config.cookieSecure }));
        trace.action('auth:logout', {});
        redirect(res, '/auth');
        return true;
      }
    } catch (error) {
      sendFailure(res, error, 'auth:handle');
      return true;
    }
    return false;
  }

  /** Sliding window. A refused attempt is not counted, so the limit lifts
   *  RATE_WINDOW_MS after the last accepted one even if someone keeps trying. */
  private rateLimited(key: string, limit: number): boolean {
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= limit) {
      this.attempts.set(key, recent);
      return true;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) {
      for (const [k, times] of this.attempts) {
        if (times.every((t) => now - t >= RATE_WINDOW_MS)) this.attempts.delete(k);
      }
    }
    return false;
  }

  /** The client address. Behind Caddy every request comes from loopback, so
   *  the forwarded address is used then (and only then: a direct client
   *  could forge the header). */
  private clientIp(req: IncomingMessage): string {
    const peer = req.socket.remoteAddress ?? 'unknown';
    const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    const forwarded = req.headers['x-forwarded-for'];
    if (loopback && typeof forwarded === 'string' && forwarded.trim()) {
      const parts = forwarded.split(',');
      return parts[parts.length - 1]!.trim();
    }
    return peer;
  }

  private async request(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.access.originAllowed(req)) throw new HttpError(403, 'Cross-origin request refused');
    const raw = (await readBody(req, 16 * 1024)).toString('utf8');
    const form = (req.headers['content-type'] ?? '').includes('application/json')
      ? (JSON.parse(raw || '{}') as { email?: unknown; returnTo?: unknown })
      : Object.fromEntries(new URLSearchParams(raw));
    const email = typeof form.email === 'string' ? form.email.trim().toLowerCase() : '';
    const returnTo = safeReturnTo(form.returnTo);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'A ese correo le falta algo. Revisa que se vea así: nombre@correo.com');

    const ip = this.clientIp(req);
    if (this.rateLimited(`ip:${ip}`, RATE_PER_IP) || this.rateLimited(`email:${email}`, RATE_PER_EMAIL)) {
      trace.action('auth:rate-limited', { email, ip });
      throw new HttpError(429, 'Pediste varios enlaces seguidos. Espera unos minutos y vuelve a intentarlo.');
    }

    // Answer first, mail afterwards: the reply is identical and immediate
    // whether or not the address is invited (failure mode 3).
    sendJson(res, 200, { ok: true });
    if (!this.access.maySignIn(email)) {
      trace.action('auth:link-not-sent', { email, reason: 'not invited' });
      return;
    }
    const token = randomToken();
    this.db.createLoginToken(sha256(token), email, LOGIN_TOKEN_TTL_MS, returnTo);
    const link = `${this.config.publicOrigin}/auth/verify?token=${encodeURIComponent(token)}`;
    this.mailer
      .send({
        to: email,
        subject: 'Tu enlace para ingresar',
        text: `Usa este enlace para ingresar. Funciona una sola vez durante los próximos 15 minutos.\n\n${link}\n\n¿No pediste este enlace? Ignora este correo: sin él nadie puede ingresar a tu cuenta.`,
        html: `<p>Usa este enlace para ingresar. Funciona una sola vez durante los próximos 15 minutos.</p><p><a href="${escapeHtml(link)}">Ingresar</a></p><p>¿No pediste este enlace? Ignora este correo: sin él nadie puede ingresar a tu cuenta.</p>`,
        meta: { kind: 'sign-in', link },
      })
      .then(() => trace.action('auth:link-sent', { email }))
      .catch((error) => trace.error('auth:link-mail-failed', { email, error: error instanceof Error ? error.message : String(error) }));
  }

  private async verify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.access.originAllowed(req)) throw new HttpError(403, 'Cross-origin request refused');
    const raw = (await readBody(req, 4 * 1024)).toString('utf8');
    const token = new URLSearchParams(raw).get('token') ?? '';
    const consumed = token ? this.db.consumeLoginToken(sha256(token)) : null;
    if (!consumed || !this.access.maySignIn(consumed.email)) {
      trace.action('auth:verify-refused', { consumed: !!consumed });
      sendHtml(res, 410, expiredPage());
      return;
    }
    const user = this.db.ensureUser(consumed.email);
    this.db.markLogin(user.id);
    const session = randomToken();
    this.db.createSession(sha256(session), user.id, SESSION_TTL_MS);
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, session, { maxAgeSeconds: SESSION_TTL_MS / 1000, secure: this.config.cookieSecure }),
    );
    trace.action('auth:signed-in', { userId: user.id, email: user.email });
    redirect(res, safeReturnTo(consumed.returnTo));
  }

  /** Invitation mail; failures are reported, never fatal to the invite. */
  async sendInvite(email: string, siteName: string, invitedBy: string, role: 'editor' | 'viewer'): Promise<void> {
    const link = `${this.config.publicOrigin}/auth`;
    // Viewers get a read-only editor, so the mail must not promise editing.
    const verb = role === 'viewer' ? 'ver' : 'editar';
    try {
      await this.mailer.send({
        to: email,
        subject: `${invitedBy} te invitó a ${verb} ${siteName}`,
        text: `${invitedBy} te invitó a ${verb} "${siteName}" en ${BRAND}.\n\nPara ingresar, abre ${link}, escribe este correo y te mandamos un enlace de acceso.`,
        html: `<p>${escapeHtml(invitedBy)} te invitó a ${verb} <strong>${escapeHtml(siteName)}</strong> en ${BRAND}.</p><p>Para ingresar, escribe este correo y te mandamos un enlace de acceso.</p><p><a href="${escapeHtml(link)}">Ingresar</a></p>`,
        meta: { kind: 'invite', link },
      });
    } catch (error) {
      trace.error('auth:invite-mail-failed', { email, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

// ─── Pages ──────────────────────────────────────────────────────────────

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark light; --bg: #0f0f10; --fg: #f4f4f5; --muted: #a1a1aa; --line: #27272a; --accent: #8b5cf6; }
  @media (prefers-color-scheme: light) { :root { --bg: #fafafa; --fg: #18181b; --muted: #52525b; --line: #e4e4e7; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px; }
  main { width: 100%; max-width: 360px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 20px; }
  label { display: block; font-size: 13px; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); font: inherit; }
  button { margin-top: 12px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: default; }
  .status { margin-top: 14px; font-size: 14px; color: var(--muted); min-height: 1.5em; }
  a { color: var(--accent); }
</style></head><body><main>${body}</main></body></html>`;
}

function signInPage(returnTo: string): string {
  return page(
    `Ingresar · ${BRAND}`,
    `<h1>Ingresar</h1>
<p>Escribe el correo con el que te invitaron y te mandamos un enlace para ingresar. Sin contraseñas.</p>
<form id="f">
  <label for="email">Tu correo</label>
  <input id="email" name="email" type="email" autocomplete="email" placeholder="nombre@correo.com" required autofocus>
  <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
  <button id="b" type="submit">Envíame el enlace</button>
  <div class="status" id="s" role="status"></div>
</form>
<script>
  const f = document.getElementById('f'), b = document.getElementById('b'), s = document.getElementById('s');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    b.disabled = true; s.textContent = 'Enviando…';
    try {
      const r = await fetch('/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: f.email.value, returnTo: f.returnTo.value }) });
      const j = await r.json().catch(() => ({}));
      s.textContent = r.ok
        ? 'Listo. Si ese correo tiene acceso, el enlace llega en un minuto. Funciona una vez y dura 15 minutos.'
        : (j.error && j.error.message) || 'No pudimos enviar el enlace. Inténtalo otra vez en un momento.';
    } catch { s.textContent = 'No pudimos conectarnos. Revisa tu internet e inténtalo otra vez.'; }
    b.disabled = false;
  });
</script>`,
  );
}

function confirmPage(token: string): string {
  return page(
    `Ingresar · ${BRAND}`,
    `<h1>Ingresar</h1>
<p>Presiona el botón para ingresar a tus proyectos.</p>
<form method="post" action="/auth/verify">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <button type="submit">Ingresar</button>
</form>`,
  );
}

function expiredPage(): string {
  return page(
    `Enlace vencido · ${BRAND}`,
    `<h1>Este enlace ya no funciona</h1>
<p>Cada enlace sirve una sola vez y dura 15 minutos. Pide uno nuevo.</p>
<p><a href="/auth">Pedir un enlace nuevo</a></p>`,
  );
}
