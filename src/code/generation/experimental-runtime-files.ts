// Portable local runtime, loaded only when exporting a Displacement project.
// Include its source and licenses alongside the executable bundle.
const runtimeFiles = import.meta.glob<string>([
  '../../../packages/revyme-runtime-scene/src/**/*',
  '../../../packages/revyme-runtime-scene/dist/**/*',
  '../../../packages/revyme-runtime-scene/package.json',
  '../../../packages/revyme-runtime-scene/tsconfig.build.json',
  '../../../packages/revyme-runtime-scene/HTML-TO-IMAGE-LICENSE',
  '../../../packages/revyme-runtime-scene/LIQUIDGL-LICENSE',
  '../../../packages/revyme-runtime-scene/PRETEXT-LICENSE',
  '../../../packages/revyme-runtime-scene/HYPHEN-LICENSE',
  '../../../packages/revyme-runtime-scene/THREE-LICENSE',
  '../../../packages/revyme-runtime-scene/RICH-CONTENT-LICENSES',
  '../../../packages/revyme-runtime-scene/QR-CODE-LICENSE',
  '../../../packages/revyme-runtime-scene/build.mjs',
  '../../../packages/revyme-runtime-scene/EXPERIMENT.md',
], { query: '?raw', import: 'default', eager: true });

export const EXPERIMENTAL_RUNTIME_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(runtimeFiles).map(([path, source]) => [
    path.replace('../../../packages/revyme-runtime-scene/', 'vendor/revyme-runtime/'),
    source,
  ]),
);
