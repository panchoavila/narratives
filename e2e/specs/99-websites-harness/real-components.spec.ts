import { test, expect, project } from '../../fixtures/test';
import { ADVANCED_HEADING_COMPONENT } from '../../../src/code/project/default-code-components/AdvancedHeading';
import { ADVANCED_FRAME_COMPONENT } from '../../../src/code/project/default-code-components/AdvancedFrame';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const seed = () => project().page(`<main data-id="root" style={{ position: 'relative', minHeight: '1800px', display: 'flex', flexDirection: 'column', padding: '64px', backgroundColor: '#edf2ed' }}>
  <AdvancedFrame data-id="frame" cornerStyle="crossSquare" cornerOffsetX={0} cornerOffsetY={0} cornerColor="#262626" cornerFill="#bcff05" patternPreset="diagonalLines" patternColor="rgba(38,38,38,0.12)" tileSize={7} lineWidth={1} style={{ position: 'relative', width: '700px', order: '0', flex: '0 0 auto', minHeight: '260px', padding: '40px', border: '1px solid #262626', display: 'flex', flexDirection: 'column', gap: '24px' }}>
    <AdvancedHeading data-id="title" text="Hacemos real el mundo que queremos" tag="h1" effect="scramble" trigger="hover" duration={0.5} style={{ position: 'relative', order: '0', flex: '0 0 auto', fontFamily: 'monospace', fontSize: '40px', lineHeight: '1.1', color: '#262626', width: '100%' }} />
    <Link data-id="link" href="#destination" style={{ position: 'relative', order: '1', flex: '0 0 auto', color: '#262626', fontSize: '18px' }}>Conoce REAL</Link>
  </AdvancedFrame>
  <section data-id="destination" id="destination" style={{ position: 'relative', order: '1', flex: '0 0 auto', marginTop: '700px' }}><h2 data-id="end">Nuestra metodología</h2></section>
</main>`, { imports: ["import Link from 'next/link';", "import AdvancedHeading from '@/components/AdvancedHeading';", "import AdvancedFrame from '@/components/AdvancedFrame';"], tiles: [{ id: 'desktop', label: 'Desktop', width: 1200 }] })
  .file('components/AdvancedHeading.tsx', ADVANCED_HEADING_COMPONENT)
  .file('components/AdvancedFrame.tsx', ADVANCED_FRAME_COMPONENT).build();

test('REAL-001 frame corners persist through controls, undo, reload and export', async ({ page, editor }, info) => {
  await editor.load(seed());
  expect(await editor.oracle('components/AdvancedFrame.tsx')).toEqual([]);
  expect(await editor.oracle('components/AdvancedHeading.tsx')).toEqual([]);
  const frame = editor.sandbox().locator('[data-revyme-advanced-frame]');
  await expect(frame.locator('[data-frame-corner]')).toHaveCount(4);
  await expect(frame.locator('[data-frame-pattern]')).toHaveAttribute('data-frame-pattern', 'diagonalLines');
  // Inline content is the editable node itself, unlike a connected slot's ghost.
  await expect(frame.locator('[data-node-id="title"]')).toHaveCount(1);
  await editor.click('title');
  await expect.poll(() => editor.selection()).toContain('title');
  expect(await editor.oracle('app/page.client.tsx')).toEqual([]);
  const textRow = page.getByText('Text', { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  await textRow.locator('input,textarea').fill('Texto editable dentro del frame');
  await textRow.locator('input,textarea').press('Tab');
  await expect(frame.getByRole('heading', { name: 'Texto editable dentro del frame' })).toBeVisible();
  await expect.poll(() => editor.attr('title', 'text')).toBe('Texto editable dentro del frame');
  const geometry = await frame.evaluate(el => {
    const host = el.closest('[data-code-component]')!;
    const a = host.getBoundingClientRect(), b = el.getBoundingClientRect();
    return { outer: { x: a.x, y: a.y, width: a.width }, inner: { x: b.x, y: b.y, width: b.width } };
  });
  expect(geometry.inner).toEqual(geometry.outer);
  await editor.select(['frame']);
  const row = (name: string) => page.getByText(name, { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  await row('Corners').getByRole('button').click();
  const before = await editor.code();
  await row('Inset X').locator('input').last().fill('-20');
  await row('Inset X').locator('input').last().press('Enter');
  await expect.poll(() => editor.attr('frame', 'cornerOffsetX')).toBe('-20');
  await expect(editor).toUndoInOneStep(before);
  await page.reload();
  await editor.waitForCanvas();
  await editor.settled();
  await expect.poll(() => editor.attr('frame', 'cornerOffsetX')).toBe('-20');
  await expect(frame.getByRole('heading', { name: 'Texto editable dentro del frame' })).toBeVisible();
  await expect(editor).toPassOracle();
  await page.screenshot({ path: info.outputPath('editor.png') });
  const exported = await page.evaluate(async files => {
    const { buildSourceExport } = await import(/* @vite-ignore */ '/src/code/project/source-export.ts');
    return buildSourceExport(files, { name: 'REAL components', runtimeRange: '^0.0.32' });
  }, await editor.snapshotFiles());
  expect(JSON.parse(exported.files['package.json']).dependencies['@revyme/runtime']).toBe('file:./vendor/revyme-runtime');
  for (const [file, content] of Object.entries(exported.files)) {
    const destination = path.join(info.outputPath('export'), file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content as string);
  }
});

test('REAL-002 heading preserves semantic text, layout, static editing and reduced motion', async ({ page, editor }, info) => {
  await editor.load(seed());
  const heading = editor.sandbox().locator('[data-revyme-advanced-heading]');
  await expect(heading).toHaveAttribute('data-heading-state', 'static');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const live = preview.getByRole('heading', { name: 'Hacemos real el mundo que queremos', exact: true });
  const before = await live.boundingBox();
  await live.hover();
  await expect(live).toHaveAttribute('data-heading-state', 'running');
  await expect(live).toHaveAccessibleName('Hacemos real el mundo que queremos');
  await expect(live).toHaveAttribute('data-heading-state', 'idle');
  expect(await live.boundingBox()).toEqual(before);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await live.hover();
  await expect(live).toHaveAttribute('data-heading-state', 'reduced-motion');
  await page.screenshot({ path: info.outputPath('preview.png') });
  await preview.getByRole('link', { name: 'Conoce REAL' }).click();
  await expect(preview.getByRole('heading', { name: 'Nuestra metodología' })).toBeInViewport();
});

test('REAL-005 inline frame content keeps identity and responsive layout on every canvas tile', async ({ page, editor }, info) => {
  const source = project().page(`<main data-id="root" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', padding: '20px' }}>
    <AdvancedFrame data-id="responsive-frame" cornerStyle="cross" patternPreset="grid" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'row', padding: '40px', gap: '20px' }}>
      <AdvancedHeading data-id="responsive-heading" text="REAL adaptable" effect="scramble" fontSize={40} style={{ position: 'relative', width: '50%', flex: '0 0 auto', order: '0' }} />
      <p data-id="responsive-copy" style={{ position: 'relative', width: '40%', flex: '0 0 auto', order: '1' }}>El contenido sigue siendo editable.</p>
    </AdvancedFrame>
    <style>{\`@media (max-width: 810px) { [data-id="responsive-frame"] { padding: 24px !important; } }
    @media (max-width: 390px) { [data-id="responsive-frame"] { padding: 12px !important; flex-direction: column !important; } [data-id="responsive-heading"] { width: 100% !important; } }\`}</style>
  </main>`, { imports: ["import AdvancedHeading from '@/components/AdvancedHeading';", "import AdvancedFrame from '@/components/AdvancedFrame';"],
    tiles: [{ id: 'desktop', label: 'Desktop', width: 1200 }, { id: 'tablet', label: 'Tablet', width: 810 }, { id: 'mobile', label: 'Mobile', width: 390 }] })
    .file('components/AdvancedHeading.tsx', ADVANCED_HEADING_COMPONENT).file('components/AdvancedFrame.tsx', ADVANCED_FRAME_COMPONENT).build();
  await page.setViewportSize({ width: 1720, height: 1000 });
  await editor.load(source, { fit: true });
  await info.attach('responsive-source', { body: await editor.code(), contentType: 'text/plain' });
  await info.attach('responsive-styles', { body: JSON.stringify(await editor.sandbox().locator('[data-code-component]').evaluateAll(elements => elements.map(el => ({
    viewport: el.closest('[data-viewport]')?.getAttribute('data-viewport'), resolved: el.getAttribute('data-code-resolved-styles'),
    outer: (el as HTMLElement).style.cssText, inner: (el.firstElementChild as HTMLElement)?.style.cssText,
  }))), null, 2), contentType: 'application/json' });
  expect(await editor.oracle('app/page.client.tsx')).toEqual([]);
  for (const [vp, padding, direction] of [['desktop', '40px', 'row'], ['tablet', '24px', 'row'], ['mobile', '12px', 'column']]) {
    const tile = editor.sandbox().locator(`[data-viewport="${vp}"]`);
    const frame = tile.locator('[data-revyme-advanced-frame]');
    await expect(frame).toHaveCSS('padding-top', padding);
    await expect(frame).toHaveCSS('flex-direction', direction);
    await expect(tile.locator('[data-node-id][data-id="responsive-heading"]')).toHaveCount(1);
    await expect(tile.locator('[data-node-id][data-id="responsive-copy"]')).toHaveCount(1);
    const gap = await frame.evaluate(el => {
      const heading = el.querySelector('[data-revyme-advanced-heading]')!;
      return (heading.getBoundingClientRect().left - el.getBoundingClientRect().left) / (el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth);
    });
    expect(gap).toBeCloseTo(Number.parseFloat(padding), 0);
  }
  await editor.click('responsive-copy', { vpId: 'mobile' });
  await expect.poll(() => editor.selection()).toContain('responsive-copy');
  await page.screenshot({ path: info.outputPath('responsive.png') });
});
