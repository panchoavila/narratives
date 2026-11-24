// Branch isolation in live collaboration, end to end.
//
// A tab working on a branch must neither leak its edits into main nor take
// main's edits into its branch (briefs/22-11-2026-branch-review-workflow.md,
// fact 5 and failure mode 3).
//
// Two people edit `branchy`. The room's save leader ("brancher") works on a
// branch, and the other person ("collaborator") stays on main.
//
// Failure modes, written before the fix:
//   B1. The brancher, on branch `redesign`, deletes a box. No `file-sync` /
//       `file-delete` for a website path leaves the brancher's tab; the
//       collaborator's canvas (main) still shows the box; main on disk keeps
//       it.
//   B2. The collaborator deletes a box on main while the brancher is on the
//       branch. The brancher's branch canvas is unchanged.
//   B3. The brancher is the save leader and autosaves while on the branch.
//       Main on disk equals the room's main, with neither the branch's edit
//       nor a revert of the collaborator's.
//   B4. Back on main, the brancher sees the collaborator's edit and not the
//       branch's. The brancher's next main edit reaches the collaborator and
//       disk again.
//
// Artifact: test-results/selfhosted/branch-isolation/ holds summary.json
// (written even when a step fails), screenshots of both canvases at each step,
// and one trace and video per person.

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN, SITES, logLines, waitForLog, signIn, closePerson, openSite, deleteBox, canvasIds, idsIn,
  type Person,
} from './helpers';

const SITE = 'branchy';
const BEA = 'bea@e2e.test';
const PAGE_FILE = path.join(SITES, SITE, 'app', 'page.client.tsx');
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'test-results', 'selfhosted', 'branch-isolation');
const WEBSITE_PATH = /^(app|components|cms|icons|overrides|plugins|i18n|messages)\//;

const onDisk = () => idsIn(fs.readFileSync(PAGE_FILE, 'utf8'));

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

async function createBranch(page: Page, name: string): Promise<void> {
  await page.locator('[data-tutorial="branches-button"]').click();
  await page.getByTitle('New branch').click();
  await page.getByPlaceholder('Branch name').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.getByPlaceholder('Branch name')).toHaveCount(0);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  // The switch rebuilds the canvas, and again 250 ms later (switch-workspace.ts):
  // a click before that lands on a canvas about to be replaced.
  await page.waitForTimeout(1_000);
}

async function switchTo(page: Page, branch: string): Promise<void> {
  await page.getByText(branch, { exact: true }).first().click();
  await page.waitForTimeout(1_000);
}

/** Website writes (not `_meta/` editor state) this person sent to the room since `since`. */
function websiteWritesBy(person: Person, since: number): { category: string; path: string }[] {
  return logLines().slice(since)
    .filter((l) => (l.category === 'rt:file-sync' || l.category === 'rt:file-delete') && l.data.userId === person.userId)
    .filter((l) => WEBSITE_PATH.test(String(l.data.path)))
    .map((l) => ({ category: l.category, path: String(l.data.path) }));
}

test('a branch edit never reaches main, and a main edit never lands on the branch', async ({ browser }) => {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const summary: Record<string, unknown> = { site: SITE, result: 'fail' };
  const save = () => fs.writeFileSync(path.join(ARTIFACTS, 'summary.json'), JSON.stringify(summary, null, 2));
  const people: Person[] = [];

  try {
    const admin = await signIn(browser, ADMIN, ARTIFACTS);
    people.push(admin);
    const invite = await admin.context.request.post(`/api/websites/${SITE}/collaborators`, { data: { email: BEA, role: 'editor' } });
    expect(invite.status()).toBe(200);
    const bea = await signIn(browser, BEA, ARTIFACTS);
    people.push(bea);

    let since = logLines().length;
    await Promise.all([openSite(admin.page, SITE), openSite(bea.page, SITE)]);
    const joined = await waitForLog(since, (l) => l.category === 'rt:joined' && l.data.siteId === SITE && l.data.members === 2);
    const brancher = joined.data.leader === admin.userId ? admin : bea;
    const collaborator = brancher === admin ? bea : admin;
    summary.brancher = brancher.email;
    summary.collaborator = collaborator.email;
    save();

    const all = ['root', 'p', 'q', 'r', 's', 't'];
    expect(await canvasIds(brancher.page)).toEqual(all);
    expect(await canvasIds(collaborator.page)).toEqual(all);

    // ── B1: an edit on the branch stays on the branch ──
    await createBranch(brancher.page, 'redesign');
    since = logLines().length;
    await deleteBox(brancher.page, 'q');
    const onBranch = ['root', 'p', 'r', 's', 't'];
    await expect.poll(() => canvasIds(brancher.page)).toEqual(onBranch);
    await brancher.page.waitForTimeout(2_000); // a leaked write would have been relayed by now
    summary.B1 = {
      brancherWebsiteWritesWhileOnBranch: websiteWritesBy(brancher, since),
      collaboratorCanvas: await canvasIds(collaborator.page),
      mainOnDisk: onDisk(),
    };
    save();
    await shot(brancher.page, 'b1-brancher-on-branch');
    await shot(collaborator.page, 'b1-collaborator-on-main');
    expect(websiteWritesBy(brancher, since), 'B1: no website write left the branch').toEqual([]);
    expect(await canvasIds(collaborator.page), 'B1: main canvas unchanged').toEqual(all);
    expect(onDisk(), 'B1: main on disk unchanged').toEqual(all);

    // ── B2: an edit on main stays off the branch ──
    since = logLines().length;
    await deleteBox(collaborator.page, 's');
    const mainAfter = ['root', 'p', 'q', 'r', 't'];
    await expect.poll(() => canvasIds(collaborator.page)).toEqual(mainAfter);
    await waitForLog(since, (l) => l.category === 'rt:file-sync' && l.data.siteId === SITE && l.data.userId === collaborator.userId);
    await brancher.page.waitForTimeout(2_000);
    summary.B2 = { brancherBranchCanvas: await canvasIds(brancher.page) };
    save();
    await shot(brancher.page, 'b2-brancher-on-branch');
    expect(await canvasIds(brancher.page), 'B2: the branch canvas is unchanged').toEqual(onBranch);

    // ── B3: the leader autosaves while on the branch; main on disk is the room's main ──
    await brancher.page.waitForTimeout(8_000); // past the room flush (5 s) and the leader's autosave
    summary.B3 = { mainOnDisk: onDisk() };
    save();
    expect(onDisk(), 'B3: main on disk is the room main').toEqual(mainAfter);

    // ── B4: back on main, the brancher sees main, and main edits flow again ──
    await switchTo(brancher.page, 'main');
    await expect.poll(() => canvasIds(brancher.page), { message: 'B4: main shows the collaborator edit' }).toEqual(mainAfter);
    await deleteBox(brancher.page, 't', { x: 0.7, y: 0.7 });
    const finalMain = ['root', 'p', 'q', 'r'];
    await expect.poll(() => canvasIds(collaborator.page)).toEqual(finalMain);
    await expect.poll(() => onDisk(), { timeout: 30_000 }).toEqual(finalMain);
    summary.B4 = {
      brancherCanvas: await canvasIds(brancher.page),
      collaboratorCanvas: await canvasIds(collaborator.page),
      mainOnDisk: onDisk(),
    };
    await shot(brancher.page, 'b4-brancher-on-main');
    await shot(collaborator.page, 'b4-collaborator-on-main');
    summary.result = 'pass';
  } finally {
    save();
    for (const p of people) await closePerson(p, ARTIFACTS).catch(() => {});
  }
});
