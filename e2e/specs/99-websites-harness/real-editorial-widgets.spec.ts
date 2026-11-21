import { test, expect, project } from '../../fixtures/test';
import { GALLERY_TRAIL_COMPONENT } from '../../../src/code/project/default-code-components/GalleryTrail';
import { READING_TIME_COMPONENT } from '../../../src/code/project/default-code-components/ReadingTime';

test('reading time survives editing, undo, reopen, preview and source export', async ({ page, editor }) => {
  const source = project().page(`<main data-id="root" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
    <ReadingTime data-id="reading" html="uno dos tres cuatro cinco seis" wordsPerMinute={3} style={{ position: 'relative', flex: '0 0 auto', width: '320px' }} />
  </main>`, { imports: ["import ReadingTime from '@/components/ReadingTime';"], tiles: [{ id: 'desktop', label: 'Desktop', width: 1200 }] })
    .file('components/ReadingTime.tsx', READING_TIME_COMPONENT).build();
  await editor.load(source);
  await expect(editor.sandbox().locator('[data-revyme-reading-time]')).toContainText('LECTURA 2 MINUTOS');
  await editor.select(['reading']);
  const row = page.getByText('Words per minute', { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  const before = await editor.code();
  await row.locator('input').last().fill('6');
  await row.locator('input').last().press('Enter');
  await expect.poll(() => editor.attr('reading', 'wordsPerMinute')).toBe('6');
  await expect(editor.sandbox().locator('[data-revyme-reading-time]')).toContainText('LECTURA 1 MINUTOS');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect.poll(() => editor.attr('reading', 'wordsPerMinute')).toBe('6');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  await expect(page.frameLocator('[data-preview-overlay] iframe').locator('[data-revyme-reading-time]')).toContainText('LECTURA 1 MINUTOS');
  const exported = await page.evaluate(async files => {
    const { buildSourceExport } = await import(/* @vite-ignore */ '/src/code/project/source-export.ts');
    return buildSourceExport(files, { name: 'Editorial', runtimeRange: '^0.0.32' });
  }, await editor.snapshotFiles());
  expect(exported.files['app/page.client.tsx']).toContain('wordsPerMinute={6}');
  expect(exported.files['components/ReadingTime.tsx']).toContain('RevymeReadingTime');
});

test('gallery trail keeps its editable CMS slot through reopen and preview', async ({ page, editor }) => {
  const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>');
  const source = project().page(`<main data-id="root" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
    <div data-id="target" style={{ position: 'relative', flex: '0 0 auto', order: '0', width: '600px', height: '300px', backgroundColor: '#eeeeee' }} />
    <GalleryTrail data-id="trail" targetId="target" style={{ position: 'relative', flex: '0 0 auto', order: '1', width: '600px', height: '200px' }} />
  </main>`, { imports: ["import GalleryTrail from '@/components/GalleryTrail';"], tiles: [{ id: 'desktop', label: 'Desktop', width: 800 }] })
    .file('components/GalleryTrail.tsx', GALLERY_TRAIL_COMPONENT)
    .file('cms/projects.schema.json', JSON.stringify({ name: 'Projects', slug: 'projects', fields: [{ id: 'name', name: 'Name', type: 'text' }, { id: 'photo', name: 'Photo', type: 'image' }] }))
    .file('cms/projects.json', JSON.stringify([{ _id: 'one', name: 'Alpha', photo: cover }, { _id: 'two', name: 'Beta', photo: cover }])).build();
  await editor.load(source); await editor.select(['trail']);
  const select = page.locator('[data-collection-slot-controls] select');
  await expect(select).toBeVisible();
  await select.selectOption('projects');
  const trail = editor.sandbox().locator('[data-revyme-gallery-trail]');
  await expect(trail.locator('[data-gallery-trail-source]')).toContainText('Alpha');
  await expect(trail.locator('[data-gallery-trail-source]')).toContainText('Beta');
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect(trail.locator('[data-gallery-trail-source]')).toContainText('Alpha');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const target = preview.locator('[data-id="target"]');
  await target.hover({ position: { x: 20, y: 20 } });
  await target.hover({ position: { x: 120, y: 80 } });
  await expect(preview.locator('[data-revyme-gallery-trail] > img').first()).toBeVisible();
});
