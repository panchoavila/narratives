// workspace-runtime.ts — which site sources need the workspace build of `@revyme/runtime`.
//
// Some runtime features exist only in this workspace's build (`packages/revyme-runtime-scene`), not
// in the published npm package. When a site uses one, publishing and code export ship that build as
// `vendor/revyme-runtime` and point the site's dependency at it. Both decide with this one test, so
// they cannot disagree about which sites need it.

/** Runtime components that exist only in the workspace build. */
export const WORKSPACE_RUNTIME_COMPONENTS = [
  'RevymeVhs',
  'RevymeVhsPage',
  'RevymeLiquidBackdrop',
  'RevymeCarousel3D',
  'RevymeNovaWarp',
  'RevymeAdvancedHeading',
  'RevymeAdvancedFrame',
  'RevymeHover3D',
  'useReducedMotionValue',
  'RevymeCycleHeading',
  'RevymeNumberText',
  'RevymeCookieSettingsButton',
  'RevymeCookieConsent',
  'RevymeViewportVideo',
  'RevymeImageLightbox',
  'RevymeDeviceTracker',
  'RevymeFormTracker',
  'RevymeDraggableFrame',
  'RevymeBodyScrollLock',
  'RevymeScrollCarouselControls',
  'RevymeSmartSpacer',
  'RevymeAlternatingRows',
  'RevymeGalleryTrail',
  'RevymeSmartEye',
  'RevymeQRCode',
  'RevymeAudioPlayer',
  'RevymeArticleTOC',
  'RevymeShareButton',
  'RevymeDateText',
  'RevymeReadingTime',
  'RevymeDither',
  'RevymePixelRevelation',
  'RevymeConfetti',
  'RevymeRichContent',
  'RevymeFlow',
] as const;

/** Generated markers left in source by effects that the workspace build implements. */
const WORKSPACE_RUNTIME_MARKERS = ['@pt-scene-', '@revyme-glitch-runtime-'] as const;

const COMPONENT_TAG = new RegExp(`<(${WORKSPACE_RUNTIME_COMPONENTS.join('|')})\\b`);

/** True when `code` (one file, or several joined) uses anything only the workspace build has. */
export function needsWorkspaceRuntime(code: string): boolean {
  return WORKSPACE_RUNTIME_MARKERS.some((marker) => code.includes(marker)) || COMPONENT_TAG.test(code);
}
