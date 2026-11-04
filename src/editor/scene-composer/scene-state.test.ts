import { describe, expect, it } from 'vitest';
import { alignSceneView, DEFAULT_SCENE_CAMERA, orbitSceneView, SCENE_AXIS_VIEWS, snapSceneView } from './scene-state';
import { projectScenePoint, sceneTransform } from '@/shared/scene-projection';

describe('Blender default navigation semantics', () => {
  it('opens upright orthographic with the left edge above the right edge', () => {
    expect(DEFAULT_SCENE_CAMERA.perspective).toBe(false);
    expect(projectScenePoint(1, 0).y).toBeGreaterThan(0);
    expect(projectScenePoint(0, 1).x).toBe(0);
  });
  it('aligns six axes and flips repeated clicks to the opposite side', () => {
    for (const view of Object.keys(SCENE_AXIS_VIEWS) as (keyof typeof SCENE_AXIS_VIEWS)[]) {
      const aligned = alignSceneView({ ...DEFAULT_SCENE_CAMERA, perspective: true }, view);
      expect(aligned).toMatchObject({ ...SCENE_AXIS_VIEWS[view], perspective: false, view });
      const opposite = alignSceneView(aligned, view);
      expect(opposite.view).not.toBe(view);
      expect(alignSceneView(opposite, opposite.view as keyof typeof SCENE_AXIS_VIEWS).view).toBe(view);
    }
  });
  it('orbits freely in ortho, but leaves an aligned axis in perspective', () => {
    expect(orbitSceneView(DEFAULT_SCENE_CAMERA, 10, 10)).toMatchObject({ yaw: -41, pitch: DEFAULT_SCENE_CAMERA.pitch + 4, perspective: false, view: 'user' });
    expect(orbitSceneView(alignSceneView(DEFAULT_SCENE_CAMERA, 'front'), 10, 10).perspective).toBe(true);
  });
  it('Alt snaps to a face, edge or corner within 15 degrees', () => {
    const free = { ...DEFAULT_SCENE_CAMERA, perspective: true };
    expect(snapSceneView({ ...free, pitch: 5, yaw: 5 })).toMatchObject({ pitch: 0, yaw: 0, view: 'front', perspective: false });
    expect(snapSceneView({ ...free, pitch: 0, yaw: -44 })).toMatchObject({ pitch: 0, yaw: -45, view: 'user', perspective: true });
    expect(snapSceneView({ ...free, pitch: -34, yaw: -44 }).pitch).toBeCloseTo(DEFAULT_SCENE_CAMERA.pitch);
    const far = { ...free, pitch: 0, yaw: 22.5 };
    expect(snapSceneView(far)).toBe(far);
  });
  it('changes real projection, not only a label', () => {
    expect(sceneTransform({ enabled: true, perspective: false })).not.toContain('perspective');
    expect(sceneTransform({ enabled: true, perspective: true, distance: 2400 })).toContain('perspective(2400px)');
  });
});
