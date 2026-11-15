import { describe, expect, it } from 'vitest';
import { CAROUSEL_3D_COMPONENT, LEGACY_CAROUSEL_3D_COMPONENT } from './default-code-components/Carousel3D';
import { CAROUSEL_3D_PRESETS, normalizeCarousel3D } from '../../../packages/revyme-runtime-scene/src/carousel-3d-config';
import { carousel3DGeometry, carousel3DFit, carousel3DLayout } from '../../../packages/revyme-runtime-scene/src/carousel-3d-geometry';
import { parseComponentControlsMeta } from '../components/controls-parser';
import { checkFile } from '../oracle/check-file';
import { buildSourceExport } from './source-export';
import { InMemoryProjectFS, createDefaultProject, installBuiltInCodeComponent, syncBuiltInCodeComponents } from './project-fs';
import { compileCodeComponent } from '@/canvas/code-component-runtime';

describe('spatial carousel geometry', () => {
  it('uses item width plus Gap as line spacing and item height plus Gap between rows', () => {
    const config = normalizeCarousel3D({ layout: 'line', distribution: 'gap', gap: 32, itemWidth: 140, itemHeight: 100, rows: 2, rotateX: 0 });
    const poses = carousel3DGeometry(config, 6);
    expect(poses[1].center.x - poses[0].center.x).toBeCloseTo(172);
    expect(poses[3].center.y - poses[0].center.y).toBeCloseTo(132);
  });

  it('sizes a cylinder from its items and preserves Gap when the collection grows', () => {
    const config = normalizeCarousel3D({ distribution: 'gap', gap: 30, itemWidth: 120 });
    for (const count of [4, 12, 40]) {
      const layout = carousel3DLayout(config, count);
      expect(2 * Math.PI * layout.radius / count - config.itemWidth).toBeCloseTo(30);
    }
  });

  it('fits sphere latitude bands to Gap without stacking items at the poles', () => {
    const config = normalizeCarousel3D({ layout: 'sphere', distribution: 'gap', gap: 24, rows: 7, latitude: 180 });
    const layout = carousel3DLayout(config, 70);
    expect(layout.columns.reduce((sum, value) => sum + value, 0)).toBe(70);
    expect(layout.radius * (layout.latitudes[1] - layout.latitudes[0]) * Math.PI / 180)
      .toBeGreaterThanOrEqual(config.itemHeight + config.gap - 0.0001);
    for (let row = 0; row < layout.rows; row++) {
      const circumference = 2 * Math.PI * layout.radius * Math.cos(layout.latitudes[row] * Math.PI / 180);
      if (layout.columns[row] > 1) expect(circumference / layout.columns[row]).toBeGreaterThanOrEqual(config.itemWidth + config.gap - 0.0001);
    }
    expect(carousel3DGeometry(config, 70).every(pose => !/NaN|Infinity/.test(pose.transform))).toBe(true);
    expect(carousel3DGeometry(config, 0)).toEqual([]);
  });

  it('preserves meridian spacing on a squashed sphere and keeps collapsed inputs finite', () => {
    const config = normalizeCarousel3D({ layout: 'sphere', distribution: 'gap', rows: 3, depth: 0.4 });
    const layout = carousel3DLayout(config, 3);
    const shortestMeridianStep = layout.radius * (layout.latitudes[1] - layout.latitudes[0]) * Math.PI / 180 * config.depth;
    expect(shortestMeridianStep).toBeGreaterThanOrEqual(config.itemHeight + config.gap - 0.0001);
    for (const surface of ['cylinder', 'sphere', 'line'] as const) {
      const collapsed = normalizeCarousel3D({ layout: surface, distribution: 'gap', arc: 0, depth: 0, latitude: 0, rows: 3 });
      const poses = carousel3DGeometry(collapsed, 12);
      expect(poses.every(pose => !/NaN|Infinity/.test(pose.transform))).toBe(true);
      expect(new Set(poses.map(pose => JSON.stringify(pose.center))).size).toBe(12);
    }
  });

  it('places a cylinder in a real circle with equally spaced depth and no duplicate seam', () => {
    const config = normalizeCarousel3D({ radius: 100, rotateX: 0 });
    const poses = carousel3DGeometry(config, 4);
    poses.forEach((pose, index) => {
      expect(pose.center.x).toBeCloseTo([0, -100, 0, 100][index]);
      expect(pose.center.z).toBeCloseTo([-100, 0, 100, 0][index]);
    });
    expect(new Set(poses.map(p => JSON.stringify(p.center))).size).toBe(4);
  });

  it('keeps a sphere on its surface for uneven rows and arbitrary whole-scene rotations', () => {
    const config = normalizeCarousel3D({ layout: 'sphere', rows: 6, radius: 280, rotateX: 35, rotateY: -20, rotateZ: 12 });
    const poses = carousel3DGeometry(config, 47);
    expect(poses).toHaveLength(47);
    for (const { center } of poses) expect(Math.hypot(center.x, center.y, center.z)).toBeCloseTo(280, 8);
  });

  it('keeps billboard normals facing the camera independently of the orbit orientation', () => {
    const config = normalizeCarousel3D({ orientation: 'billboard', rotateX: 85, rotateY: 23, rotateZ: 31 });
    for (const pose of carousel3DGeometry(config, 12)) expect(pose.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('opens an arc with both endpoints and handles a single item without invalid transforms', () => {
    const config = normalizeCarousel3D({ radius: 100, arc: 180, rotateX: 0 });
    const poses = carousel3DGeometry(config, 3);
    expect(poses[0].center.x).toBeCloseTo(-100);
    expect(poses[2].center.x).toBeCloseTo(100);
    expect(carousel3DGeometry(config, 1)[0].center.z).toBe(100);
    expect(carousel3DGeometry(config, 0)).toEqual([]);
  });

  it('advances the line with the same phase control and keeps spacing uniform', () => {
    const config = normalizeCarousel3D({ layout: 'line', spacing: 30, rotateX: 0 });
    const before = carousel3DGeometry(config, 5);
    const after = carousel3DGeometry(config, 5, 72);
    expect(after[0].center.x - before[0].center.x).toBeCloseTo(30);
    expect(after[4].center.x).toBe(before[0].center.x);
  });

  it('normalizes unsafe inputs and fits each reference to narrow and wide frames', () => {
    expect(normalizeCarousel3D({ radius: NaN, rows: 999, speed: Infinity })).toMatchObject({ radius: 260, rows: 30, speed: 12 });
    for (const preset of Object.values(CAROUSEL_3D_PRESETS)) {
      const config = normalizeCarousel3D(preset);
      for (const width of [320, 1200]) {
        const scale = carousel3DFit(config, 40, width, 600);
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThanOrEqual(1);
        for (const pose of carousel3DGeometry(config, 40)) expect(pose.transform).not.toMatch(/NaN|Infinity/);
      }
    }
  });
});

describe('3D Carousel authoring and delivery', () => {
  it('upgrades an exact stock carousel and preserves a customized template', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    fs.writeFile('components/Carousel3D.tsx', LEGACY_CAROUSEL_3D_COMPONENT);
    syncBuiltInCodeComponents(fs);
    expect(fs.readFile('components/Carousel3D.tsx')).toBe(CAROUSEL_3D_COMPONENT);
    const customized = LEGACY_CAROUSEL_3D_COMPONENT + '\n// My custom card behavior';
    fs.writeFile('components/Carousel3D.tsx', customized);
    syncBuiltInCodeComponents(fs);
    expect(fs.readFile('components/Carousel3D.tsx')).toBe(customized);
  });
  it('installs through the normal registry and compiles with controls for every spatial parameter', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    expect(installBuiltInCodeComponent(fs, 'Carousel3D')).toBe(true);
    expect(installBuiltInCodeComponent(fs, 'Carousel3D')).toBe(false);
    const meta = parseComponentControlsMeta(fs.readFile('components/Carousel3D.tsx')!)!;
    const flat = Object.fromEntries(Object.entries(meta.controls).flatMap(([key, value]) =>
      value.type === 'group' ? Object.entries(value.controls!) : [[key, value]]));
    for (const key of Object.keys(normalizeCarousel3D({}))) expect(flat[key], key).toBeDefined();
    expect(flat.children.slotMax).toBe('infinite');
    expect(compileCodeComponent(CAROUSEL_3D_COMPONENT, 'Carousel3D')).toBeTruthy();
    expect(checkFile(CAROUSEL_3D_COMPONENT, { kind: 'code-component', path: 'components/Carousel3D.tsx' })).toEqual([]);
  });

  it('packages the shared runtime when the carousel is the only spatial feature', async () => {
    const result = await buildSourceExport({
      'components/Carousel3D.tsx': CAROUSEL_3D_COMPONENT,
    }, { name: 'carousel', runtimeRange: '^0.0.32' });
    expect(result.files['vendor/revyme-runtime/dist/index.js']).toContain('RevymeCarousel3D');
    expect(JSON.parse(result.files['package.json']).dependencies['@revyme/runtime']).toBe('file:./vendor/revyme-runtime');
  });
});
