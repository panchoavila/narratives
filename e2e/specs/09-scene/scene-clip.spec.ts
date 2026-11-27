// 3D keeps the 2D crops on the canvas demo (sites/canvas): photos and text keep
// their own crop, and leaves a container or a breakpoint crops in 2D are cut
// in 3D without flattening the layers. See e2e/helpers/scene-inspection.ts.
import { defineSceneClipSpecs } from '../../helpers/scene-inspection';

defineSceneClipSpecs('canvas', 'the canvas demo');
