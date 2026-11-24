// The 3D inspection camera on the canvas demo (sites/canvas): orbit and pinch
// freeze the raster scale of the 3D layers until the camera rests, the floor
// grid is bounded by the viewport width, and no full-page measure pass runs
// while inspecting. See e2e/helpers/scene-inspection.ts.
import { defineScenePerformanceSpecs } from '../../helpers/scene-inspection';

defineScenePerformanceSpecs('canvas', 'the canvas demo');
