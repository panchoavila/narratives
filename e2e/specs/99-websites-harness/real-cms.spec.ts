import { test, expect, project } from '../../fixtures/test';
import { canvasHeader } from '../../fixtures/project';
import { CMS_CONTENT_COMPONENT } from '../../../src/code/project/default-code-components/CMSContent';

const body = '<h2>Una marca real</h2><p>Contenido <strong>inolvidable</strong> y <em>auténtico</em>.</p><ul><li><p>Identidad</p></li><li><p>Cultura</p></li></ul><p><a href="https://example.com/">Example</a></p>';
const seed = () => project().pageSource(`'use client';
${canvasHeader()}
/** @cmsPage { "collection": "articles", "kind": "detail" } */
import { useParams } from 'next/navigation';
import articles from '@/cms/articles.json';
import CMSContent from '@/components/CMSContent';
export default function Page() {
  const params = useParams();
  const item = articles.find(i => i._slug === params?.slug) ?? articles[0];
  return <article data-id="root" style={{ position: 'relative', width: '100%', padding: '40px', backgroundColor: '#edf2ed' }}>
    <CMSContent data-id="body" html={item.body} style={{ position: 'relative', width: '700px', color: '#262626', fontSize: '18px', lineHeight: '1.5' }} />
  </article>;
}`)
  .file('components/CMSContent.tsx', CMS_CONTENT_COMPONENT)
  .file('cms/articles.schema.json', JSON.stringify({ name: 'Articles', slug: 'articles', fields: [{ id: 'title', name: 'Title', type: 'text' }, { id: 'body', name: 'Body', type: 'richtext' }] }))
  .file('cms/articles.json', JSON.stringify([{ _id: 'article', _slug: 'marca-real', _status: 'published', title: 'Una marca real', body }])).build();

test('REAL-003 CMS rich text retains paragraphs, lists, marks and links after editing and reopening', async ({ page, editor }, info) => {
  // This harness deliberately disables the AI service; opening CMS can probe its engine list.
  editor.allowErrors(/^Failed to load resource: net::ERR_UNSAFE_PORT$/);
  await editor.load(seed());
  const content = editor.sandbox().locator('[data-revyme-rich-content]');
  await expect(content.getByRole('heading', { name: 'Una marca real' })).toBeVisible();
  await expect(content.locator('strong')).toHaveText('inolvidable');
  await expect(content.locator('li')).toHaveCount(2);
  expect(await editor.oracle('components/CMSContent.tsx')).toEqual([]);
  await page.goto('/?cms=articles&item=article&field=body');
  const field = page.locator('[data-cms-rich-field="body"]');
  await expect(field.locator('h2')).toHaveText('Una marca real');
  await field.locator(':scope > p').last().click();
  await field.press('End');
  await field.pressSequentially(' Preservamos el contenido.');
  await page.getByRole('button', { name: 'Fields', exact: true }).click();
  await expect.poll(async () => JSON.parse(await editor.readFile('cms/articles.json'))[0].body).toContain('Preservamos el contenido.');
  await page.screenshot({ path: info.outputPath('cms-editor.png') });
  await page.goto('/');
  await editor.waitForCanvas();
  await editor.settled();
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  await expect(preview.getByRole('heading', { name: 'Una marca real' })).toBeVisible();
  await expect(preview.locator('[data-revyme-rich-content] strong')).toHaveText('inolvidable');
  await expect(preview.locator('[data-revyme-rich-content] li')).toHaveCount(2);
  await expect(preview.locator('[data-revyme-rich-content]')).toContainText('Preservamos el contenido.');
  await page.screenshot({ path: info.outputPath('cms-preview.png') });
});

test('REAL-004 rich content drops executable markup and keeps the readable document', async ({ page, editor }) => {
  const input = seed();
  const rows = JSON.parse(input.files['cms/articles.json']);
  rows[0].body = '<p>Texto seguro</p><script>window.__bad=1</script><a href="jav&#x61;script:alert(1)">Enlace</a><img src=x onerror="window.__bad=1">';
  input.files['cms/articles.json'] = JSON.stringify(rows);
  await editor.load(input);
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const content = preview.locator('[data-revyme-rich-content]');
  await expect(content.getByText('Texto seguro', { exact: true })).toBeVisible();
  await expect(content.locator('script,img')).toHaveCount(0);
  await expect(content.locator('a')).not.toHaveAttribute('href');
});
