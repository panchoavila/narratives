// Branches as server records, end to end (briefs/22-11-2026-branch-review-workflow.md, D2).
//
// Two people on `records`. Branches are stored by the server
// (src/server/branch-records.ts), each with its own revision, and kept in
// step by backend/branch-sync.ts and the live room.
//
// Failure modes, written before the code (brief numbers in brackets):
//   R1 [1, 9]  A creates `idea` and edits it. B's Branches panel lists `idea`
//              without a reload; the record is on disk; main saves afterwards
//              (edits and autosaves on main) never erase it.
//   R2 [7, 8]  B reloads: lands on main, and `idea` loads from the server.
//   R3         B opens `idea` and sees A's edit.
//   R4 [4]     A and B edit `idea` at the same time (different boxes): both
//              edits survive, on both screens and in the record.
//   R5 [5]     A save naming a stale revision gets 409 and changes nothing.
//   R6 [10, 11] `main` or an invalid id as a branch: 400. A branch with
//              `_meta/` or a path outside the project: 400. Nothing written.
//   R7 [6]     A edits `idea` and closes the tab within the save debounce:
//              the edit is on the server.
//   R8         Deleting `idea` on A removes it from B's panel; B, if on it,
//              is moved to main.
//
// Artifact: test-results/selfhosted/branch-records/summary.json (written even
// when a step fails), screenshots per step, one trace and video per person.

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN, SITES, signIn, closePerson, openSite, deleteBox, deleteBoxUntilGone, canvasIds, idsIn,
  createBranch, switchTo, openBranchesPanel, logLines, waitForLog, type Person,
} from './helpers';

const SITE = 'records';
const CY = 'cy@e2e.test';
const SITE_DIR = path.join(SITES, SITE);
const RECORD = (id: string) => path.join(SITE_DIR, '_revyme', 'branches', `${id}.json`);
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'test-results', 'selfhosted', 'branch-records');

const mainOnDisk = () => idsIn(fs.readFileSync(path.join(SITE_DIR, 'app', 'page.client.tsx'), 'utf8'));

function recordOnDisk(id: string): { revision: number; files: Record<string, string> } | null {
  if (!fs.existsSync(RECORD(id))) return null;
  return JSON.parse(fs.readFileSync(RECORD(id), 'utf8'));
}

/** The branch page's data-ids as the server stores them. */
function recordPageIds(id: string): string[] | null {
  const rec = recordOnDisk(id);
  const hash = rec?.files['app/page.client.tsx'];
  if (!hash) return null;
  return idsIn(fs.readFileSync(path.join(SITE_DIR, '_revyme', 'blobs', hash), 'utf8'));
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

async function branchListed(page: Page, id: string): Promise<boolean> {
  await openBranchesPanel(page);
  return page.getByText(id, { exact: true }).first().isVisible().catch(() => false);
}

test('branches are server records: shared live, never erased by saves, merged on concurrent edits', async ({ browser }) => {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const summary: Record<string, unknown> = { site: SITE, result: 'fail' };
  const save = () => fs.writeFileSync(path.join(ARTIFACTS, 'summary.json'), JSON.stringify(summary, null, 2));
  const people: Person[] = [];

  try {
    const a = await signIn(browser, ADMIN, ARTIFACTS);
    people.push(a);
    const invite = await a.context.request.post(`/api/websites/${SITE}/collaborators`, { data: { email: CY, role: 'editor' } });
    expect(invite.status()).toBe(200);
    const b = await signIn(browser, CY, ARTIFACTS);
    people.push(b);
    const since = logLines().length;
    await Promise.all([openSite(a.page, SITE), openSite(b.page, SITE)]);
    await waitForLog(since, (l) => l.category === 'rt:joined' && l.data.siteId === SITE && l.data.members === 2);
    const all = ['root', 'h', 'i', 'j', 'k', 'l'];

    // ── R1 ──
    await openBranchesPanel(b.page);
    await createBranch(a.page, 'idea');
    await deleteBoxUntilGone(a.page, 'i');
    await expect.poll(() => canvasIds(a.page)).toEqual(['root', 'h', 'j', 'k', 'l']);
    await expect.poll(() => recordPageIds('idea'), { message: 'R1: the record holds the branch edit' }).toEqual(['root', 'h', 'j', 'k', 'l']);
    await expect.poll(() => branchListed(b.page, 'idea'), { message: 'R1: B lists idea without a reload' }).toBe(true);
    await shot(b.page, 'r1-b-panel-lists-idea');
    // Main moves on and saves, from both tabs; the branch record must survive it.
    await switchTo(a.page, 'main');
    await deleteBoxUntilGone(b.page, 'l');
    await expect.poll(() => mainOnDisk(), { timeout: 30_000 }).toEqual(['root', 'h', 'i', 'j', 'k']);
    await a.page.waitForTimeout(6_000);
    summary.R1 = { record: recordOnDisk('idea')?.revision ?? null, recordPage: recordPageIds('idea'), mainOnDisk: mainOnDisk() };
    save();
    expect(recordPageIds('idea'), 'R1: main saves did not erase or rewind the branch').toEqual(['root', 'h', 'j', 'k', 'l']);

    // ── R2 / R3 ──
    await openSite(b.page, SITE);
    await expect.poll(() => canvasIds(b.page), { message: 'R2: a reload lands on main' }).toEqual(['root', 'h', 'i', 'j', 'k']);
    expect(await branchListed(b.page, 'idea'), 'R2: idea loads from the server').toBe(true);
    await switchTo(b.page, 'idea');
    await expect.poll(() => canvasIds(b.page), { message: 'R3: B sees the branch edit' }).toEqual(['root', 'h', 'j', 'k', 'l']);
    summary.R2R3 = { bOnIdea: await canvasIds(b.page) };
    await shot(b.page, 'r3-b-on-idea');

    // ── R4: concurrent edits of the same branch ──
    await switchTo(a.page, 'idea');
    await Promise.all([deleteBoxUntilGone(a.page, 'h'), deleteBoxUntilGone(b.page, 'l', { x: 0.7, y: 0.7 })]);
    const merged = ['root', 'j', 'k'];
    await expect.poll(() => recordPageIds('idea'), { timeout: 20_000, message: 'R4: the record has both edits' }).toEqual(merged);
    await expect.poll(() => canvasIds(a.page), { timeout: 20_000 }).toEqual(merged);
    await expect.poll(() => canvasIds(b.page), { timeout: 20_000 }).toEqual(merged);
    summary.R4 = { record: recordPageIds('idea'), a: await canvasIds(a.page), b: await canvasIds(b.page) };
    save();
    await shot(a.page, 'r4-a-merged');
    await shot(b.page, 'r4-b-merged');

    // ── R5: a stale revision is refused ──
    const current = recordOnDisk('idea')!.revision;
    const stale = await a.context.request.put(`/api/sites/${SITE}/branches/idea`, {
      data: { baseRevision: current - 1, files: { set: { 'app/page.client.tsx': '// stale' }, del: [] } },
    });
    expect(stale.status(), 'R5: stale revision → 409').toBe(409);
    expect(recordOnDisk('idea')!.revision, 'R5: nothing written').toBe(current);
    expect(recordPageIds('idea')).toEqual(merged);

    // ── R6: invalid ids and paths ──
    const bad = [
      await a.context.request.put(`/api/sites/${SITE}/branches/main`, { data: { baseRevision: null, files: { set: {} } } }),
      await a.context.request.put(`/api/sites/${SITE}/branches/Bad_Id`, { data: { baseRevision: null, files: { set: {} } } }),
      await a.context.request.put(`/api/sites/${SITE}/branches/idea`, { data: { baseRevision: current, files: { set: { '_meta/page-camera.json': '{}' } } } }),
      await a.context.request.put(`/api/sites/${SITE}/branches/idea`, { data: { baseRevision: current, files: { set: { '../escape.txt': 'x' } } } }),
    ];
    summary.R6 = bad.map((r) => r.status());
    save();
    for (const r of bad) expect(r.status(), 'R6: refused with 400').toBe(400);
    expect(recordOnDisk('idea')!.revision, 'R6: nothing written').toBe(current);
    expect(fs.existsSync(RECORD('main'))).toBe(false);

    // ── R7: closing the tab inside the debounce still saves ──
    // A plain delete (no waiting for the canvas): leave while it is still in flight.
    await deleteBox(a.page, 'k');
    await a.page.goto('about:blank'); // leaves at once — well inside the 400 ms debounce
    await expect.poll(() => recordPageIds('idea'), { timeout: 15_000, message: 'R7: the unload flush saved it' }).toEqual(['root', 'j']);
    summary.R7 = { record: recordPageIds('idea') };
    save();

    // ── R8: deleting a branch reaches the other tab ──
    const del = await a.context.request.delete(`/api/sites/${SITE}/branches/idea`);
    expect(del.status()).toBe(200);
    await expect.poll(() => branchListed(b.page, 'idea'), { message: 'R8: idea leaves B’s panel' }).toBe(false);
    await expect.poll(() => canvasIds(b.page), { message: 'R8: B is moved back to main' }).toEqual(['root', 'h', 'i', 'j', 'k']);
    expect(fs.existsSync(RECORD('idea'))).toBe(false);
    summary.R8 = { bCanvas: await canvasIds(b.page) };
    await shot(b.page, 'r8-b-back-on-main');
    summary.result = 'pass';
  } finally {
    save();
    for (const p of people) await closePerson(p, ARTIFACTS).catch(() => {});
  }
});
