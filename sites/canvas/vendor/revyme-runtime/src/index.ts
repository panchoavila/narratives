// @revyme/runtime — runtime utilities used by Revyme-generated React code.
//
// Lives outside `canvas-poc` so design components and code components in
// any Revyme project (and eventually any external React project, once
// published to npm) can import from a stable `@revyme/runtime` package
// name instead of a project-local `@/lib/...` alias.
//
// Inside Revyme's own monorepo: linked via `file:../runtime` in
// `canvas-poc/package.json`. No npm publish needed for in-house use.
// External consumers will install via `npm i @revyme/runtime` once we
// publish — same shape as `framer-motion`.

export { default as withResponsiveProps } from './withResponsiveProps';
export {
  withCursor,
  CursorPortal,
  type CursorMode,
  type CursorSide,
  type CursorAlign,
  type CursorTransition,
  type CursorOpts,
} from './cursor-runtime';
export { useStaticCanvas } from './useStaticCanvas';
export {
  RevymeSplitText,
  type SplitTextSpec,
  type SplitTextScope,
  type RevymeSplitTextProps,
} from './split-text';
export {
  playSketchDraw,
  type SketchAnimOpts,
  type SketchAnimMode,
  type SketchAnimTrigger,
  type SketchAnimTransition,
} from './sketch-draw';
export { localizeRows, type RowI18n } from './localize-rows';
export {
  Override,
  createStore,
  hostCompat,
  type OverrideProps,
  type CodeOverride,
} from './code-override';
export { RevymeTicker, type RevymeTickerProps, type TickerDirection, type TickerOverride, type TickerScope } from './ticker';
export { runDisplacementNavigation, type DisplacementNavigationOptions, type DisplacementNavigationResult } from './displacement-navigation';
export { normalizeDisplacement, DEFAULT_DISPLACEMENT, type DisplacementConfig } from './displacement-config';
export { createDisplacement } from './displacement-renderer';
