import { test, expect, project } from '../../fixtures/test';
import { NOVA_WARP_COMPONENT } from '../../../src/code/project/default-code-components/NovaWarp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const seed = () => project().page(`<main data-id="root" style={{ position: 'relative', minHeight: '2400px', backgroundColor: '#070e28' }}>
  <section data-id="hero" style={{ position: 'relative', height: '720px', overflow: 'hidden' }}>
    <NovaWarp data-id="warp" triggerId="launch" starColor="rgba(105,170,255,0.85)" cloudColor="var(--warp-cloud)" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    <div data-id="copy" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '28px', height: '100%', color: 'white' }}>
      <h1 data-id="title" style={{ fontSize: '64px', textAlign: 'center' }}>A little further.</h1>
      <p data-id="description" style={{ fontSize: '20px' }}>A new space to create.</p>
      <a data-id="launch" id="launch" href="#destination" style={{ padding: '18px 36px', borderRadius: '40px', backgroundColor: '#168bff', color: 'white', fontSize: '22px' }}>Explore the stars</a>
    </div>
  </section>
  <section data-id="destination" id="destination" style={{ height: '1600px', padding: '40px', color: 'white' }}><h2 data-id="end">The journey continues</h2></section>
</main>`, { imports: ["import NovaWarp from '@/components/NovaWarp';"], tiles: [{ id: 'desktop', label: 'Desktop', width: 1200 }] })
  .file('app/layout.tsx', `import { Providers } from './providers';
  import './globals.css';
  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return <html lang="en"><body style={{ margin: 0 }}><Providers>{children}</Providers></body></html>;
  }`)
  .file('app/globals.css', ':root { --warp-cloud: #334bde; }')
  .file('app/providers.tsx', `'use client';
  import { MotionConfig } from 'framer-motion';
  export function Providers({ children }: { children: React.ReactNode }) {
    return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
  }`)
  .file('components/NovaWarp.tsx', NOVA_WARP_COMPONENT).build();

test('edits, saves, reopens and previews Nova Warp with a native button', async ({ page, editor }, info) => {
  await editor.load(seed());
  const still = editor.sandbox().locator('[data-revyme-nova-warp]');
  await expect(still).toHaveAttribute('data-warp-state', 'static');
  const first = await still.locator('canvas').screenshot();
  await page.waitForTimeout(150);
  expect(await still.locator('canvas').screenshot()).toEqual(first);
  await editor.select(['warp']);
  const row = (name: string) => page.getByText(name, { exact: true }).locator('xpath=ancestor::*[@data-tool-row][1]');
  await row('Motion').getByRole('button').click();
  const before = await editor.code();
  await row('Boost').locator('input').last().fill('2');
  await row('Boost').locator('input').last().press('Enter');
  await expect.poll(() => editor.attr('warp', 'boost')).toBe('2');
  await expect(editor).toUndoInOneStep(before);
  await page.reload();
  await editor.waitForCanvas();
  await editor.settled();
  await expect.poll(() => editor.attr('warp', 'boost')).toBe('2');
  await expect(editor).toPassOracle();
  const exported = await page.evaluate(async files => {
    const { buildSourceExport } = await import(/* @vite-ignore */ '/src/code/project/source-export.ts');
    return buildSourceExport(files, { name: 'Nova Warp', runtimeRange: '^0.0.32' });
  }, await editor.snapshotFiles());
  for (const [file, content] of Object.entries(exported.files)) {
    const destination = path.join(info.outputPath('export'), file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content as string);
  }
  await page.screenshot({ path: info.outputPath('editor.png') });
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const live = preview.locator('[data-revyme-nova-warp]');
  await expect(live).toHaveAttribute('data-warp-state', 'running');
  await expect(live).toHaveAttribute('data-warp-boost', 'false');
  const idle = await live.locator('canvas').screenshot();
  await preview.getByRole('link', { name: 'Explore the stars' }).hover();
  await expect(live).toHaveAttribute('data-warp-boost', 'true');
  await page.waitForTimeout(1200);
  expect(await live.locator('canvas').screenshot()).not.toEqual(idle);
  await page.screenshot({ path: info.outputPath('warp.png') });
  await preview.getByRole('heading', { name: 'A little further.' }).hover();
  await expect(live).toHaveAttribute('data-warp-boost', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(live).toHaveAttribute('data-warp-state', 'reduced-motion');
  const reduced = await live.locator('canvas').screenshot();
  await page.waitForTimeout(150);
  expect(await live.locator('canvas').screenshot()).toEqual(reduced);
  await preview.getByRole('link', { name: 'Explore the stars' }).click();
  await expect(preview.getByRole('heading', { name: 'The journey continues' })).toBeInViewport();
});

test('recovers GPU context and stops offscreen without hiding HTML', async ({ page, editor }, info) => {
  await editor.load(seed());
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const live = preview.locator('[data-revyme-nova-warp]');
  await expect(live).toHaveAttribute('data-warp-state', 'running');
  await live.locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
    const lose = gl.getExtension('WEBGL_lose_context')!;
    lose.loseContext();
    setTimeout(() => lose.restoreContext(), 1000);
  });
  await expect(live).toHaveAttribute('data-warp-state', 'context-lost');
  await expect(preview.getByRole('link', { name: 'Explore the stars' })).toBeVisible();
  await expect(live).toHaveAttribute('data-warp-state', 'running');
  await preview.locator('#destination').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await expect.poll(() => live.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await expect(live).toHaveAttribute('data-warp-state', 'offscreen');
  await preview.getByRole('heading', { name: 'A little further.' }).scrollIntoViewIfNeeded();
  await expect(live).toHaveAttribute('data-warp-state', 'running');
  await page.screenshot({ path: info.outputPath('restored.png') });
});

test('portable runtime supports pause, mobile touch, resize and native navigation', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('http://localhost:4333/e2e/labs/nova-warp/');
    const warp = page.locator('[data-revyme-nova-warp]');
    await expect(warp).toHaveAttribute('data-warp-state', 'running');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const button = page.getByRole('link', { name: 'Explore the stars' });
    const rect = (await button.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }] });
    await expect(warp).toHaveAttribute('data-warp-boost', 'true');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(warp).toHaveAttribute('data-warp-boost', 'false');
    await page.getByRole('button', { name: 'Pause motion' }).click();
    await expect(warp).toHaveAttribute('data-warp-state', 'paused');
    const still = await warp.locator('canvas').screenshot();
    await page.waitForTimeout(150);
    expect(await warp.locator('canvas').screenshot()).toEqual(still);
    await page.screenshot({ path: info.outputPath('mobile.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => warp.locator('canvas').evaluate(c => (c as HTMLCanvasElement).width)).toBe(1280);
    await page.getByRole('button', { name: 'Resume motion' }).click();
    await expect(warp).toHaveAttribute('data-warp-state', 'running');
    await button.focus();
    await expect(warp).toHaveAttribute('data-warp-boost', 'false');
    await button.press('Enter');
    await expect(page.getByRole('heading', { name: 'Make room for a little wonder.' })).toBeInViewport();
    await expect(warp).toHaveAttribute('data-warp-state', 'offscreen');
  } finally { await context.close(); }
});

test('keeps text, links and the fallback background usable without WebGL', async ({}, info) => {
  const browser = await chromium.launch({ args: ['--disable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto('http://localhost:4333/e2e/labs/nova-warp/');
    await expect(page.locator('[data-revyme-nova-warp]')).toHaveAttribute('data-warp-state', 'fallback');
    await expect(page.getByRole('heading', { name: 'Back to the beautiful unknown.' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('no-webgl.png') });
    await page.getByRole('link', { name: 'Explore the stars' }).click();
    await expect(page.getByRole('heading', { name: 'Make room for a little wonder.' })).toBeInViewport();
  } finally { await browser.close(); }
});
