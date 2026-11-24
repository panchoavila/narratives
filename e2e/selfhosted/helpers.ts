// Shared helpers for the self-hosted E2E specs: the server's JSON-line log,
// the file mail outbox, magic-link sign-in and canvas probes. The server and
// its data root come from start-server.mjs.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const DATA = path.resolve(__dirname, '..', '..', '.selfhosted-e2e');
export const SITES = path.join(DATA, 'root', 'sites');
const OUTBOX = path.join(DATA, 'root', '.selfhosted', 'outbox');
const LOG = path.join(DATA, 'server.log');

export const ADMIN = 'admin@e2e.test';

// ─── Server log + outbox ────────────────────────────────────────────────

export interface LogLine { ts: string; type: string; category: string; data: any }

export function logLines(): LogLine[] {
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as LogLine]; } catch { return []; }
  });
}

export async function waitForLog(since: number, match: (l: LogLine) => boolean, timeout = 30_000): Promise<LogLine> {
  let found: LogLine | undefined;
  await expect.poll(() => (found = logLines().slice(since).find(match)), { timeout }).toBeTruthy();
  return found!;
}

interface Mail { to: string; subject: string; meta?: { kind?: string; link?: string } }

export function mails(to: string, kind?: string): Mail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readdirSync(OUTBOX).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8')) as Mail)
    .filter((m) => m.to === to && (!kind || m.meta?.kind === kind));
}

// ─── People ─────────────────────────────────────────────────────────────

export interface Person { email: string; context: BrowserContext; page: Page; userId: string }

/** Real magic-link sign-in in a fresh browser context, recording a trace
 *  (`artifacts/trace-<name>.zip` once `closePerson` runs) and a video. */
export async function signIn(browser: Browser, email: string, artifacts: string): Promise<Person> {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4334',
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: path.join(artifacts, 'videos', email.split('@')[0]) },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title: email });
  // A fresh profile mounts the onboarding spotlight, which eats every pointer event.
  await context.addInitScript(() => localStorage.setItem('revyme-onboarding-completed', 'true'));
  const page = await context.newPage();

  const before = mails(email, 'sign-in').length;
  await page.goto('/auth?returnTo=%2Fdashboard');
  await page.fill('#email', email);
  await page.click('#b');
  await expect.poll(() => mails(email, 'sign-in').length).toBe(before + 1);
  const link = mails(email, 'sign-in').at(-1)!.meta!.link!;

  const since = logLines().length;
  await page.goto(link);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL('**/dashboard');
  const signedIn = await waitForLog(since, (l) => l.category === 'auth:signed-in' && l.data.email === email);
  return { email, context, page, userId: signedIn.data.userId as string };
}

export async function closePerson(person: Person, artifacts: string): Promise<void> {
  await person.context.tracing.stop({ path: path.join(artifacts, `trace-${person.email.split('@')[0]}.zip`) });
  await person.context.close();
}

// ─── Canvas ─────────────────────────────────────────────────────────────

export const sandbox = (page: Page) => page.frameLocator('iframe[src*="5174"]');
export const node = (page: Page, id: string) => sandbox(page).locator(`[data-id="${id}"]`);

export async function openSite(page: Page, siteId: string): Promise<void> {
  await page.goto(`/builder/${siteId}`);
  await sandbox(page).locator('[data-content-root]').first().waitFor({ state: 'attached', timeout: 90_000 });
  await sandbox(page).locator('[data-viewport]').first().waitFor({ state: 'attached', timeout: 30_000 });
}

/** Click the box on the canvas (selects it), then press Delete. `at` is the
 *  click point as a fraction of the box: people click different points, since
 *  a collaborator's cursor marker swallows clicks on the spot it rests on. */
export async function deleteBox(page: Page, id: string, at = { x: 0.3, y: 0.3 }): Promise<void> {
  const box = await node(page, id).first().boundingBox();
  expect(box, `box ${id} is on screen`).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * at.x, box!.y + box!.height * at.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
}

export const idsIn = (source: string) => [...source.matchAll(/data-id="(\w+)"/g)].map((m) => m[1]);

/** The data-ids on a person's canvas, in document order, deduplicated. */
export async function canvasIds(page: Page): Promise<string[]> {
  const ids = await sandbox(page).locator('[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  return ids.filter((id, i) => ids.indexOf(id) === i);
}
