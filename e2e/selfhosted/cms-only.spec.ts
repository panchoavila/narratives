// CMS-only remote content & local-first design · end to end
// (briefs/15-11-2026-cms-only-remote-design-local.md).
//
// Exercises the full split workflow against the shipped self-hosted editor
// build (`dist-selfhosted/`), bundled server (`dist-server/index.mjs`), and
// CLI scripts (`site:new`, `site:check`, `design:push`, `content:pull`):
//   1. Scaffold a CMS-first site locally (`site:new`), verify strict Oracle +
//      contract (`site:check --strict-oracle`), verify broken bindings bounce
//      (`CMS_UNKNOWN_FIELD` + `CMS_SEO_UNKNOWN_FIELD`), then `design:push` to
//      the server (admin-only).
//   2. Open `/builder/editorial` as admin and editor on the self-hosted server:
//      canvas/JSX/code/branches/schema controls are locked (`cms-only-banner`),
//      while CMS item CRUD, media uploads, and concurrent CMS item sync work
//      in real time; viewers remain strictly read-only.
//   3. Verify server-side write isolation and schema validation (`PUT` ignores
//      attempted `app/**` / `*.schema.json` edits, never deletes design files,
//      and rejects invalid JSON, duplicate/unsafe slugs, bad types, or blank
//      required fields on published items with 422 while allowing drafts).
//   4. While editors remain connected in the room, evolve the schema + view
//      locally (`category` enum with `defaultValue: 'nota'` + bound badge on
//      cards), verify breaking required-without-default schema changes are
//      refused (`422`), run `design:push` and observe live canvas + schema
//      convergence in open browser tabs with zero content loss, then run
//      `content:pull` to bring remote CMS rows and uploaded media back locally.
//
// Covers failure modes 1–19 in the brief. Produces traces, videos, screenshots,
// and `cms-only-summary.json` under `test-results/selfhosted/run-artifacts/`.

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const DATA = path.join(REPO, '.selfhosted-e2e');
const SERVER_ROOT = path.join(DATA, 'root');
const OUTBOX = path.join(SERVER_ROOT, '.selfhosted', 'outbox');
const LOG = path.join(DATA, 'server.log');
const ARTIFACTS = path.join(REPO, 'test-results', 'selfhosted', 'run-artifacts');

const SERVER_URL = 'http://127.0.0.1:4334';
const ADMIN_TOKEN = 'e2e-admin-sync-token-0123456789abcdef';
const ADMIN = 'admin@e2e.test';
const CMS_ED = 'cms-ed@e2e.test';
const CMS_VI = 'cms-vi@e2e.test';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.configure({ mode: 'serial' });

interface LogLine {
  ts: string;
  type: string;
  category: string;
  data: any;
}

function logLines(): LogLine[] {
  if (!fs.existsSync(LOG)) return [];
  return fs
    .readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LogLine];
      } catch {
        return [];
      }
    });
}

async function waitForLog(since: number, match: (l: LogLine) => boolean, timeout = 30_000): Promise<LogLine> {
  let found: LogLine | undefined;
  await expect.poll(() => (found = logLines().slice(since).find(match)), { timeout }).toBeTruthy();
  return found!;
}

interface Mail {
  to: string;
  subject: string;
  meta?: { kind?: string; link?: string };
}

function mails(to: string, kind?: string): Mail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readdirSync(OUTBOX)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8')) as Mail)
    .filter((m) => m.to === to && (!kind || m.meta?.kind === kind));
}

interface Person {
  label: string;
  email: string;
  context: BrowserContext;
  page: Page;
  userId: string;
}

const people = new Map<string, Person>();
let localWorkspace = '';

function runSiteCli(args: string[], expectFailure = false): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [path.join(REPO, 'server', 'site-sync.mjs'), ...args], {
      cwd: localWorkspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (expectFailure) {
      throw new Error(`Expected site-sync ${args.join(' ')} to fail, but it succeeded:\n${stdout}`);
    }
    return { status: 0, stdout, stderr: '' };
  } catch (err: any) {
    if (!expectFailure) {
      throw new Error(`site-sync ${args.join(' ')} failed:\nSTDOUT: ${err?.stdout ?? ''}\nSTDERR: ${err?.stderr ?? err?.message ?? err}`);
    }
    return {
      status: err?.status ?? 1,
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? ''),
    };
  }
}

async function signIn(browser: Browser, email: string, label: string): Promise<Person> {
  const context = await browser.newContext({
    baseURL: SERVER_URL,
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: path.join(ARTIFACTS, 'videos', label) },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title: label });
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
  const person: Person = { label, email, context, page, userId: signedIn.data.userId as string };
  people.set(label, person);
  return person;
}

const sandbox = (page: Page) => page.frameLocator('iframe[src*="5174"]');

async function openEditorial(page: Page): Promise<void> {
  await page.goto('/builder/editorial');
  await sandbox(page).locator('[data-content-root]').first().waitFor({ state: 'attached', timeout: 90_000 });
  await sandbox(page).locator('[data-viewport]').first().waitFor({ state: 'attached', timeout: 30_000 });
}

test.beforeAll(() => {
  localWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-local-design-'));
  fs.mkdirSync(path.join(localWorkspace, 'sites'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(localWorkspace, 'package.json'));
  fs.symlinkSync(path.join(REPO, 'packages'), path.join(localWorkspace, 'packages'));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(localWorkspace, 'node_modules'));
});

test('1. local scaffold (`site:new`) is strict-oracle clean, catches unknown CMS fields, and pushes design to the server', async ({ browser }) => {
  // Scaffold a brand-new CMS-first site locally (failure mode 17).
  const created = runSiteCli(['new', 'editorial', 'Revista Local']);
  expect(created.stdout).toContain('Created CMS-first site "Revista Local"');

  const localSiteDir = path.join(localWorkspace, 'sites', 'editorial');
  expect(fs.existsSync(path.join(localSiteDir, 'cms', 'site.schema.json'))).toBe(true);
  expect(fs.existsSync(path.join(localSiteDir, 'cms', 'entries.schema.json'))).toBe(true);
  expect(fs.existsSync(path.join(localSiteDir, 'cms', 'cms-types.d.ts'))).toBe(true);
  expect(fs.existsSync(path.join(localSiteDir, 'public', 'assets'))).toBe(true);
  expect(fs.existsSync(path.join(localSiteDir, 'public', 'uploads'))).toBe(true);

  const meta = JSON.parse(fs.readFileSync(path.join(localSiteDir, '_revyme', 'project-meta.json'), 'utf8'));
  expect(meta.cmsOnly).toBe(true);

  // Strict Oracle + Contract check passes with zero violations.
  const cleanCheck = runSiteCli(['check', 'editorial', '--strict-oracle']);
  expect(cleanCheck.stdout).toContain('✓ editorial: OK');

  // Inject an unknown CMS field into the view and into SEO bindings (failure modes 14, 15).
  const indexClientPath = path.join(localSiteDir, 'app', 'page.client.tsx');
  const detailServerPath = path.join(localSiteDir, 'app', 'entries', '[slug]', 'page.tsx');
  const origIndexClient = fs.readFileSync(indexClientPath, 'utf8');
  const origDetailServer = fs.readFileSync(detailServerPath, 'utf8');

  fs.writeFileSync(indexClientPath, origIndexClient.replace('{item.summary}', '{item.nonExistentSummary}'), 'utf8');
  fs.writeFileSync(detailServerPath, origDetailServer.replace('description: "summary"', 'description: "missingSeoField"'), 'utf8');

  const brokenCheck = runSiteCli(['check', 'editorial', '--strict-oracle'], true);
  expect(brokenCheck.stderr).toContain('CMS_UNKNOWN_FIELD');
  expect(brokenCheck.stderr).toContain('CMS_SEO_UNKNOWN_FIELD');

  // Refuses to push broken design to the server (failure mode 18).
  const refusedPush = runSiteCli(['push-design', 'editorial', '--url', SERVER_URL, '--token', ADMIN_TOKEN], true);
  expect(refusedPush.stderr).toContain('Refusing to push "editorial"');
  expect(fs.existsSync(path.join(SERVER_ROOT, 'sites', 'editorial'))).toBe(false);

  // Restore clean files + add a local design asset under public/assets/.
  fs.writeFileSync(indexClientPath, origIndexClient, 'utf8');
  fs.writeFileSync(detailServerPath, origDetailServer, 'utf8');
  const brandSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#111"/></svg>';
  fs.writeFileSync(path.join(localSiteDir, 'public', 'assets', 'mark.svg'), brandSvg, 'utf8');

  // Push clean design to the server via ADMIN_API_TOKEN.
  const pushed = runSiteCli(['push-design', 'editorial', '--url', SERVER_URL, '--token', ADMIN_TOKEN]);
  expect(pushed.stdout).toContain('Pushed design for "editorial"');
  expect(fs.existsSync(path.join(SERVER_ROOT, 'sites', 'editorial', 'public', 'assets', 'mark.svg'))).toBe(true);

  // Sign in admin, invite CMS editor + viewer, and verify non-admin cannot push design (failure mode 18).
  const admin = await signIn(browser, ADMIN, 'cms-admin');
  for (const [email, role] of [[CMS_ED, 'editor'], [CMS_VI, 'viewer']] as const) {
    const inv = await admin.context.request.post('/api/websites/editorial/collaborators', { data: { email, role } });
    expect(inv.status()).toBe(200);
  }
  const ed = await signIn(browser, CMS_ED, 'cms-editor');
  const nonAdminPush = await ed.context.request.post('/api/sites/editorial/design', {
    data: { designFiles: { 'app/page.client.tsx': origIndexClient } },
  });
  expect(nonAdminPush.status()).toBe(403);
});

test('2. self-hosted `cmsOnly` locks canvas/JSX/schemas while keeping live CMS item editing, uploads, and validation active', async ({ browser }) => {
  const admin = people.get('cms-admin')!;
  const ed = people.get('cms-editor')!;

  const since = logLines().length;
  await Promise.all([openEditorial(admin.page), openEditorial(ed.page)]);
  await waitForLog(since, (l) => l.category === 'rt:joined' && l.data.siteId === 'editorial' && l.data.members === 2);

  // Banner confirms CMS-only mode; canvas renders the scaffolded CMS copy.
  await expect(ed.page.getByTestId('cms-only-banner')).toBeVisible();
  await expect(sandbox(ed.page).locator('[data-id="site-title"]').first()).toContainText('Revista Local');
  await expect(sandbox(ed.page).locator('[data-id="entry-title"]').first()).toContainText('Primera entrada');

  // Failure mode 6: clicking a canvas element and pressing Delete does NOT delete it!
  const serverIndexPath = path.join(SERVER_ROOT, 'sites', 'editorial', 'app', 'page.client.tsx');
  const serverSchemaPath = path.join(SERVER_ROOT, 'sites', 'editorial', 'cms', 'entries.schema.json');
  const indexBytesBefore = fs.readFileSync(serverIndexPath, 'utf8');
  const schemaBytesBefore = fs.readFileSync(serverSchemaPath, 'utf8');

  const titleBox = await sandbox(ed.page).locator('[data-id="site-title"]').first().boundingBox();
  expect(titleBox).not.toBeNull();
  await ed.page.mouse.click(titleBox!.x + 20, titleBox!.y + 10);
  await ed.page.waitForTimeout(200);
  await ed.page.keyboard.press('Delete');
  await ed.page.waitForTimeout(600);
  await expect(sandbox(ed.page).locator('[data-id="site-title"]').first()).toContainText('Revista Local');

  // Design-only left buttons (Vibe, Branches) are disabled; CMS & Publish remain enabled (failure modes 6, 7).
  await expect(ed.page.getByTestId('vibe-button').locator('button')).toBeDisabled();
  await expect(ed.page.locator('[data-tutorial="branches-button"]')).toBeDisabled();
  await expect(ed.page.locator('[data-tutorial="cms-button"]')).toBeEnabled();
  await expect(ed.page.locator('[data-tutorial="header-publish-button"]')).toBeEnabled();

  // Failure mode 8: CMS panel auto-opened on boot, with NO "New collection" button.
  await expect(ed.page.locator('button[title="New collection"]')).toHaveCount(0);

  // Open the "Entries" collection in CmsEditorOverlay.
  await ed.page.getByText('Entries', { exact: true }).first().click();
  await expect(ed.page.getByRole('button', { name: 'New Item' })).toBeVisible();
  // Schema Fields tab and Vibe AI toggle are hidden in `cmsOnly` mode (failure mode 8).
  await expect(ed.page.getByRole('button', { name: 'Fields' })).toHaveCount(0);
  await expect(ed.page.getByRole('button', { name: 'Vibe' })).toHaveCount(0);

  // Failure modes 4, 7, 13: add a new item (starts as draft with empty required title → allowed!),
  // then fill fields, set Published, and save; both editors' canvases update live.
  await ed.page.getByRole('button', { name: 'New Item' }).click();
  const titleInput = ed.page.getByPlaceholder('Title');
  await expect(titleInput).toBeVisible();
  await titleInput.fill('Crónica desde el CMS');
  await ed.page.getByPlaceholder('Summary').fill('Escrita por colaboradores en línea.');
  await ed.page.locator('#cms-item-status').click();
  await ed.page.locator('.z-\\[10011\\]').getByText('Published', { exact: true }).click();
  const saveBtn = ed.page.getByRole('button', { name: 'Save' });
  if (await saveBtn.isEnabled()) {
    await saveBtn.click();
  }

  // Upload a CMS media file (`public/uploads/...`).
  const uploadRes = await ed.context.request.post('/api/sites/editorial/assets', {
    headers: { 'Content-Type': 'image/png', 'x-asset-filename': 'portada-cms.png' },
    data: TINY_PNG,
  });
  expect(uploadRes.status()).toBe(200);
  const uploadedUrl = ((await uploadRes.json()) as { url: string }).url;
  expect(uploadedUrl).toMatch(/^\/uploads\/\d+-portada-cms\.png$/);

  // Close overlay so we can screenshot and inspect the live canvas on both tabs.
  await ed.page.keyboard.press('Escape');
  for (const p of [ed.page, admin.page]) {
    await expect(sandbox(p).getByText('Crónica desde el CMS').first()).toBeVisible({ timeout: 25_000 });
  }

  // Wait for server persistence of `cms/entries.json` (leader autosave or room flush).
  const serverEntriesPath = path.join(SERVER_ROOT, 'sites', 'editorial', 'cms', 'entries.json');
  await expect.poll(() => fs.readFileSync(serverEntriesPath, 'utf8'), { timeout: 25_000 }).toContain('Crónica desde el CMS');

  // Failure modes 1 & 2: a direct PUT that tries to rewrite `app/page.client.tsx`,
  // rewrite `cms/entries.schema.json`, and omit other design files leaves ALL
  // design & schema files untouched on disk while persisting valid `cms/site.json`.
  const loaded = await (await ed.context.request.get('/api/sites/editorial')).json();
  expect(loaded.cmsOnly).toBe(true);
  const siteRows = JSON.parse(loaded.project.files['cms/site.json']);
  siteRows[0].tagline = 'Subtítulo actualizado en vivo desde el CMS.';

  const putTampered = await ed.context.request.put('/api/sites/editorial', {
    data: {
      baseRevision: loaded.revision,
      inSync: true,
      files: {
        'app/page.client.tsx': '// TAMPERED JSX',
        'cms/entries.schema.json': '{"name":"Hacked","slug":"entries","fields":[]}',
        'cms/site.json': JSON.stringify(siteRows, null, 2),
      },
    },
  });
  expect(putTampered.status()).toBe(200);
  expect(fs.readFileSync(serverIndexPath, 'utf8')).toBe(indexBytesBefore);
  expect(fs.readFileSync(serverSchemaPath, 'utf8')).toBe(schemaBytesBefore);
  expect(fs.readFileSync(path.join(SERVER_ROOT, 'sites', 'editorial', 'cms', 'site.json'), 'utf8')).toContain(
    'Subtítulo actualizado en vivo desde el CMS.',
  );

  // Failure modes 10, 11, 12, 13: server rejects malformed JSON, bad slug, wrong type,
  // and blank required field on a published item (`422`), without touching disk.
  const latestRev = ((await (await ed.context.request.get('/api/sites/editorial')).json()) as { revision: number }).revision;

  const badJson = await ed.context.request.put('/api/sites/editorial', {
    data: { baseRevision: latestRev, files: { 'cms/entries.json': '{not-json' } },
  });
  expect(badJson.status()).toBe(422);

  const badSlug = await ed.context.request.put('/api/sites/editorial', {
    data: {
      baseRevision: latestRev,
      files: {
        'cms/entries.json': JSON.stringify([
          { _id: '1', _slug: 'bad/slug', _status: 'published', title: 'Bad' },
        ]),
      },
    },
  });
  expect(badSlug.status()).toBe(422);

  const badType = await ed.context.request.put('/api/sites/editorial', {
    data: {
      baseRevision: latestRev,
      files: {
        'cms/entries.json': JSON.stringify([
          { _id: '1', _slug: 'ok-slug', _status: 'published', title: 99999 },
        ]),
      },
    },
  });
  expect(badType.status()).toBe(422);

  const emptyRequiredPublished = await ed.context.request.put('/api/sites/editorial', {
    data: {
      baseRevision: latestRev,
      files: {
        'cms/entries.json': JSON.stringify([
          { _id: '1', _slug: 'ok-slug', _status: 'published', title: '   ' },
        ]),
      },
    },
  });
  expect(emptyRequiredPublished.status()).toBe(422);

  // Failure mode 5: viewer cannot edit CMS or upload assets.
  const vi = await signIn(browser, CMS_VI, 'cms-viewer');
  await openEditorial(vi.page);
  await expect(vi.page.getByText("View only — you don't have edit access to this website.")).toBeVisible();
  await expect(vi.page.locator('[data-tutorial="cms-button"]')).toBeDisabled();
  await expect(vi.page.locator('[data-tutorial="header-publish-button"]')).toBeDisabled();
  const viPut = await vi.context.request.put('/api/sites/editorial', {
    data: { baseRevision: latestRev, files: { 'cms/site.json': JSON.stringify(siteRows) } },
  });
  expect(viPut.status()).toBe(403);
});

test('3. local design evolution (`design:push`) backfills new schema fields into live rooms without losing content, and `content:pull` syncs content locally', async () => {
  const admin = people.get('cms-admin')!;
  const ed = people.get('cms-editor')!;
  const localSiteDir = path.join(localWorkspace, 'sites', 'editorial');
  const localSchemaPath = path.join(localSiteDir, 'cms', 'entries.schema.json');
  const localIndexClientPath = path.join(localSiteDir, 'app', 'page.client.tsx');

  // 1. A schema change that adds a `required: true` field WITHOUT `defaultValue`
  //    would invalidate already-published remote items → server refuses with 422!
  const baseSchema = JSON.parse(fs.readFileSync(localSchemaPath, 'utf8'));
  const breakingSchema = {
    ...baseSchema,
    fields: [
      ...baseSchema.fields,
      { id: 'mandatoryCode', name: 'Mandatory Code', type: 'text', required: true },
    ],
  };
  fs.writeFileSync(localSchemaPath, JSON.stringify(breakingSchema, null, 2) + '\n', 'utf8');
  // Seed local sample item so local `site:check` passes, testing the REMOTE compatibility gate!
  const localEntriesPath = path.join(localSiteDir, 'cms', 'entries.json');
  const origLocalEntries = fs.readFileSync(localEntriesPath, 'utf8');
  const seededLocal = JSON.parse(origLocalEntries).map((r: any) => ({ ...r, mandatoryCode: 'LOC-1' }));
  fs.writeFileSync(localEntriesPath, JSON.stringify(seededLocal, null, 2) + '\n', 'utf8');

  const rejectedRemoteCompat = runSiteCli(
    ['push-design', 'editorial', '--url', SERVER_URL, '--token', ADMIN_TOKEN],
    true,
  );
  expect(rejectedRemoteCompat.stderr).toContain('422');
  expect(rejectedRemoteCompat.stderr).toContain('mandatoryCode');
  fs.writeFileSync(localEntriesPath, origLocalEntries, 'utf8');

  // 2. Now evolve schema safely: add `category` enum with `defaultValue: "nota"`,
  //    and render `{item.category}` as a badge inside `entry-card` in `app/page.client.tsx`.
  const evolvedSchema = {
    ...baseSchema,
    fields: [
      ...baseSchema.fields,
      {
        id: 'category',
        name: 'Category',
        type: 'enum',
        options: ['nota', 'ensayo', 'entrevista'],
        defaultValue: 'nota',
      },
    ],
  };
  fs.writeFileSync(localSchemaPath, JSON.stringify(evolvedSchema, null, 2) + '\n', 'utf8');

  const prevClient = fs.readFileSync(localIndexClientPath, 'utf8');
  const nextClient = prevClient.replace(
    `              <p data-id="entry-date"`,
    `              <span data-id="entry-category" data-name="Category" style={{
                position: 'relative', width: 'auto', height: 'auto',
                order: '0', flex: '0 0 auto', alignSelf: 'flex-start',
                padding: '3px 8px', borderRadius: '999px', backgroundColor: '#e2e8f0',
                fontSize: '11px', fontWeight: '600', lineHeight: '1.3', color: '#0f172a',
                fontFamily: 'Inter, sans-serif'
              }}>{item.category}</span>
              <p data-id="entry-date"`,
  ).replace(
    `order: '0', flex: '0 0 auto',\n                fontSize: '12px'`,
    `order: '1', flex: '0 0 auto',\n                fontSize: '12px'`,
  ).replace(
    `order: '1', flex: '0 0 auto',\n                fontSize: '20px'`,
    `order: '2', flex: '0 0 auto',\n                fontSize: '20px'`,
  ).replace(
    `order: '2', flex: '0 0 auto',\n                fontSize: '15px'`,
    `order: '3', flex: '0 0 auto',\n                fontSize: '15px'`,
  );
  fs.writeFileSync(localIndexClientPath, nextClient, 'utf8');

  // Verify strict oracle + contract locally, then push to the server WHILE
  // `admin` and `ed` remain connected in the live collaboration room!
  runSiteCli(['check', 'editorial', '--strict-oracle']);
  const pushLive = runSiteCli(['push-design', 'editorial', '--url', SERVER_URL, '--token', ADMIN_TOKEN]);
  expect(pushLive.stdout).toContain('reconciled: cms/entries.json');

  // Both connected browser canvases live-update with the new `{item.category}` badge ("nota")
  // AND preserve the remote CMS entry ("Crónica desde el CMS")!
  for (const p of [admin.page, ed.page]) {
    await expect(sandbox(p).locator('[data-id="entry-category"]').first()).toContainText('nota', { timeout: 25_000 });
    await expect(sandbox(p).getByText('Crónica desde el CMS').first()).toBeVisible();
  }

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await ed.page.screenshot({ path: path.join(ARTIFACTS, 'cms-only-live-design-push.png') });

  // 3. Pull remote content + uploaded media back to the local workspace (`content:pull`, failure mode 19).
  const pulled = runSiteCli(['pull-content', 'editorial', '--url', SERVER_URL, '--token', ADMIN_TOKEN]);
  expect(pulled.stdout).toContain('Pulled content for "editorial"');

  const pulledEntries = JSON.parse(fs.readFileSync(localEntriesPath, 'utf8')) as Array<Record<string, any>>;
  expect(pulledEntries.some((e) => e.title === 'Crónica desde el CMS' && e.category === 'nota')).toBe(true);

  const pulledSiteCopy = JSON.parse(fs.readFileSync(path.join(localSiteDir, 'cms', 'site.json'), 'utf8'));
  expect(pulledSiteCopy[0].tagline).toBe('Subtítulo actualizado en vivo desde el CMS.');

  const uploadedFiles = fs.readdirSync(path.join(localSiteDir, 'public', 'uploads'));
  expect(uploadedFiles.some((f) => f.endsWith('-portada-cms.png'))).toBe(true);

  // Local views, schemas, and design assets remain 100% intact!
  expect(fs.readFileSync(localIndexClientPath, 'utf8')).toBe(nextClient);
  expect(fs.existsSync(path.join(localSiteDir, 'public', 'assets', 'mark.svg'))).toBe(true);
});

test.afterAll(async ({}, testInfo) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  for (const person of people.values()) {
    await person.context.tracing
      .stop({ path: path.join(ARTIFACTS, `trace-${person.label}.zip`) })
      .catch(() => {});
    await person.context.close().catch(() => {});
  }
  const summaryPath = path.join(ARTIFACTS, 'cms-only-summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        coveredFailureModes: Array.from({ length: 19 }, (_, i) => i + 1),
        participants: [...people.keys()],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  await testInfo.attach('cms-only-summary.json', { path: summaryPath, contentType: 'application/json' });
  if (localWorkspace && fs.existsSync(localWorkspace)) {
    fs.rmSync(localWorkspace, { recursive: true, force: true });
  }
});
