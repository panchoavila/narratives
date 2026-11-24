// Content-only editing is a member role, end to end
// (briefs/22-11-2026-branch-review-workflow.md, D7). It replaces the retired
// site-wide `cmsOnly` lock and its spec (cms-only.spec.ts).
//
// Failure modes, written before the code (brief numbers in brackets):
//   C1 [30]  A new site is not locked: the owner gets the full editor, with no
//            content-only banner.
//   C2 [32]  With no AI service configured, the hosted editor shows no AI
//            controls (no Vibe button).
//   C3 [29]  A member invited as `content` sees the content-only editor: the
//            banner, and design surfaces disabled.
//   C4 [29]  The server keeps a `content` member's saves to CMS items: design
//            files in the same save are not written; valid items are; items
//            that break their schema are refused (422).
//   C5 [29]  The owner, in the same room, keeps full editing: a canvas edit
//            reaches disk while the content member is there.
//   C6       A site that still carries `cmsOnly: true` is not locked anymore.
//
// Artifact: test-results/selfhosted/content-role/summary.json (written even
// when a step fails), screenshots, one trace and video per person.

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN, SITES, signIn, closePerson, openSite, deleteBoxUntilGone, idsIn, logLines, waitForLog, type Person,
} from './helpers';

const SITE = 'magazine';
const CORA = 'cora@e2e.test';
const SITE_DIR = path.join(SITES, SITE);
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'test-results', 'selfhosted', 'content-role');

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

const banner = (page: Page) => page.getByText('Content editing — you can edit CMS items and media', { exact: false });

test('content-only is a member role: the owner keeps the full editor, a content member edits items only', async ({ browser }) => {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const summary: Record<string, unknown> = { site: SITE, result: 'fail' };
  const save = () => fs.writeFileSync(path.join(ARTIFACTS, 'summary.json'), JSON.stringify(summary, null, 2));
  const people: Person[] = [];

  try {
    const owner = await signIn(browser, ADMIN, ARTIFACTS);
    people.push(owner);
    const created = await owner.context.request.post('/api/sites', { data: { name: 'Magazine', id: SITE } });
    expect(created.status()).toBe(201);
    expect((await created.json()).cmsOnly).toBe(false);
    const meta = JSON.parse(fs.readFileSync(path.join(SITE_DIR, '_revyme', 'project-meta.json'), 'utf8'));
    expect(meta.cmsOnly ?? false, 'C1: a new site carries no lock').toBe(false);

    // ── C1, C2 ──
    await openSite(owner.page, SITE);
    await expect(banner(owner.page)).toHaveCount(0);
    await expect(owner.page.locator('[data-tutorial="branches-button"]')).toBeEnabled();
    await expect(owner.page.getByTestId('vibe-button'), 'C2: no AI controls without an AI service').toHaveCount(0);
    await shot(owner.page, 'c1-owner-full-editor');

    // ── C3 ──
    const invite = await owner.context.request.post(`/api/websites/${SITE}/collaborators`, { data: { email: CORA, role: 'content' } });
    expect(invite.status()).toBe(200);
    const cora = await signIn(browser, CORA, ARTIFACTS);
    people.push(cora);
    const since = logLines().length;
    await openSite(cora.page, SITE);
    await waitForLog(since, (l) => l.category === 'rt:joined' && l.data.siteId === SITE && l.data.userId === cora.userId);
    await expect(banner(cora.page), 'C3: the content-only banner').toBeVisible();
    await expect(cora.page.locator('[data-tutorial="branches-button"]'), 'C3: design surfaces are disabled').toBeDisabled();
    await shot(cora.page, 'c3-content-member');

    // ── C4: the server keeps a content member's saves to CMS items ──
    const site = await (await cora.context.request.get(`/api/sites/${SITE}`)).json();
    expect(site.role).toBe('content');
    const pageBefore = fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8');
    const items = JSON.parse(site.project.files['cms/entries.json']);
    const edited = [{ ...items[0], title: 'Título editado por contenido' }];
    const okSave = await cora.context.request.put(`/api/sites/${SITE}`, {
      data: {
        format: 'revyme-v1',
        files: { ...site.project.files, 'cms/entries.json': JSON.stringify(edited, null, 2) + '\n', 'app/page.client.tsx': '// replaced by a content member' },
        baseRevision: site.revision,
      },
    });
    expect(okSave.status(), await okSave.text()).toBe(200);
    expect(fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8'), 'C4: design untouched').toBe(pageBefore);
    expect(JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'cms', 'entries.json'), 'utf8'))[0].title, 'C4: items saved').toBe('Título editado por contenido');
    const revision = (await okSave.json()).revision;
    const badSave = await cora.context.request.put(`/api/sites/${SITE}`, {
      data: { format: 'revyme-v1', files: { ...site.project.files, 'cms/entries.json': JSON.stringify([{ ...items[0], title: '' }], null, 2) + '\n' }, baseRevision: revision },
    });
    expect(badSave.status(), 'C4: a published item without its required title is refused').toBe(422);
    summary.C4 = { designUntouched: true, itemSaved: true, invalidStatus: badSave.status() };
    save();

    // ── C5: the owner keeps full editing in the same room ──
    await openSite(owner.page, SITE);
    await waitForLog(since, (l) => l.category === 'rt:joined' && l.data.siteId === SITE && l.data.members === 2);
    const before = idsIn(fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8'));
    await deleteBoxUntilGone(owner.page, 'site-tagline');
    await expect.poll(() => idsIn(fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8')).includes('site-tagline'), { timeout: 30_000 }).toBe(false);
    summary.C5 = { before: before.length, after: idsIn(fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8')).length };
    save();
    await shot(owner.page, 'c5-owner-edit');

    // ── C6: an old site-wide lock is ignored ──
    const metaPath = path.join(SITES, 'other', '_revyme', 'project-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), cmsOnly: true }, null, 2));
    await openSite(owner.page, 'other');
    await expect(banner(owner.page), 'C6: cmsOnly no longer locks the editor').toHaveCount(0);
    summary.result = 'pass';
  } finally {
    save();
    for (const p of people) await closePerson(p, ARTIFACTS).catch(() => {});
  }
});
