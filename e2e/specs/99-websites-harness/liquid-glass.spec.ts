import { test, expect, project } from '../../fixtures/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const seed = () => project().page(`<main data-id="root" style={{ position: 'relative', width: '100%', minHeight: '100vh', background: 'linear-gradient(125deg, #102024, #d2a565)', padding: '80px', color: '#ffffff' }}>
  <h1 data-id="title" style={{ fontSize: '72px' }}>Glass in motion</h1>
  <section data-id="glass" style={{ position: 'relative', zIndex: '2', width: '420px', height: '260px', borderRadius: '32px', padding: '32px', background: '#ffffff22' }}>
    <h2 data-id="card-title">Live HTML</h2>
    <input data-id="field" aria-label="Your name" placeholder="Your name" />
    <a data-id="action" href="#details">Open details</a>
  </section>
  <p data-id="details" id="details">Editable content, shared runtime.</p>
</main>`).file('app/layout.tsx', `import { Providers } from './providers';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}`).file('app/providers.tsx', `'use client';
import { MotionConfig } from 'framer-motion';
export function Providers({ children }: { children: React.ReactNode }) { return <MotionConfig reducedMotion="user">{children}</MotionConfig>; }
`).file('app/icon.svg', readFileSync(path.resolve(__dirname, '../../../public/narratives-icon.svg'), 'utf8')).build();

test('adds, edits, persists and previews Liquid Glass through the real editor', async ({ page, editor }, info) => {
  await editor.load(seed());
  await editor.select(['glass']);
  await page.getByTitle('Add visual effect', { exact: true }).click();
  await page.getByRole('button', { name: 'Liquid Glass', exact: true }).click();
  await editor.settled();
  await info.attach('files-after-add', { body: JSON.stringify(await editor.snapshotFiles(), null, 2), contentType: 'application/json' });
  const controls = page.locator('[data-liquid-glass-controls]');
  await expect.poll(() => editor.attr('glass', 'data-liquid-glass')).not.toBeNull();
  await expect(controls).toBeVisible();
  await expect.poll(() => editor.attr('glass', 'data-canvas-effect')).toBeNull();
  const before = await editor.code();
  await controls.getByRole('combobox').first().selectOption('chromatic');
  await expect.poll(async () => JSON.parse(await editor.attr('glass', 'data-liquid-glass') ?? '{}').aberration).toBeGreaterThan(0.1);
  await expect(editor).toUndoInOneStep(before);
  await expect(editor).toPassOracle();
  await page.screenshot({ path: info.outputPath('glass-controls.png') });
  await page.reload();
  await editor.waitForCanvas();
  await editor.settled();
  await expect.poll(async () => JSON.parse(await editor.attr('glass', 'data-liquid-glass') ?? '{}').aberration).toBeGreaterThan(0.1);
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  await expect(preview.locator('[data-id="glass"]')).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await preview.getByRole('textbox', { name: 'Your name' }).fill('Revyme');
  await expect(preview.getByRole('textbox', { name: 'Your name' })).toHaveValue('Revyme');
  await page.screenshot({ path: info.outputPath('glass-preview.png') });
  const files = await editor.snapshotFiles();
  const exported = await page.evaluate(async files => {
    const { buildSourceExport } = await import(/* @vite-ignore */ '/src/code/project/source-export.ts');
    return buildSourceExport(files, { name: 'Revyme Glass Verification', runtimeRange: '^0.0.32' });
  }, files);
  for (const [file, content] of Object.entries(exported.files)) {
    const destination = path.join(info.outputPath('export'), file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content as string);
  }
  await info.attach('export-manifest', { body: JSON.stringify(Object.keys(exported.files)), contentType: 'application/json' });
});

test('composes real GPU lenses and preserves live HTML, dynamic content and cleanup', async ({ page }, info) => {
  await page.goto('/research/2026-11-07-liquid-glass/runtime.html?liquidGL-engine=webgl2');
  const first = page.locator('#glass-a'), second = page.locator('#glass-b');
  await expect(first).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await expect(second).toHaveAttribute('data-revyme-liquid-state', 'ready');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Live DOM');
  await page.getByRole('button', { name: 'Count: 0' }).click();
  await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('glass-stacked.png') });
  const clear = await first.screenshot();
  await first.evaluate(el => el.setAttribute('data-liquid-glass', JSON.stringify({ version: 1, specular: false, refraction: 0.1, aberration: 0.7, frost: 3, tint: '#cf672b88', magnify: 1.6 })));
  await expect.poll(async () => Buffer.compare(clear, await first.screenshot())).not.toBe(0);
  await page.screenshot({ path: info.outputPath('glass-chromatic-frost.png') });
  await page.evaluate(() => {
    document.querySelector('.moving')!.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(800px)' }], { duration: 1400, iterations: Infinity, direction: 'alternate' });
  });
  const animated = await first.screenshot();
  await expect.poll(async () => Buffer.compare(animated, await first.screenshot())).not.toBe(0);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Live DOM');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(first).toHaveAttribute('data-revyme-liquid-state', 'ready');
  await page.screenshot({ path: info.outputPath('glass-mobile.png') });
  await page.evaluate(() => (window as unknown as { stopGlass: () => void }).stopGlass());
  await expect(page.locator('canvas[data-revyme-liquid-canvas]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Live DOM');
});

test('keeps the authored native backdrop editable and enables it in live preview', async ({ page, editor }) => {
  await editor.load(project().page(`<main data-id="root" style={{ position: 'relative', minHeight: '90vh', isolation: 'isolate' }}>
    <RevymeLiquidBackdrop>
      <div data-id="art" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(60deg, #13255c, #64dcaf)' }}>
        <h1 data-id="title">Native backdrop</h1>
      </div>
    </RevymeLiquidBackdrop>
    <section data-id="lens" style={{ position: 'absolute', top: 80, left: 80, width: 340, height: 160, zIndex: 2, borderRadius: 30 }} data-liquid-glass='{"version":1,"specular":false}'>
      <button data-id="action" type="button">Still HTML</button>
    </section>
  </main>`, { imports: ["import { RevymeLiquidBackdrop } from '@revyme/runtime';"] }).build());
  await editor.select(['art']);
  await expect(editor).toPassOracle();
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const native = await preview.locator('body').evaluate(el =>
    typeof Reflect.get(el.ownerDocument.createElement('canvas'), 'requestPaint') === 'function');
  await expect(preview.locator('[data-id="lens"]')).toHaveAttribute('data-revyme-liquid-source', native ? 'native' : 'rasterized');
  await preview.getByRole('button', { name: 'Still HTML' }).click();
  await expect(preview.getByRole('button', { name: 'Still HTML' })).toBeFocused();
});

test('keeps Motion transforms while tilting and dragging, and releases offscreen lenses', async ({ page }, info) => {
  await page.goto('/research/2026-11-07-liquid-glass/runtime.html?liquidGL-engine=webgl2');
  const glass = page.locator('#glass-a');
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await glass.evaluate(el => {
    (el as HTMLElement).style.transform = 'translateX(24px)';
    el.setAttribute('data-liquid-glass', JSON.stringify({ version: 1, specular: false, tilt: true, tiltFactor: 16 }));
  });
  await glass.hover({ position: { x: 390, y: 20 } });
  await expect.poll(() => glass.evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
  await expect.poll(() => glass.evaluate(el => (el as HTMLElement).style.transform)).toBe('translateX(24px)');
  await page.screenshot({ path: info.outputPath('glass-tilt.png') });
  await page.mouse.move(1500, 50);
  await glass.evaluate(el => el.setAttribute('data-liquid-glass', JSON.stringify({ version: 1, specular: false, draggable: true })));
  await expect(glass).toHaveAttribute('data-revyme-liquid-drag', '');
  const start = await glass.boundingBox();
  if (!start) throw Error('Missing glass bounds');
  await page.mouse.move(start.x + 15, start.y + 15); await page.mouse.down();
  await page.mouse.move(start.x + 85, start.y + 55, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await glass.boundingBox())!.x - start.x).toBeGreaterThan(65);
  await expect.poll(() => glass.evaluate(el => (el as HTMLElement).style.transform)).toBe('translateX(24px)');
  await page.screenshot({ path: info.outputPath('glass-drag.png') });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Preserved');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'paused');
  await expect(page.locator('canvas[data-revyme-liquid-canvas]')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Preserved');
});

test('retains native controls when GPU is unavailable and after real context loss', async ({ browser }, info) => {
  const disabled = await browser.newContext();
  await disabled.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      return kind.includes('webgl') || kind === 'webgpu' ? null : Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });
  const fallback = await disabled.newPage();
  await fallback.goto('http://localhost:4333/research/2026-11-07-liquid-glass/runtime.html');
  await expect(fallback.locator('#glass-a')).toHaveAttribute('data-revyme-liquid-state', 'fallback');
  await fallback.getByRole('textbox', { name: 'Name', exact: true }).fill('No GPU');
  await expect(fallback.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('No GPU');
  await fallback.screenshot({ path: info.outputPath('glass-no-gpu.png') });
  await disabled.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:4333/research/2026-11-07-liquid-glass/runtime.html?liquidGL-engine=webgl2');
  await expect(page.locator('#glass-a')).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Context lost');
  await page.locator('canvas[data-revyme-liquid-canvas]').first().evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw Error('Real WebGL context loss unavailable');
    extension.loseContext();
  });
  await expect(page.locator('#glass-a')).toHaveAttribute('data-revyme-liquid-state', 'fallback');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Context lost');
  await context.close();
});

test('responds to real playback audio, fluid input and reduced motion', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (data) {
      original.call(this, data);
      (window as unknown as { audioPeak: number }).audioPeak = Math.max(...data);
    };
  });
  await page.goto('/research/2026-11-07-liquid-glass/runtime.html?liquidGL-engine=webgl2');
  const glass = page.locator('#glass-a');
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await glass.evaluate(el => el.setAttribute('data-liquid-glass', JSON.stringify({ version: 1, audioReactive: true, audioSourceId: 'test-tone', audioGain: 5, specular: false })));
  await page.getByRole('button', { name: 'Play test tone' }).click();
  await expect(glass).toHaveAttribute('data-revyme-liquid-audio', 'active');
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioPeak: number }).audioPeak)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('glass-audio.png') });
  await glass.evaluate(el => el.setAttribute('data-liquid-glass', JSON.stringify({ version: 1, interaction: 'fluid', interactionStrength: 2, specular: true })));
  await page.mouse.move(50, 80);
  const before = await glass.screenshot();
  await glass.hover({ position: { x: 160, y: 30 } });
  await expect.poll(async () => Buffer.compare(before, await glass.screenshot())).not.toBe(0);
  await page.screenshot({ path: info.outputPath('glass-fluid-highlight.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'ready');
  await expect(glass).not.toHaveAttribute('data-revyme-liquid-drag');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Reduced motion');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Reduced motion');
});

test('renders through WebGPU and restores HTML after real device loss', async ({ page }, info) => {
  await page.addInitScript(() => {
    const Adapter = Reflect.get(globalThis, 'GPUAdapter');
    if (!Adapter) return;
    const request = Adapter.prototype.requestDevice;
    Adapter.prototype.requestDevice = async function (...args: unknown[]) {
      const device = await Reflect.apply(request, this, args);
      const state = window as unknown as { glassDevices?: { destroy: () => void }[] };
      (state.glassDevices ??= []).push(device as { destroy: () => void });
      return device;
    };
  });
  await page.goto('/research/2026-11-07-liquid-glass/runtime.html?liquidGL-engine=webgpu');
  const supported = await page.evaluate(async () => {
    const gpu = Reflect.get(navigator, 'gpu');
    return !!gpu && !!await gpu.requestAdapter();
  });
  test.skip(!supported, 'This browser/device does not provide a WebGPU adapter.');
  const glass = page.locator('#glass-a');
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  await expect(glass).toHaveAttribute('data-revyme-liquid-backend', 'webgpu');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('WebGPU');
  await page.screenshot({ path: info.outputPath('glass-webgpu.png') });
  await page.evaluate(() => (window as unknown as { glassDevices: { destroy: () => void }[] }).glassDevices.forEach(device => device.destroy()));
  await expect(glass).toHaveAttribute('data-revyme-liquid-state', 'fallback');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('WebGPU');
});

test('snapshot navigation preserves the destination instead of omitting live glass', async ({ page }) => {
  await page.goto('/research/2026-11-07-liquid-glass/runtime.html?liquidGL-engine=webgl2');
  await expect(page.locator('#glass-a')).toHaveAttribute('data-revyme-liquid-state', 'ready', { timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const { runDisplacementNavigation } = await import(/* @vite-ignore */ '/packages/revyme-runtime-scene/src/displacement-navigation.ts');
    const { DEFAULT_DISPLACEMENT } = await import(/* @vite-ignore */ '/packages/revyme-runtime-scene/src/displacement-config.ts');
    let calls = 0;
    const result = await runDisplacementNavigation({ config: DEFAULT_DISPLACEMENT, navigate: async () => { calls++; location.hash = 'details'; } });
    return { ...result, calls };
  });
  expect(result).toMatchObject({ mode: 'fallback', reason: 'unsupported-surface', calls: 1 });
  await expect(page.locator('#details')).toBeInViewport();
});
