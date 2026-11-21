import { test, expect, project } from '../../fixtures/test';
import { ADVANCED_FRAME_COMPONENT } from '../../../src/code/project/default-code-components/AdvancedFrame';
import sharp from 'sharp';

const mask = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><path fill="white" d="M0 0h100v100H0z"/><path fill="black" d="M100 0h100v100H100z"/></svg>').toString('base64');

test('REAL-007 composition mask affects live content and survives controls, undo and reload', async ({ page, editor }, info) => {
  await editor.load(project().page(`<main data-id="root" style={{ position: 'relative', width: '100%', minHeight: '500px', display: 'flex', padding: '80px', backgroundColor: '#ffffff' }}>
    <AdvancedFrame data-id="masked" cornerStyle="none" compositionMaskImage={${JSON.stringify(mask)}} compositionMaskMode="alpha" compositionMaskSizing="stretch" style={{ position: 'relative', width: '400px', height: '200px', backgroundColor: '#ff0000' }}>
      <div data-id="live-content" style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#00ff00' }}>Contenido vivo</div>
    </AdvancedFrame>
  </main>`, { imports: ["import AdvancedFrame from '@/components/AdvancedFrame';"] }).file('components/AdvancedFrame.tsx', ADVANCED_FRAME_COMPONENT).build());
  let frame = editor.sandbox().locator('[data-revyme-advanced-frame]');
  await expect(frame).toHaveCSS('mask-mode', 'alpha');
  const pixelSample = async (name: string, fraction: number) => {
    const pixels = await sharp(await frame.screenshot({ path: info.outputPath(name), animations: 'disabled' })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const x = Math.floor(pixels.info.width * fraction), y = Math.floor(pixels.info.height * 0.75);
    return Array.from(pixels.data.subarray((y * pixels.info.width + x) * 4, (y * pixels.info.width + x) * 4 + 3));
  };
  const unmaskedColor = await pixelSample('alpha-mask.png', 0.25);
  await editor.select(['masked']);
  const row = (name: string) => page.getByText(name, { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  await row('Composition mask').getByRole('button').click();
  const before = await editor.code();
  await row('Mode').getByRole('combobox').selectOption('luminance', { timeout: 15000 });
  await page.keyboard.press('Escape');
  await expect(frame).toHaveCSS('mask-mode', 'luminance');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect(frame).toHaveCSS('mask-mode', 'luminance');
  // Compare the published composition, independent of the editor's selection
  // overlays and viewport entrance fade after reopening the document.
  await page.locator('[data-tutorial="header-preview-button"]').click();
  frame = page.frameLocator('[data-preview-overlay] iframe').locator('[data-revyme-advanced-frame]');
  await expect(frame).toHaveCSS('mask-mode', 'luminance');
  // The green child is masked along with its red parent; the black half reveals the white page.
  expect(await pixelSample('composition-mask.png', 0.25)).toEqual(unmaskedColor);
  expect(await pixelSample('composition-mask-right.png', 0.75)).toEqual([255, 255, 255]);
  await expect(editor).toPassOracle();
});
