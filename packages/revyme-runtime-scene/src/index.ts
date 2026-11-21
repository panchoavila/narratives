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
export { runGlitchNavigation } from './glitch-navigation';
export { normalizeGlitch, DEFAULT_GLITCH, type GlitchConfig } from './glitch-config';
export { attachGlitchElements } from './glitch-elements';
export { attachGlyphRainElements, normalizeGlyphRain, DEFAULT_GLYPH_RAIN, type GlyphRainConfig } from './glyph-rain';
export { runRippleNavigation } from './ripple-navigation';
export { DEFAULT_RIPPLE, normalizeRipple, type RippleConfig } from './ripple-config';
export { attachRippleElements } from './ripple-elements';
export { DEFAULT_PARTICLE, normalizeParticle, type ParticleConfig } from './particle-config';
export { attachParticleElements } from './particle-elements';
export { DEFAULT_VHS, normalizeVhs, VHS_CONTROLS, type VhsConfig } from './vhs-config';
export { RevymeVhs, RevymeVhsPage } from './vhs-surface';
export { runVhsNavigation } from './vhs-navigation';
export { attachLiquidGlassElements } from './liquid-glass-elements';
export { RevymeLiquidBackdrop } from './liquid-glass-backdrop';
export { RevymeCarousel3D, type Carousel3DProps } from './carousel-3d';
export { RevymeNovaWarp, type NovaWarpProps } from './nova-warp';
export { RevymeAdvancedHeading, type AdvancedHeadingProps } from './advanced-heading';
export { RevymeAdvancedFrame, type AdvancedFrameProps } from './advanced-frame';
export { RevymeRichContent, sanitizeRichContent, richContentText, richContentHeadings, type RichContentProps, type RichHeadingStyle } from './rich-content';
export { DEFAULT_LIQUID_GLASS, normalizeLiquidGlass, parseLiquidGlassAttribute, type LiquidGlassConfig } from './liquid-glass-config';

// Editorial flow: long-form text laid out like a magazine. The measuring half of the engine
// (Pretext, hyphenation patterns) is a lazy chunk that `RevymeFlow` loads in the browser.
export { RevymeFlow, type RevymeFlowProps } from './editorial/RevymeFlow';
export { pieceDocument, type EditorialPiece, type EditorialHero } from './editorial/document';
export { parseEditorialMarkdown } from './editorial/markdown';
export {
  buildEditorialPreset,
  isEditorialPresetId,
  EDITORIAL_PRESET_IDS,
  type EditorialPresetId,
  type EditorialTheme,
  type EditorialFont,
} from './editorial/presets';
export type { FlowDocument, FlowLayout, FlowMode, FlowSpec } from './editorial/types';

export { RevymeHover3D, type Hover3DProps } from './hover-3d';

export { RevymeConfetti, type ConfettiProps } from './celebration';

export { RevymePixelRevelation, type PixelRevelationProps } from './image-effects';

export { RevymeDither, type DitherProps } from './image-effects';

export { RevymeReadingTime, type ReadingTimeProps } from './article-widgets';

export { RevymeDateText, type DateTextProps } from './article-widgets';

export { RevymeShareButton, type ShareButtonProps } from './article-widgets';

export { RevymeArticleTOC, type ArticleTOCProps } from './article-widgets';

export { RevymeAudioPlayer, type AudioPlayerProps } from './article-widgets';

export { RevymeQRCode, type QRCodeProps } from './article-widgets';

export { RevymeSmartEye, type SmartEyeProps } from './smart-eye';

export { RevymeGalleryTrail, type GalleryTrailProps } from './gallery-trail';

export { RevymeViewportVideo, type ViewportVideoProps } from './viewport-video';

export { RevymeCookieConsent, type CookieConsentProps } from './cookie-consent';

export { RevymeCookieSettingsButton } from './cookie-consent';

export { RevymeNumberText, type NumberTextProps } from './article-widgets';

export { RevymeCycleHeading, type CycleHeadingProps } from './cycle-heading';

export { useReducedMotionValue } from './use-reduced-motion-value';

export { RevymeImageLightbox, type ImageLightboxProps } from './image-lightbox';

export { RevymeAlternatingRows, type AlternatingRowsProps } from './alternating-rows';

export { RevymeSmartSpacer, type SmartSpacerProps } from './smart-spacer';

export { RevymeScrollCarouselControls, type ScrollCarouselControlsProps } from './scroll-carousel-controls';

export { RevymeBodyScrollLock, type BodyScrollLockProps } from './body-scroll-lock';

export { RevymeDraggableFrame, type DraggableFrameProps } from './draggable-frame';

export { RevymeFormTracker, type FormTrackerProps } from './form-tracker';

export { RevymeDeviceTracker, type DeviceTrackerProps } from './device-tracker';
