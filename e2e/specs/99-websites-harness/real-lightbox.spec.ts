import { test, expect, project } from '../../fixtures/test';
import { IMAGE_LIGHTBOX_COMPONENT } from '../../../src/code/project/default-code-components/ImageLightbox';

test('REAL-008 image lightbox edits, reopens and restores keyboard focus after Escape', async ({ page, editor }) => {
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><path fill="lime" d="M0 0h800v600H0z"/></svg>');
  await editor.load(project().page(`<main data-id="root" style={{ width: '100%', padding: '40px' }}><ImageLightbox data-id="image" src={${JSON.stringify(image)}} alt="Proyecto REAL" closeLabel="Cerrar imagen" maxWidth={960} style={{ position: 'relative', width: '320px', height: '240px' }} /></main>`, { imports: ["import ImageLightbox from '@/components/ImageLightbox';"], tiles: [{ id: 'desktop', label: 'Desktop', width: 1200 }] }).file('components/ImageLightbox.tsx', IMAGE_LIGHTBOX_COMPONENT).build());
  await editor.select(['image']);
  const row = page.getByText('Modal max width', { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  const before = await editor.code();
  await row.locator('input').last().fill('700');
  await row.locator('input').last().press('Enter');
  await expect.poll(() => editor.attr('image', 'maxWidth')).toBe('700');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect(editor.sandbox().locator('dialog')).not.toBeVisible();
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const trigger = preview.getByRole('link', { name: 'Proyecto REAL' });
  await trigger.focus(); await trigger.press('Enter');
  const dialog = preview.getByRole('dialog', { name: 'Proyecto REAL' });
  await expect(dialog).toBeVisible(); await expect(dialog).toHaveCSS('max-width', '700px');
  await preview.getByRole('button', { name: 'Cerrar imagen' }).press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await expect(editor).toPassOracle();
});
