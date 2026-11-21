import { describe, expect, it } from 'vitest';
import { NOVA_WARP_COMPONENT } from './default-code-components/NovaWarp';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';
import { buildSourceExport } from './source-export';
import { createDefaultProject, InMemoryProjectFS, installBuiltInCodeComponent } from './project-fs';
import { compileCodeComponent } from '@/canvas/code-component-runtime';
import { buildAutoImports } from '@/shared/import-detection.mjs';

describe('Nova Warp authoring and export', () => {
  it('installs an editable component through the built-in registry', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    expect(installBuiltInCodeComponent(fs, 'NovaWarp')).toBe(true);
    expect(installBuiltInCodeComponent(fs, 'NovaWarp')).toBe(false);
    const source = fs.readFile('components/NovaWarp.tsx')!;
    const meta = parseComponentControlsMeta(source)!;
    const controls = Object.fromEntries(Object.entries(meta.controls).flatMap(([key, value]) =>
      value.type === 'group' ? Object.entries(value.controls!) : [[key, value]]));
    for (const key of ['starCount', 'starSize', 'trailLength', 'cloudOpacity', 'cloudScale',
      'cloudRotation', 'idleSpeed', 'boost', 'response', 'triggerId', 'followTarget', 'centerX',
      'centerY', 'parallax', 'paused', 'bgColor', 'starColor', 'starTint', 'cloudColor', 'cloudTint']) {
      expect(controls[key], key).toBeDefined();
    }
    expect(compileCodeComponent(source, 'NovaWarp')).toBeTruthy();
    expect(checkFile(source, { kind: 'code-component', path: 'components/NovaWarp.tsx' })).toEqual([]);
    expect(buildAutoImports('const component = RevymeNovaWarp;').join('\n')).toContain('RevymeNovaWarp');
  });

  it('ships the shared engine and its lazy GPU chunk without an editor or archive dependency', async () => {
    const result = await buildSourceExport({ 'components/NovaWarp.tsx': NOVA_WARP_COMPONENT }, {
      name: 'nova-warp', runtimeRange: '^0.0.32',
    });
    expect(JSON.parse(result.files['package.json']).dependencies['@revyme/runtime']).toBe('file:./vendor/revyme-runtime');
    expect(result.files['vendor/revyme-runtime/dist/index.js']).toContain('RevymeNovaWarp');
    const renderer = Object.entries(result.files).find(([path]) => /dist\/nova-warp-renderer-.*\.js$/.test(path));
    expect(renderer).toBeDefined();
    expect(renderer![1]).not.toContain('web.archive.org');
    expect(result.files['vendor/revyme-runtime/THREE-LICENSE']).toContain('MIT License');
    // The exported project's tsc also checks the bundled runtime source.
    expect(JSON.parse(result.files['vendor/revyme-runtime/package.json']).devDependencies['@types/hyphen']).toBeTruthy();
  });
});
