// Applying a branch, end to end (briefs/22-11-2026-branch-review-workflow.md, D1 and D3).
//
// The owner reviews branches an agent pushed (created here through the
// branches API, as an agent would) and applies them in the hosted editor.
// The site `shop` has a CMS collection `entries` with two published items,
// W ("welcome") and S ("second"). Every branch was cut from the same main;
// main then changed W's summary.
//
// Failure modes, written before the code (brief numbers in brackets):
//   A1 [20]       A branch that removes the field `summary` while published
//                 items use it: refused with the reason; main unchanged.
//   A2 [24]       A branch whose page does not parse: refused by the gate,
//                 judged against main; main unchanged.
//   A3 [14,18,19] A branch that edits S's title and adds the field
//                 `subtitle` (default "Nuevo"): applied. Main keeps W's own
//                 edit, takes S's, and both items get the default.
//   A4 [27]       Undo restores main and the branch; applying again gives
//                 the same main.
//   A5 [16,42]    A branch that edits W's summary, which main also edited:
//                 a conflict, nothing written; choosing "Use the branch"
//                 applies it.
//
// Artifact: test-results/selfhosted/branch-apply/summary.json (written even
// when a step fails), screenshots per step, the owner's trace and video.

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN, SITES, signIn, closePerson, openSite, openBranchesPanel, type Person } from './helpers';

const SITE = 'shop';
const SITE_DIR = path.join(SITES, SITE);
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'test-results', 'selfhosted', 'branch-apply');

type Item = Record<string, unknown>;
type Files = Record<string, string>;

const readItems = (): Item[] => JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'cms', 'entries.json'), 'utf8'));
const readSchemaFields = (): string[] =>
  JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'cms', 'entries.schema.json'), 'utf8')).fields.map((f: { id: string }) => f.id);
const item = (items: Item[], id: string) => items.find((i) => i._id === id);

function recordFile(branch: string, p: string): string | null {
  const recPath = path.join(SITE_DIR, '_revyme', 'branches', `${branch}.json`);
  if (!fs.existsSync(recPath)) return null;
  const hash = JSON.parse(fs.readFileSync(recPath, 'utf8')).files[p];
  return hash ? fs.readFileSync(path.join(SITE_DIR, '_revyme', 'blobs', hash), 'utf8') : null;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

async function openReview(page: Page, branch: string): Promise<void> {
  await openBranchesPanel(page);
  await page.getByText(branch, { exact: true }).first().click({ button: 'right' });
  await page.getByText('Review changes…').click();
  await expect(page.getByTestId('branch-apply')).toBeVisible();
}

async function closeModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('branch-apply')).toHaveCount(0);
}

test('the owner applies agent branches: CMS items merge per item, published content is protected, undo restores the branch', async ({ browser }) => {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const summary: Record<string, unknown> = { site: SITE, result: 'fail' };
  const save = () => fs.writeFileSync(path.join(ARTIFACTS, 'summary.json'), JSON.stringify(summary, null, 2));
  const people: Person[] = [];

  try {
    const owner = await signIn(browser, ADMIN, ARTIFACTS);
    people.push(owner);
    const api = owner.context.request;

    // ── Fixture: a CMS-first site, editable (no site-wide lock), two items ──
    expect((await api.post('/api/sites', { data: { name: 'Shop', id: SITE } })).status()).toBe(201);
    const metaPath = path.join(SITE_DIR, '_revyme', 'project-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), cmsOnly: false }, null, 2));
    const site = await (await api.get(`/api/sites/${SITE}`)).json();
    const website = (files: Files): Files => Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith('_meta/')));
    const F0: Files = website(site.project.files);
    const [W0] = JSON.parse(F0['cms/entries.json']) as Item[];
    const S0: Item = { ...W0, _id: 'item_second', _slug: 'segunda', title: 'Segunda', summary: 'Resumen segunda' };
    const F1: Files = { ...F0, 'cms/entries.json': JSON.stringify([W0, S0], null, 2) + '\n' };
    const saved1 = await api.put(`/api/sites/${SITE}`, { data: { format: 'revyme-v1', files: { ...site.project.files, ...F1 }, baseRevision: site.revision } });
    expect(saved1.status()).toBe(200);
    const r1 = (await saved1.json()).revision as number;

    const schema = JSON.parse(F1['cms/entries.schema.json']);
    const page = F1['app/page.client.tsx'];
    const pushBranch = async (id: string, files: Files) => {
      const res = await api.put(`/api/sites/${SITE}/branches/${id}`, { data: { baseRevision: null, base: { set: F1 }, files: { set: files } } });
      expect(res.status(), `create ${id}`).toBe(200);
    };
    // A1: drops `summary`, which both published items fill.
    await pushBranch('agent-drop-summary', {
      ...F1,
      'cms/entries.schema.json': JSON.stringify({ ...schema, fields: schema.fields.filter((f: { id: string }) => f.id !== 'summary') }, null, 2) + '\n',
    });
    // A2: a page that does not parse.
    await pushBranch('agent-broken-page', { ...F1, 'app/page.client.tsx': page.replace(/<(\w+)([^>]*data-id="[^"]+"[^>]*)>/, '<$1$2><div data-id="broken">') });
    // A3: S's title + a new field with a default.
    await pushBranch('agent-second-title', {
      ...F1,
      'cms/entries.schema.json': JSON.stringify({ ...schema, fields: [...schema.fields, { id: 'subtitle', name: 'Subtitle', type: 'text', defaultValue: 'Nuevo' }] }, null, 2) + '\n',
      'cms/entries.json': JSON.stringify([W0, { ...S0, title: 'Segunda (rama)' }], null, 2) + '\n',
    });
    // A5: W's summary, which main edits too.
    await pushBranch('agent-welcome-summary', {
      ...F1,
      'cms/entries.json': JSON.stringify([{ ...W0, summary: 'Resumen rama' }, S0], null, 2) + '\n',
    });
    // Main moves on after the branches were cut: W's summary.
    const saved2 = await api.put(`/api/sites/${SITE}`, {
      data: { format: 'revyme-v1', files: { ...site.project.files, ...F1, 'cms/entries.json': JSON.stringify([{ ...W0, summary: 'Resumen main' }, S0], null, 2) + '\n' }, baseRevision: r1 },
    });
    expect(saved2.status()).toBe(200);
    const mainBefore = JSON.stringify(readItems());

    await openSite(owner.page, SITE);

    // ── A1 ──
    await openReview(owner.page, 'agent-drop-summary');
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-apply-error')).toContainText('summary');
    summary.A1 = { error: await owner.page.getByTestId('branch-apply-error').textContent() };
    save();
    await shot(owner.page, 'a1-refused-published-field');
    await closeModal(owner.page);
    expect(JSON.stringify(readItems()), 'A1: main unchanged').toBe(mainBefore);
    expect(readSchemaFields()).toContain('summary');

    // ── A2 ──
    await openReview(owner.page, 'agent-broken-page');
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-apply-error')).toContainText('oracle gate');
    summary.A2 = { error: await owner.page.getByTestId('branch-apply-error').textContent() };
    save();
    await shot(owner.page, 'a2-refused-gate');
    await closeModal(owner.page);
    expect(fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8')).not.toContain('data-id="broken"');

    // ── A3 ──
    await openReview(owner.page, 'agent-second-title');
    await shot(owner.page, 'a3-review');
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-apply')).toHaveCount(0);
    const expectA3 = async () => {
      await expect.poll(() => item(readItems(), 'item_second')?.title, { timeout: 30_000 }).toBe('Segunda (rama)');
      const items = readItems();
      expect(item(items, W0._id as string)?.summary, 'A3: main’s own edit survives').toBe('Resumen main');
      expect(items.map((i) => i.subtitle), 'A3: the new field’s default is backfilled').toEqual(['Nuevo', 'Nuevo']);
      expect(readSchemaFields()).toContain('subtitle');
    };
    await expectA3();
    summary.A3 = { items: readItems() };
    save();

    // ── A4: undo, then apply again ──
    await owner.page.keyboard.press('Escape');
    await owner.page.keyboard.press('Meta+z');
    await expect.poll(() => item(readItems(), 'item_second')?.title, { timeout: 30_000, message: 'A4: undo restores main' }).toBe('Segunda');
    expect(readSchemaFields()).not.toContain('subtitle');
    await expect.poll(() => recordFile('agent-second-title', 'cms/entries.json')?.includes('Segunda (rama)') ?? false, { timeout: 15_000, message: 'A4: the branch holds its work again' }).toBe(true);
    summary.A4 = { afterUndo: readItems() };
    save();
    await openReview(owner.page, 'agent-second-title');
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-apply')).toHaveCount(0);
    await expectA3();

    // ── A5: a conflict, then a choice ──
    await openReview(owner.page, 'agent-welcome-summary');
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-conflicts')).toBeVisible();
    await shot(owner.page, 'a5-conflict');
    expect(item(readItems(), W0._id as string)?.summary, 'A5: nothing written on a conflict').toBe('Resumen main');
    await owner.page.locator('[data-testid^="conflict-take-branch-cms/entries.json-"]').first().click();
    await owner.page.getByTestId('branch-apply').click();
    await expect(owner.page.getByTestId('branch-apply')).toHaveCount(0);
    await expect.poll(() => item(readItems(), W0._id as string)?.summary, { timeout: 30_000 }).toBe('Resumen rama');
    expect(item(readItems(), 'item_second')?.title, 'A5: the other item is untouched').toBe('Segunda (rama)');
    summary.A5 = { items: readItems() };
    await shot(owner.page, 'a5-applied');
    summary.result = 'pass';
  } finally {
    save();
    for (const p of people) await closePerson(p, ARTIFACTS).catch(() => {});
  }
});
