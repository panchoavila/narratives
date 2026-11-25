// Deleting on the canvas demo (sites/canvas), a page that wraps one object in
// `<RevymeVhs>`. Every flush rebuilds the page's `@revyme/runtime` import from
// `buildAutoImports`; with `RevymeVhs` missing there, each flush dropped the
// import and validation refused every edit on the page ("References undefined
// identifier: RevymeVhs", live find 2026-11-24).
//
// Failure modes, written before the fix and this spec:
//   F1 the flush drops the `RevymeVhs` import and validation refuses the delete;
//   F4 the import comes back twice (duplicate binding blanks the page);
//   F5 after the lift/restore `sample-vhs` is not wrapped exactly once;
//   F6 the node leaves the canvas but not the source;
//   F7 one undo does not restore the file byte for byte, on disk too;
//   F8 a refused batch is logged even though a later write lands;
//   F9 deleting the wrapped object leaves an empty wrapper or its import;
//   F10 the run leaves the checkout dirty (camera, project meta, the page).

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/test';
import { openSite, preserveSiteState } from '../../helpers/scene-inspection';
import type { Editor } from '../../helpers/editor';

const SITE = 'canvas';
const PAGE = 'app/page.client.tsx';
const DISK = path.resolve('sites', SITE, PAGE);
const RUNTIME_IMPORT = "import { RevymeVhs } from '@revyme/runtime';";

/** Everything above the component: the imports and the `@canvas` annotation. */
const head = (code: string) => code.slice(0, code.indexOf('export default function'));
const ids = (code: string) => [...code.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
const count = (code: string, needle: string) => code.split(needle).length - 1;

/** The batches validation refused since the page opened (F1, F8). */
function refusals(editor: Editor): Promise<unknown[]> {
  return editor.page().evaluate(() =>
    (window as unknown as { __e2e: { traceEntries(pattern: string): unknown[] } }).__e2e.traceEntries('mutation-queue:validation-failed'));
}

/** Waits until the editor has written `code` to the page's file on disk. */
async function expectOnDisk(code: string): Promise<void> {
  await expect.poll(() => fs.readFileSync(DISK, 'utf8'), { timeout: 10_000 }).toBe(code);
}

test.describe('deleting on the canvas demo', () => {
  let restoreSite: () => void = () => {};
  let original = '';
  test.beforeAll(() => {
    restoreSite = preserveSiteState(SITE);
    original = fs.readFileSync(DISK, 'utf8');
  });
  // F10: a failing run must not leave a half-deleted page behind.
  test.afterEach(() => {
    if (fs.readFileSync(DISK, 'utf8') !== original) fs.writeFileSync(DISK, original);
  });
  test.afterAll(() => restoreSite());

  test('CANVAS-DEMO-001 a clicked leaf deletes, commits and undoes byte for byte', { tag: ['@p1', '@crud'] }, async ({ page, editor }, info) => {
    await openSite(page, editor, SITE);
    const before = await editor.code(PAGE);
    expect(before, 'the editor opened the page as it is on disk').toBe(original);
    expect(before).toContain(RUNTIME_IMPORT);

    await editor.click('circle-cut');
    expect(await editor.selection()).toEqual(['circle-cut']);
    await page.keyboard.press('Delete');

    // F6: the source loses the node, not just the canvas.
    await expect.poll(() => editor.exists('circle-cut', PAGE)).toBe(false);
    await editor.settled();
    const after = await editor.code(PAGE);
    expect(await refusals(editor), 'validation refused a batch').toEqual([]);
    // F1 + F4: the runtime import survives the flush, exactly once, and no
    // source is imported twice. (The first flush puts the rest of the block in
    // the editor's canonical form — `'use client'`, `import React, …` — which
    // is why undo, not this, is the byte-for-byte check.)
    const imports = head(after).split('\n').filter((line) => line.startsWith('import '));
    expect(imports.filter((line) => line.includes('@revyme/runtime'))).toEqual([RUNTIME_IMPORT]);
    expect(new Set(imports.map((line) => line.slice(line.lastIndexOf(' from ')))).size).toBe(imports.length);
    expect(count(after, 'RevymeVhs }')).toBe(1);
    expect(head(after)).toContain('/** @canvas {');
    // Only `circle-cut` left the file; its parent stayed.
    expect(ids(before).filter((id) => !ids(after).includes(id))).toEqual(['circle-cut']);
    expect(ids(after)).toContain('circle-plane');
    // F5: the VHS object is still wrapped, once, by the same wrapper.
    expect(count(after, '<RevymeVhs>')).toBe(1);
    expect(count(after, '</RevymeVhs>')).toBe(1);
    expect(after).toContain('<RevymeVhs><button type="button" data-id="sample-vhs"');
    await expectOnDisk(after);
    await page.screenshot({ path: info.outputPath('canvas-demo-deleted.png') });

    // F7: one undo restores the exact bytes; one redo re-applies the delete.
    await expect(editor).toUndoInOneStep(before, { path: PAGE });
    await editor.undo();
    await expect.poll(() => editor.code(PAGE)).toBe(before);
    await expectOnDisk(original);
    expect(await refusals(editor)).toEqual([]);
    await page.screenshot({ path: info.outputPath('canvas-demo-undone.png') });
  });

  test('CANVAS-DEMO-002 deleting the VHS object takes its wrapper and import with it', { tag: ['@p1', '@crud'] }, async ({ page, editor }) => {
    await openSite(page, editor, SITE);
    const before = await editor.code(PAGE);
    expect(before).toBe(original);

    await editor.select(['sample-vhs']);
    expect(await editor.selection()).toEqual(['sample-vhs']);
    await page.keyboard.press('Delete');

    await expect.poll(() => editor.exists('sample-vhs', PAGE)).toBe(false);
    await editor.settled();
    const after = await editor.code(PAGE);
    expect(await refusals(editor), 'validation refused a batch').toEqual([]);
    // F9: no empty wrapper, no import of a wrapper nothing uses.
    expect(after).not.toContain('RevymeVhs');
    expect(after).not.toContain('@revyme/runtime');
    expect(ids(after)).toContain('effects-grid');
    await expectOnDisk(after);

    await expect(editor).toUndoInOneStep(before, { path: PAGE });
    await editor.undo();
    await expect.poll(() => editor.code(PAGE)).toBe(before);
    await expectOnDisk(original);
  });
});
