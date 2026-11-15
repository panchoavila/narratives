// layout-hang.test.ts — the one reproduction that does not return. A synchronous infinite loop cannot
// be interrupted by vitest's timeout, so this file runs alone under an outer shell timeout:
//   timeout 60 npx vitest run src/code/editorial/layout-hang.test.ts
// A hang shows as exit status 124; a fixed engine finishes in milliseconds.

import { beforeAll, expect, it } from 'vitest';
import { installStubCanvas } from './stub-canvas';
import { layoutFlow } from '../../../packages/revyme-runtime-scene/src/editorial';
import { baseSpec, env, words } from './fixtures';

beforeAll(() => {
  installStubCanvas();
});

it('F1 (B1) finishes a 60-word paragraph on a 120.5 px wide viewport, with whole-pixel pages', () => {
  const doc = { blocks: [{ kind: 'paragraph' as const, id: 'p', role: 'body' as const, runs: [{ text: words(60, 'word') }] }] };
  const layout = layoutFlow(doc, baseSpec({ grid: { maxColumns: 1 } }), env(120.5, 300, 'paged-x'));
  const painted = layout.pages.flatMap((page) => page.lines.map((l) => l.fragments.map((f) => f.text).join('')));
  expect(painted.join(' ').split(' ').filter((w) => w === 'word')).toHaveLength(60);
  for (const page of layout.pages) {
    expect(Number.isInteger(page.rect.x), `page ${page.index} x ${page.rect.x} is fractional`).toBe(true);
  }
  expect(layout.stats.fallbackPages).toBe(0);
});
