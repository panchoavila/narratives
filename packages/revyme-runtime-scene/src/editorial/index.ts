// editorial/index.ts — public surface of the editorial flow engine.

export * from './types';
export { parseEditorialMarkdown } from './markdown';
export { createHyphenator, hyphenateRuns, loadHyphenator, type HyphenateOptions } from './hyphenate';
export { createPretextMeasurer, fontString } from './measure';
export { resolveBodyGrid, pageGeometry } from './geometry';
export { fitText } from './fit';
export { layoutFlow } from './layout';
export {
  buildEditorialPreset, isEditorialPresetId, EDITORIAL_PRESET_IDS,
  type EditorialPresetId, type EditorialTheme, type EditorialFont,
} from './presets';
