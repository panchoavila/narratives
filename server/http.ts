// http.ts — Small request/response helpers shared by the server's handlers:
// bounded body reading, JSON and error replies, cookies, tokens, safe
// redirects. Error bodies use `{ error: { message, details? } }`, the shape
// the editor's backend clients already parse.

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { trace } from './trace';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

export function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, `Request body over ${Math.round(limitBytes / 1024 / 1024)} MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson<T = unknown>(req: IncomingMessage, limitBytes: number): Promise<T> {
  const raw = (await readBody(req, limitBytes)).toString('utf8');
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function sendError(res: ServerResponse, status: number, message: string, details?: unknown): void {
  sendJson(res, status, { error: { message, ...(details !== undefined ? { details } : {}) } });
}

/** Reply for a thrown value: HttpError keeps its status, anything else is a 500. */
export function sendFailure(res: ServerResponse, error: unknown, category: string): void {
  if (error instanceof HttpError) {
    sendError(res, error.status, error.message, error.details);
    return;
  }
  trace.error(category, error);
  sendError(res, 500, error instanceof Error ? error.message : 'Internal error');
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}

export function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Malformed value: ignore the cookie rather than failing the request.
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; secure: boolean },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${opts.maxAgeSeconds}`];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** 256-bit random token, URL-safe. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** A `returnTo` is followed only when it is a same-origin path. Control
 *  characters and backslashes are refused outright (browsers strip a TAB, so
 *  `/\t/evil.com` would become `//evil.com`), then the value must resolve to
 *  the same origin; only its path, query and hash are kept. */
export function safeReturnTo(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const base = 'http://return-to.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pathnameOf(req: IncomingMessage): string {
  const raw = (req.url ?? '/').split('?')[0] ?? '/';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function queryOf(req: IncomingMessage): URLSearchParams {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
}

export const isMutating = (method: string | undefined) =>
  method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
