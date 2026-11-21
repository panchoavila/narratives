import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevymeImageLightbox } from '../../../packages/revyme-runtime-scene/src/image-lightbox';
import { IMAGE_LIGHTBOX_COMPONENT } from './default-code-components/ImageLightbox';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';
import { buildSourceExport } from './source-export';

describe('image lightbox', () => {
  it('retains a semantic image and usable original-image link before hydration', () => {
    const html = renderToStaticMarkup(<RevymeImageLightbox src="/small.jpg" fullSrc="/full.jpg" alt="Proyecto REAL" static />);
    expect(html).toContain('href="/full.jpg"');
    expect(html).toContain('alt="Proyecto REAL"');
    expect(html).toContain('aria-label="Proyecto REAL"');
    const noAlt = renderToStaticMarkup(<RevymeImageLightbox src="/small.jpg" openLabel="Abrir imagen" />);
    expect(noAlt).toContain('aria-label="Abrir imagen"');
    expect(noAlt).toContain('alt=""');
    expect(html).not.toContain(' open=');
    expect(html).toContain('<dialog');
  });
  it('exposes image bindings, modal geometry and spring settings through the canonical adapter', () => {
    const controls = parseComponentControlsMeta(IMAGE_LIGHTBOX_COMPONENT)!.controls;
    expect(Object.keys(controls)).toEqual(['src','fullSrc','alt','fit','radius','padding','maxWidth','backdropColor','stiffness','damping','mass','openLabel','closeLabel']);
    expect(checkFile(IMAGE_LIGHTBOX_COMPONENT, { kind: 'code-component', path: 'components/ImageLightbox.tsx' })).toEqual([]);
  });
  it('exports the shared implementation and replaces obsolete generated runtime files', async () => {
    const result = await buildSourceExport({ 'components/ImageLightbox.tsx': IMAGE_LIGHTBOX_COMPONENT, 'vendor/revyme-runtime/dist/obsolete.d.ts': 'old' }, { name: 'Lightbox', runtimeRange: '^0.0.32' });
    expect(result.files['vendor/revyme-runtime/src/image-lightbox.tsx']).toContain('RevymeImageLightbox');
    expect(result.files['vendor/revyme-runtime/dist/obsolete.d.ts']).toBeUndefined();
  });
});
