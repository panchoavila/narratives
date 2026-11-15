// Self-hosted collaboration · end to end (briefs/13-11-2026-self-hosted-collab-backend.md).
//
// Drives the shipped editor build against the bundled server with several
// real browser contexts, one per person: admin (owner of every site), an
// editor and a viewer on `demo`, and an editor invited only to `other`.
// Sign-in goes through the real magic-link flow (file mail transport); live
// edits are real clicks + Delete on the canvas; the room is observed through
// the canvases themselves, the site files on disk and the server's log.
//
// Covers failure modes 1, 3, 10-15, 20-22 (via convergence), 25, 26, 28, 31.
// Artifact: one Playwright trace + video per person under
// test-results/selfhosted/run-artifacts/, plus the server log attached to
// the last test.

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve(__dirname, '..', '..', '.selfhosted-e2e');
const OUTBOX = path.join(DATA, 'root', '.selfhosted', 'outbox');
const LOG = path.join(DATA, 'server.log');
const DEMO_PAGE = path.join(DATA, 'root', 'sites', 'demo', 'app', 'page.client.tsx');
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'test-results', 'selfhosted', 'run-artifacts');

const ADMIN = 'admin@e2e.test';
const ED = 'ed@e2e.test';
const VI = 'vi@e2e.test';
const CAROL = 'carol@e2e.test';
const STRANGER = 'stranger@e2e.test';
const VIEW_ONLY = "View only — you don't have edit access to this website.";

test.describe.configure({ mode: 'serial' });

// ─── Server log + outbox ────────────────────────────────────────────────

interface LogLine { ts: string; type: string; category: string; data: any }

function logLines(): LogLine[] {
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as LogLine]; } catch { return []; }
  });
}

async function waitForLog(since: number, match: (l: LogLine) => boolean, timeout = 30_000): Promise<LogLine> {
  let found: LogLine | undefined;
  await expect.poll(() => (found = logLines().slice(since).find(match)), { timeout }).toBeTruthy();
  return found!;
}

interface Mail { to: string; subject: string; meta?: { kind?: string; link?: string } }

function mails(to: string, kind?: string): Mail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readdirSync(OUTBOX).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8')) as Mail)
    .filter((m) => m.to === to && (!kind || m.meta?.kind === kind));
}

// ─── People ─────────────────────────────────────────────────────────────

interface Person { email: string; context: BrowserContext; page: Page; userId: string; usedLink: string }
const people = new Map<string, Person>();

async function signIn(browser: Browser, email: string): Promise<Person> {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4334',
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: path.join(ARTIFACTS, 'videos', email.split('@')[0]) },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title: email });
  // A fresh profile mounts the onboarding spotlight, which eats every pointer event.
  await context.addInitScript(() => localStorage.setItem('revyme-onboarding-completed', 'true'));
  const page = await context.newPage();

  const before = mails(email, 'sign-in').length;
  await page.goto('/auth?returnTo=%2Fdashboard');
  await page.fill('#email', email);
  await page.click('#b');
  await expect(page.locator('#s')).toContainText('el enlace llega en un minuto');
  await expect.poll(() => mails(email, 'sign-in').length).toBe(before + 1);
  const link = mails(email, 'sign-in').at(-1)!.meta!.link!;

  const since = logLines().length;
  await page.goto(link);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL('**/dashboard');
  const signedIn = await waitForLog(since, (l) => l.category === 'auth:signed-in' && l.data.email === email);
  const person = { email, context, page, userId: signedIn.data.userId as string, usedLink: link };
  people.set(email, person);
  return person;
}

function who(email: string): Person {
  const p = people.get(email);
  if (!p) throw new Error(`${email} has not signed in`);
  return p;
}

// ─── Canvas ─────────────────────────────────────────────────────────────

const sandbox = (page: Page) => page.frameLocator('iframe[src*="5174"]');
const node = (page: Page, id: string) => sandbox(page).locator(`[data-id="${id}"]`);

async function openDemo(page: Page): Promise<void> {
  await page.goto('/builder/demo');
  await sandbox(page).locator('[data-content-root]').first().waitFor({ state: 'attached', timeout: 90_000 });
  await sandbox(page).locator('[data-viewport]').first().waitFor({ state: 'attached', timeout: 30_000 });
}

/** Click the box on the canvas (selects it), then press Delete. `at` is the
 *  click point as a fraction of the box. People click different points: a
 *  collaborator's cursor marker stays where they last clicked and swallows
 *  clicks on that spot (see the brief, risks). */
async function deleteBox(page: Page, id: string, at = { x: 0.3, y: 0.3 }): Promise<void> {
  const box = await node(page, id).first().boundingBox();
  expect(box, `box ${id} is on screen`).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * at.x, box!.y + box!.height * at.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
}

const demoOnDisk = () => fs.readFileSync(DEMO_PAGE, 'utf8');
const idsIn = (source: string) => [...source.matchAll(/data-id="(\w+)"/g)].map((m) => m[1]);
/** The data-ids on a person's canvas, in document order, deduplicated. */
async function canvasIds(page: Page): Promise<string[]> {
  const ids = await sandbox(page).locator('[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

// ─── Tests ──────────────────────────────────────────────────────────────

test('sign-in by magic link; each person sees only their projects; only the admin creates', async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await expect(admin.page.getByTestId('site-card-demo')).toBeVisible();
  await expect(admin.page.getByTestId('site-card-other')).toBeVisible();
  await expect(admin.page.getByTestId('sidebar-new-website-button')).toBeVisible();

  for (const [email, site, role] of [[ED, 'demo', 'editor'], [VI, 'demo', 'viewer'], [CAROL, 'other', 'editor']] as const) {
    const res = await admin.context.request.post(`/api/websites/${site}/collaborators`, { data: { email, role } });
    expect(res.status(), `invite ${email}`).toBe(200);
    expect(mails(email, 'invite')).toHaveLength(1);
  }

  // Not invited: same answer, no mail (failure mode 3).
  const stranger = await admin.context.request.post('/auth/request', { data: { email: STRANGER } });
  expect(stranger.status()).toBe(200);
  expect(mails(STRANGER)).toHaveLength(0);

  const ed = await signIn(browser, ED);
  await expect(ed.page.getByTestId('site-card-demo')).toBeVisible();
  await expect(ed.page.getByTestId('site-card-other')).toHaveCount(0);
  await expect(ed.page.getByTestId('sidebar-new-website-button')).toHaveCount(0);
  const create = await ed.context.request.post('/api/sites', { data: { name: 'Nope' } });
  expect(create.status()).toBe(403);

  // A used link cannot sign anyone in again (failure mode 1).
  await ed.page.goto(ed.usedLink);
  await expect(ed.page.getByText('Este enlace ya no funciona')).toBeVisible();
});

test('two editors delete boxes at once; every canvas and the saved file converge on both deletes', async () => {
  const admin = who(ADMIN);
  const ed = who(ED);
  const since = logLines().length;
  await Promise.all([openDemo(admin.page), openDemo(ed.page)]);
  await waitForLog(since, (l) => l.category === 'rt:joined' && l.data.siteId === 'demo' && l.data.members === 2);

  await Promise.all([deleteBox(admin.page, 'a'), deleteBox(ed.page, 'f')]);

  const expected = ['root', 'b', 'c', 'd', 'e', 'g'];
  for (const page of [admin.page, ed.page]) {
    await expect.poll(() => canvasIds(page)).toEqual(expected);
  }
  const writers = new Set(logLines().slice(since).filter((l) => l.category === 'rt:file-sync').map((l) => l.data.userId));
  expect(writers).toContain(admin.userId);
  expect(writers).toContain(ed.userId);

  // The save leader autosaves the merged page: the file equals both canvases.
  await expect.poll(() => idsIn(demoOnDisk()), { timeout: 30_000 }).toEqual(expected);
});

test('a late joiner gets the room\'s live edits right after joining, and is read-only as a viewer', async ({ browser }) => {
  const admin = who(ADMIN);
  const since = logLines().length;
  await deleteBox(admin.page, 'c');
  await waitForLog(since, (l) => l.category === 'rt:file-sync' && l.data.userId === admin.userId);

  const vi = await signIn(browser, VI);
  await openDemo(vi.page);
  await expect(node(vi.page, 'c')).toHaveCount(0);
  await expect(node(vi.page, 'd').first()).toBeVisible();
  await expect.poll(() => canvasIds(vi.page)).toEqual(await canvasIds(admin.page));
  const replay = await waitForLog(since, (l) => l.category === 'rt:replay' && l.data.siteId === 'demo');
  expect(replay.data.files).toBeGreaterThan(0);
  await expect(vi.page.getByText(VIEW_ONLY)).toBeVisible();
});

test('a viewer cannot change the site, in the editor or through the API', async () => {
  const vi = who(VI);
  const admin = who(ADMIN);
  const since = logLines().length;
  await deleteBox(vi.page, 'd', { x: 0.75, y: 0.75 });
  await vi.page.waitForTimeout(2_500);
  await expect(node(vi.page, 'd').first()).toBeVisible();
  await expect(node(admin.page, 'd').first()).toBeVisible();
  const viewerWrites = logLines().slice(since).filter((l) => l.category === 'rt:file-sync' && l.data.userId === vi.userId);
  expect(viewerWrites).toHaveLength(0);

  // Panning saves the viewer's camera (`_meta/page-camera.json`) through the
  // room: acked and dropped, and the viewer stays connected (failure mode 13).
  const canvas = await node(vi.page, 'root').first().boundingBox();
  await vi.page.mouse.move(canvas!.x + 200, canvas!.y + 400);
  await vi.page.mouse.wheel(0, 240);
  await waitForLog(since, (l) => l.category === 'rt:file-sync-dropped' && l.data.userId === vi.userId);
  await vi.page.waitForTimeout(1_000);
  expect(logLines().slice(since).filter((l) => l.category === 'rt:disconnect' && l.data.userId === vi.userId)).toHaveLength(0);

  const site = await (await vi.context.request.get('/api/sites/demo')).json();
  expect(site.role).toBe('viewer');
  const put = await vi.context.request.put('/api/sites/demo', { data: { files: site.project.files, baseRevision: site.revision } });
  expect(put.status()).toBe(403);
});

test('a non-member is refused everywhere, and a save on an old revision conflicts', async ({ browser }) => {
  const carol = await signIn(browser, CAROL);
  await expect(carol.page.getByTestId('site-card-other')).toBeVisible();
  await expect(carol.page.getByTestId('site-card-demo')).toHaveCount(0);
  expect((await carol.context.request.get('/api/sites/demo')).status()).toBe(404);

  const since = logLines().length;
  await openDemo(carol.page);
  await waitForLog(since, (l) => l.category === 'rt:join-refused' && l.data.siteId === 'demo' && l.data.userId === carol.userId);
  await expect(node(carol.page, 'd')).toHaveCount(0);

  const admin = who(ADMIN);
  const site = await (await admin.context.request.get('/api/sites/demo')).json();
  expect(site.revision).toBeGreaterThan(0);
  const stale = await admin.context.request.put('/api/sites/demo', { data: { files: site.project.files, baseRevision: 0 } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error.details.revision).toBe(site.revision);
});

test('when the save leader leaves, the other editor takes over saving', async () => {
  const admin = who(ADMIN);
  const ed = who(ED);
  const leaderLine = logLines().filter((l) => (l.category === 'rt:leader' || l.category === 'rt:joined') && l.data.siteId === 'demo').at(-1)!;
  const leaderId = leaderLine.data.leader as string;
  expect([admin.userId, ed.userId]).toContain(leaderId);
  const [leaving, staying] = leaderId === admin.userId ? [admin, ed] : [ed, admin];

  const since = logLines().length;
  await leaving.page.close();
  await waitForLog(since, (l) => l.category === 'rt:leader' && l.data.siteId === 'demo' && l.data.leader === staying.userId);

  await deleteBox(staying.page, 'd');
  // Still in the room (with the viewer), so nothing but the new leader's own save writes the file.
  await expect.poll(demoOnDisk, { timeout: 30_000 }).not.toContain('data-id="d"');
  await waitForLog(since, (l) => l.category === 'api:saved' && l.data.siteId === 'demo' && l.data.userId === staying.userId);
  await expect(node(who(VI).page, 'd')).toHaveCount(0);
  const final = idsIn(demoOnDisk());
  await expect.poll(() => canvasIds(staying.page)).toEqual(final);
  await expect.poll(() => canvasIds(who(VI).page)).toEqual(final);
});

test('site images show on the canvas: the sandbox origin serves public files without a session, the others do not', async ({ playwright }) => {
  const admin = who(ADMIN);
  // The previous test may have closed the admin's page; the context (session) is still open.
  const page = await admin.context.newPage();
  await page.goto('/builder/gallery');
  await sandbox(page).locator('[data-content-root]').first().waitFor({ state: 'attached', timeout: 90_000 });
  const pic = sandbox(page).locator('img[data-id="pic"], [data-id="pic"] img').first();
  await pic.waitFor({ state: 'attached', timeout: 30_000 });
  // The canvas iframe is credentialless: this only loads if :5174 serves it without the cookie.
  await expect.poll(
    () => pic.evaluate((el) => ((el as HTMLImageElement).complete ? (el as HTMLImageElement).naturalWidth : 0)),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);

  // No cookies at all, like the canvas iframe: only the sandbox origin answers.
  const anon = await playwright.request.newContext();
  expect((await anon.get('http://127.0.0.1:5174/media/e2e-dot.png')).status(), 'sandbox origin').toBe(200);
  expect((await anon.get('http://127.0.0.1:5175/media/e2e-dot.png')).status(), 'preview origin').toBe(404);
  expect((await anon.get('http://127.0.0.1:4334/media/e2e-dot.png')).status(), 'editor origin').toBe(404);
  await anon.dispose();
  await page.close();
});

test.afterAll(async ({}, testInfo) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  for (const person of people.values()) {
    await person.context.tracing.stop({ path: path.join(ARTIFACTS, `trace-${person.email.split('@')[0]}.zip`) }).catch(() => {});
    await person.context.close().catch(() => {});
  }
  fs.copyFileSync(LOG, path.join(ARTIFACTS, 'server.log'));
  await testInfo.attach('server.log', { path: path.join(ARTIFACTS, 'server.log'), contentType: 'text/plain' });
});
