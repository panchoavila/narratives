import { test, expect, project } from '../../fixtures/test';
import { ALTERNATING_ROWS_COMPONENT } from '../../../src/code/project/default-code-components/AlternatingRows';

test('REAL-009 alternating native CMS rows edit, undo, reopen and preview', async ({ page, editor }) => {
  await editor.load(project().page(`<main data-id="root" style={{ width: '100%' }}><AlternatingRows data-id="alternating" targetId="list" itemTargetId="article" parity="even" direction="row-reverse" style={{ position: 'relative', width: '100%' }}><div data-id="list" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>{posts.map((item, idx) => (<div data-id="row" key={idx} style={{ position: 'relative', width: '100%' }}><article data-id="article" style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100px' }}><p data-id="title">{item.title}</p><p data-id="description">{item.description}</p></article></div>))}</div></AlternatingRows></main>`, { imports: ["import AlternatingRows from '@/components/AlternatingRows';", "import posts from '@/cms/posts.json';"], tiles: [{ id: 'desktop', label: 'Desktop', width: 1200 }] }).file('components/AlternatingRows.tsx', ALTERNATING_ROWS_COMPONENT)
    .file('cms/posts.schema.json', JSON.stringify({ slug: 'posts', name: 'Posts', fields: [{ id: 'title', name: 'Title', type: 'text' }, { id: 'description', name: 'Description', type: 'text' }] }))
    .file('cms/posts.json', JSON.stringify([{ _id: 'one', title: 'Uno', description: 'Primero' }, { _id: 'two', title: 'Dos', description: 'Segundo' }])).build());
  const articles = editor.sandbox().locator('[data-revyme-alternating-rows] article');
  await expect(articles).toHaveCount(2);
  await expect(articles.nth(0)).toHaveCSS('flex-direction', 'row');
  await expect(articles.nth(1)).toHaveCSS('flex-direction', 'row-reverse');
  await editor.select(['alternating']);
  const before = await editor.code();
  await page.getByText('Rows', { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]').getByRole('combobox').selectOption('odd');
  await expect(articles.nth(0)).toHaveCSS('flex-direction', 'row-reverse');
  await expect(articles.nth(1)).toHaveCSS('flex-direction', 'row');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect(articles.nth(0)).toHaveCSS('flex-direction', 'row-reverse');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe').locator('[data-revyme-alternating-rows] article');
  await expect(preview.nth(0)).toHaveCSS('flex-direction', 'row-reverse');
  await expect(preview.nth(1)).toHaveCSS('flex-direction', 'row');
  await expect(editor).toPassOracle();
});
