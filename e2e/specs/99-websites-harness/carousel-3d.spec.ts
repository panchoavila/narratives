import { test, expect, project } from '../../fixtures/test';
import { CAROUSEL_3D_COMPONENT } from '../../../src/code/project/default-code-components/Carousel3D';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('uses native Gap and an editable CMS template that follows collection changes', async ({ page, editor }, info) => {
  const cover = (color: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="${color}"/><circle cx="120" cy="70" r="42" fill="#ffffff88"/></svg>`);
  const seed = project().page(`<main data-id="root" style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#f6f5f0' }}>
    <Carousel3D data-id="carousel" style={{ width: '100%', height: '600px' }} />
  </main>`, { tiles: [{ id: 'desktop', label: 'Desktop', width: 800 }], imports: ["import Carousel3D from '@/components/Carousel3D';"] })
    .file('components/Carousel3D.tsx', CAROUSEL_3D_COMPONENT)
    .file('app/layout.tsx', `import { Providers } from './providers';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}`)
    .file('app/providers.tsx', `'use client';
import { MotionConfig } from 'framer-motion';
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}`)
    .file('cms/projects.schema.json', JSON.stringify({ name: 'Projects', slug: 'projects', fields: [
      { id: 'name', name: 'Name', type: 'text' }, { id: 'photo', name: 'Photo', type: 'image' },
    ] }))
    .file('cms/projects.json', JSON.stringify([
      { _id: 'one', name: 'Alpha', photo: cover('#5166bc') }, { _id: 'two', name: 'Beta', photo: cover('#dc9c7c') },
    ]))
    .file('cms/people.schema.json', JSON.stringify({ name: 'People', slug: 'people', fields: [
      { id: 'title', name: 'Title', type: 'text' }, { id: 'cover', name: 'Cover', type: 'image' },
    ] }))
    .file('cms/people.json', JSON.stringify([{ _id: 'person', title: 'A different collection', cover: '/narratives-icon.svg' }])).build();
  await editor.load(seed);
  await editor.select(['carousel']);
  const row = (label: string) => page.getByText(label, { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  await row('Geometry').getByRole('button').click();
  await row('Distribution').locator('select').selectOption('gap');
  await row('Gap').locator('input').last().fill('32');
  await row('Gap').locator('input').last().press('Enter');
  await expect.poll(() => editor.attr('carousel', 'gap')).toBe('32');
  expect(await editor.code()).toContain('gap={32}');
  await page.keyboard.press('Escape');

  const before = await editor.code();
  await page.locator('[data-collection-slot-controls] select').selectOption('projects');
  const carousel = editor.sandbox().locator('[data-revyme-carousel-3d]');
  await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(2);
  await expect(carousel).toContainText('Alpha');
  await expect(carousel).toContainText('Beta');
  await expect(editor).toUndoInOneStep(before);
  await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(2);

  await page.evaluate(async () => {
    const cms = await import(/* @vite-ignore */ '/src/code/project/cms-ops.ts');
    cms.updateCollectionItem('projects', 'one', { name: 'Updated Alpha' });
    cms.addCollectionItem('projects', { name: 'Gamma', photo: '' });
    // CMS Editor commits use this same refresh boundary after the data write.
    const { bumpProjectVersion } = await import(/* @vite-ignore */ '/src/code/project/modify-file.ts');
    bumpProjectVersion();
  });
  await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(3);
  await expect(carousel).toContainText('Updated Alpha');
  await expect(carousel).toContainText('Gamma');

  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  const templateId = await page.evaluate(async () => {
    const { getNodesSnapshot } = await import(/* @vite-ignore */ '/src/code/stores/store.ts');
    const list = [...getNodesSnapshot().values()].find(node => node.attrs?.['data-revyme-collection-slot'] !== undefined);
    return list!.collectionList!.templateIds.default;
  });
  await page.evaluate(async id => {
    const { queueMutation, flushNow } = await import(/* @vite-ignore */ '/src/code/mutation/mutation-queue.ts');
    queueMutation({ type: 'updateStyles', nodeId: id, styles: { backgroundColor: '#f1e4d4', padding: '12px' } });
    flushNow();
  }, templateId);
  await expect.poll(() => carousel.locator('[data-revyme-carousel-slot]').first().locator(':scope > *').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(241, 228, 212)');
  await editor.select(['carousel']);
  await expect(editor).toPassOracle();
  await page.locator('[data-collection-slot-controls] select').selectOption('people');
  await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(1);
  await expect(carousel).toContainText('A different collection');
  await expect(carousel.locator('[role="img"]')).toHaveCSS('background-image', /narratives-icon/);
  await page.locator('[data-collection-slot-controls] select').selectOption('projects');
  await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(3);
  await page.evaluate(async () => {
    const { getContentRoot } = await import(/* @vite-ignore */ '/src/canvas/node-ops.ts');
    const { zoomToFitSelection } = await import(/* @vite-ignore */ '/src/canvas/transform/CameraCommands.ts');
    zoomToFitSelection(getContentRoot()!, ['carousel'], true);
  });
  const transforms = () => carousel.locator('[data-revyme-carousel-slot]').evaluateAll(elements => elements.map(el => (el as HTMLElement).style.transform));
  let previous = await transforms();
  for (const surface of ['sphere', 'line', 'cylinder']) {
    await row('Surface').locator('select').selectOption(surface);
    await row('Geometry').getByRole('button').click();
    await row('Rows').locator('input').last().fill(surface === 'sphere' ? '2' : '1');
    await row('Rows').locator('input').last().press('Enter');
    await expect.poll(async () => (await editor.attr('carousel', 'layout')) ?? 'cylinder').toBe(surface);
    await expect.poll(async () => (await editor.attr('carousel', 'rows')) ?? '1').toBe(surface === 'sphere' ? '2' : '1');
    await expect(row('Distribution').locator('select')).toHaveValue('gap');
    await expect(row('Gap').locator('input').last()).toHaveValue('32');
    await expect.poll(transforms).not.toEqual(previous);
    await expect(carousel).toContainText('Updated Alpha');
    await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(3);
    previous = await transforms();
    expect(new Set(previous).size).toBe(3);
    expect(previous.join(' ')).not.toMatch(/NaN|Infinity/);
    if (surface === 'line') {
      const spacing = () => carousel.locator('[data-revyme-carousel-slot]').evaluateAll(elements => {
        const centers = elements.map(el => {
          const style = getComputedStyle(el);
          return new DOMPoint(parseFloat(style.width) / 2, parseFloat(style.height) / 2).matrixTransform(new DOMMatrix(style.transform));
        });
        return centers[1].x - centers[0].x;
      });
      await expect.poll(spacing).toBeCloseTo(182);
    }
    await page.screenshot({ path: info.outputPath(`cms-gap-${surface}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: info.outputPath('cms-controls.png') });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('revyme-project-local') || '')).toContain('Updated Alpha');
  await page.reload();
  await editor.waitForCanvas();
  await expect(carousel.locator('[data-revyme-carousel-slot]')).toHaveCount(3);
  await expect(carousel).toContainText('Updated Alpha');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  await expect(preview.locator('[data-revyme-carousel-slot]')).toHaveCount(3);
  await expect(preview.locator('[data-revyme-carousel-3d]')).toContainText('Updated Alpha');
  await page.screenshot({ path: info.outputPath('cms-preview.png') });
  const originalData = await page.evaluate(async () => {
    const cms = await import(/* @vite-ignore */ '/src/code/project/cms-ops.ts');
    const { bumpProjectVersion } = await import(/* @vite-ignore */ '/src/code/project/modify-file.ts');
    const previous = cms.getCollectionData('projects');
    cms.saveCollectionData('projects', []);
    bumpProjectVersion();
    return previous;
  });
  await expect(preview.locator('[data-revyme-carousel-slot]')).toHaveCount(0);
  await expect(preview.locator('[data-revyme-carousel-3d]')).toContainText('No items in this collection');
  await page.evaluate(async data => {
    const cms = await import(/* @vite-ignore */ '/src/code/project/cms-ops.ts');
    const { bumpProjectVersion } = await import(/* @vite-ignore */ '/src/code/project/modify-file.ts');
    cms.saveCollectionData('projects', data.reverse());
    bumpProjectVersion();
  }, originalData);
  await expect(preview.locator('[data-revyme-carousel-slot]')).toHaveCount(3);
  await expect(preview.locator('[data-revyme-carousel-slot]').first()).toContainText('Gamma');
  const files = await editor.snapshotFiles();
  const exported = await page.evaluate(async input => {
    const { buildSourceExport } = await import(/* @vite-ignore */ '/src/code/project/source-export.ts');
    return buildSourceExport(input, { name: 'CMS spatial carousel', runtimeRange: '^0.0.32' });
  }, files);
  for (const [file, content] of Object.entries(exported.files)) {
    const destination = path.join(info.outputPath('export'), file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content as string);
  }
});

for (const shape of ['cylinder', 'sphere'] as const) {
  test(`inspects the ${shape} volume through the editor camera`, async ({ page, editor }, info) => {
    const rows = shape === 'sphere' ? 5 : 1;
    const count = rows * 12;
    const cards = Array.from({ length: count }, (_, i) =>
      `const cn_spatial_${i} = <div data-id="spatial-${i}" data-canvas-node="true"
        style={{ position: 'absolute', left: '-5000px', top: '${i * 180}px', width: '110px', height: '140px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '24px', color: '#102315', background: '${['#d2ef69', '#849eed', '#e5b8d4'][i % 3]}', borderRadius: '8px' }}>${i + 1}</div>;`).join('\n');
    const connected = Array.from({ length: count }, (_, i) => `{cn_spatial_${i}}`).join('');
    const seed = project().page(`<main data-id="root" style={{ position: 'relative', height: '720px', isolation: 'isolate', background: '#ebeee5' }}>
      <Carousel3D data-id="volume" layout="${shape}" rows={${rows}} radius={260} rotateX={0}
        itemWidth={90} itemHeight={110} perspective={1200} backfaces={false} navigation={false}
        style={{ width: '100%', height: '600px' }}>${connected}</Carousel3D>
    </main>`, { tiles: [{ id: 'desktop', label: 'Desktop', width: 800 }], imports: ["import Carousel3D from '@/components/Carousel3D';"] })
      .file('components/Carousel3D.tsx', CAROUSEL_3D_COMPONENT).build();
    seed.files['app/page.client.tsx'] += '\n' + cards;
    await editor.load(seed);
    const sandbox = editor.sandbox();
    const component = sandbox.locator('[data-revyme-carousel-3d]');
    await expect(component).toBeVisible();
    const source = await editor.code();
    const inline = await component.locator('[data-revyme-carousel-slot]').evaluateAll(elements => elements.map(el => (el as HTMLElement).style.cssText));
    const originalRect = await component.boundingBox();
    await page.getByTitle('Isometric view', { exact: true }).click();
    const inspection = sandbox.locator('[data-content-root]');
    await expect(inspection).toHaveAttribute('data-scene-inspection', 'isometric');
    await page.getByLabel('Layer separation').fill('0');
    await page.getByLabel('Layer separation').press('Enter');
    await expect.poll(() => inspection.evaluate(el => el.getAnimations().length)).toBe(0);
    await page.screenshot({ path: info.outputPath(`${shape}-isometric.png`) });
    await page.getByRole('button', { name: 'Right view', exact: true }).click();
    await expect.poll(() => inspection.evaluate(el => (el as HTMLElement).style.transform)).toBe('rotateX(0deg) rotateY(-90deg)');
    await inspection.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const middle = Math.floor(rows / 2) * 12;
    const depthSeparation = () => component.locator('[data-revyme-carousel-slot]').evaluateAll((elements, index) => {
      const rear = elements[index].getBoundingClientRect();
      const front = elements[index + 6].getBoundingClientRect();
      return Math.abs(rear.x + rear.width / 2 - front.x - front.width / 2);
    }, middle);
    await expect.poll(depthSeparation, { message: 'The side view must separate the front and rear planes in screen space' }).toBeGreaterThan(100);
    const separation = await depthSeparation();
    await page.screenshot({ path: info.outputPath(`${shape}-side.png`) });
    await page.getByRole('button', { name: 'Back view', exact: true }).click();
    await expect.poll(() => inspection.evaluate(el => (el as HTMLElement).style.transform)).toBe('rotateX(0deg) rotateY(180deg)');
    await inspection.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await expect.poll(() => component.locator('[data-revyme-carousel-slot]').first().evaluate(el => getComputedStyle(el).visibility)).toBe('visible');
    await page.screenshot({ path: info.outputPath(`${shape}-back.png`) });
    await page.keyboard.press('Escape');
    await expect(sandbox.locator('[data-content-root]')).not.toHaveAttribute('data-scene-inspection');
    expect(await editor.code()).toBe(source);
    await expect(component.locator('[data-revyme-spatial-camera]')).toHaveCSS('perspective', '1200px');
    expect(await component.locator('[data-revyme-carousel-slot]').evaluateAll(elements => elements.map(el => (el as HTMLElement).style.cssText))).toEqual(inline);
    await expect.poll(async () => Math.abs((await component.boundingBox())!.width - originalRect!.width)).toBeLessThan(1);
    await writeFile(info.outputPath('volume-verification.json'), JSON.stringify({
      shape, sideDepthSeparationPixels: separation, layerSeparation: 0,
      inspectedThroughEditorCamera: true, rearSurfacesVisible: true,
      siteCameraRestored: true, sourcePreserved: true,
    }, null, 2) + '\n');
  });
}

test('edits spatial controls, persists, undoes and previews a connected 3D Carousel', async ({ page, editor }, info) => {
  const cards = Array.from({ length: 12 }, (_, index) =>
    `const cn_card_${index} = <button data-id="card-${index}" data-canvas-node="true" type="button" style={{ position: 'absolute', left: 4000, top: ${3000 + index * 220}, width: 160, height: 200,
      background: '${['#b9e858', '#4266ed', '#ee9170'][index % 3]}', borderRadius: 16, border: 'none', color: '#142215' }}>Card ${index + 1}</button>;`).join('\n');
  const connected = Array.from({ length: 12 }, (_, index) => `{cn_card_${index}}`).join('');
  const seed = project().page(`<main data-id="root" style={{ position: 'relative', minHeight: '100vh' }}>
    <Carousel3D data-id="carousel" data-name="Spatial collection" autoplay={true}
      style={{ position: 'relative', width: '100%', height: 600 }}>${connected}</Carousel3D>
  </main>`, { imports: ["import Carousel3D from '@/components/Carousel3D';"] })
    .file('app/layout.tsx', `import { Providers } from './providers';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}`)
    .file('app/providers.tsx', `'use client';
import { MotionConfig } from 'framer-motion';
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}`)
    .file('components/Carousel3D.tsx', CAROUSEL_3D_COMPONENT).build();
  seed.files['app/page.client.tsx'] += '\n' + cards;
  await editor.load(seed);
  const canvas = editor.sandbox();
  await expect(canvas.locator('[data-revyme-carousel-slot]')).toHaveCount(12);
  await expect(canvas.locator('[data-revyme-carousel-3d]')).toHaveAttribute('data-static', 'true');
  await expect.poll(() => canvas.locator('[data-revyme-carousel-3d]').evaluate(el => el.clientHeight)).toBe(600);
  const transform = () => canvas.locator('[data-revyme-carousel-slot]').nth(2).evaluate(el => (el as HTMLElement).style.transform);
  const still = await transform();
  await page.waitForTimeout(160);
  expect(await transform()).toBe(still);
  await editor.select(['carousel']);

  const surface = page.locator('[data-properties-panel]').getByText('Surface', { exact: true })
    .locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
  await expect(surface).toBeVisible();
  const before = await editor.code();
  await surface.selectOption('sphere');
  await expect.poll(() => editor.attr('carousel', 'layout')).toBe('sphere');
  await expect(editor).toUndoInOneStep(before);
  await page.reload();
  await editor.waitForCanvas();
  await editor.settled();
  await expect.poll(() => canvas.locator('[data-revyme-carousel-3d]').evaluate(el => el.clientHeight)).toBe(600);
  await expect.poll(() => editor.attr('carousel', 'layout')).toBe('sphere');
  await editor.select(['carousel']);
  const sceneRow = page.locator('[data-properties-panel]').getByText('Scene', { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  await sceneRow.getByRole('button').click();
  const rotateRow = page.getByText('Rotate X', { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  const field = rotateRow.locator('input').last();
  await field.fill('45');
  await field.press('Enter');
  await expect.poll(() => editor.attr('carousel', 'rotateX')).toBe('45');
  expect(await editor.code()).toContain('rotateX={45}');
  await editor.settled();
  await expect(editor).toPassOracle();
  await page.screenshot({ path: info.outputPath('editor-controls.png') });
  await page.keyboard.press('Escape');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  await expect(preview.locator('[data-revyme-carousel-slot]')).toHaveCount(12);
  await expect(preview.locator('[data-revyme-carousel-3d]')).not.toHaveAttribute('data-static', 'true');
  await expect(preview.locator('[data-revyme-carousel-slot]').first().locator('xpath=..')).toHaveCSS('transform-style', 'preserve-3d');
  await expect.poll(() => preview.locator('[data-revyme-carousel-slot]').first().locator('xpath=..').getAttribute('style')).toContain('rotateX(45deg)');
  const moving = await preview.locator('[data-revyme-carousel-slot]').nth(2).getAttribute('style');
  await expect.poll(() => preview.locator('[data-revyme-carousel-slot]').nth(2).getAttribute('style')).not.toBe(moving);
  await preview.getByRole('button', { name: 'Next item' }).click();
  await page.screenshot({ path: info.outputPath('live-preview.png') });

  const files = await editor.snapshotFiles();
  const exported = await page.evaluate(async input => {
    const { buildSourceExport } = await import(/* @vite-ignore */ '/src/code/project/source-export.ts');
    return buildSourceExport(input, { name: 'Spatial carousel', runtimeRange: '^0.0.32' });
  }, files);
  expect(exported.files['vendor/revyme-runtime/dist/index.js']).toContain('RevymeCarousel3D');
  expect(exported.files['components/Carousel3D.tsx']).toContain('RevymeCarousel3D');
  for (const [file, content] of Object.entries(exported.files)) {
    const destination = path.join(info.outputPath('export'), file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content as string);
  }
});

test('supports depth, orbit gestures, local Motion, native controls and reduced motion', async ({ page }) => {
  await page.goto('/e2e/labs/carousel-3d/');
  await page.waitForFunction(() => Reflect.has(window, 'carouselLab'));
  await page.evaluate(() => Reflect.get(window, 'carouselLab').choose('globe'));
  const host = page.locator('[data-revyme-carousel-3d]');
  await expect(host.locator('[data-revyme-carousel-slot]')).toHaveCount(70);
  expect(await host.locator('[inert]').count()).toBeGreaterThan(20);
  const first = host.locator('[data-revyme-carousel-slot]').nth(3);
  await page.evaluate(() => Reflect.get(window, 'carouselLab').update('dragMode', 'orbit'));
  const scene = first.locator('xpath=..');
  const before = await scene.getAttribute('style');
  const bounds = (await host.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height * .6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 160, bounds.y + bounds.height * .5, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => scene.getAttribute('style')).not.toBe(before);

  await page.evaluate(() => Reflect.get(window, 'carouselLab').choose('recap'));
  const card = host.locator('[data-card="2"]');
  await card.click();
  await expect(card).toHaveAttribute('data-clicked', 'true');
  const spinning = await first.getAttribute('style');
  const cardBounds = (await card.boundingBox())!;
  await page.mouse.move(cardBounds.x + cardBounds.width / 2, cardBounds.y + cardBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBounds.x + cardBounds.width / 2 + 80, cardBounds.y + cardBounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => first.getAttribute('style')).not.toBe(spinning);
  await card.hover();
  await expect.poll(() => card.evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
  await host.focus();
  const position = await first.getAttribute('style');
  await host.press('ArrowRight');
  await expect.poll(() => first.getAttribute('style')).not.toBe(position);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => Reflect.get(window, 'carouselLab').update('autoplay', true));
  await page.locator('select').first().focus();
  await page.mouse.move(1, 1);
  const reduced = await first.getAttribute('style');
  await page.waitForTimeout(250);
  expect(await first.getAttribute('style')).toBe(reduced);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
});
