Local unpublished extension of @revyme/runtime 0.0.32. It provides Revyme's
Displacement, Glitch, Glyph Rain, Ripple and Particle Object implementations.
The latter effects were independently implemented using Canvas UI as a visual
reference. Includes html-to-image 1.11.13 (MIT); see HTML-TO-IMAGE-LICENSE.

Glitch and Ripple can run during route changes. The four newer effects can be
applied to individual elements; Particle Object targets images and inline SVG.
Snapshot-based effects return to ordinary DOM rendering when capture or WebGL
fails. Particle Object leaves the original visible if its source cannot be
read. Animations respect reduced motion and stop while offscreen or hidden.

## Liquid Glass

Liquid Glass is a persistent visual treatment, authored in **Effects → Liquid
Glass**, independently of the Animation section. Its versioned configuration is
stored in `data-liquid-glass`; the existing element and editable children remain
the document. The native controls install the shared client observer through
`ensureElementEffectsRuntime()`.

The optical engine is liquidGL 3.0.0 by NaughtyDuk, distributed under MIT (see
`LIQUIDGL-LICENSE`). Source: https://github.com/naughtyduk/liquidGL, upstream
`package/liquidGL.js` blob `acd46bb8d991227adf16dbd4faafcd1ae6e286e2`.
No demonstration assets or audio were imported.

The vendored engine uses an isolated factory. Revyme supplies viewport-local
measurements in the editor, preserves Motion-owned styles and pointer input,
composes tilt/drag without replacing the authored transform, detects WAAPI
animations, avoids temporary GPU probe contexts and bounds the background
snapshot to eight megapixels. Runtime observers are shared per document and
release offscreen/hidden lenses. GPU/context loss restores usable HTML with a
CSS fallback. Reduced motion retains static glass while disabling ambient and
pointer-driven movement.

The presets cover clear/frosted/chromatic/tinted glass, fluid interaction,
magnification, dragging, tilt and playback-audio response. Multiple lenses use
the element's existing CSS stacking order. Foreground HTML stays interactive;
audio response analyses a playback capture stream without rerouting the player.
Browsers without media capture retain ordinary playback.

By default the engine rasterises DOM for refraction. Transform and opacity
animations can update dynamically between full snapshots.

Opt in to browser-native capture with `RevymeLiquidBackdrop` from
`@revyme/runtime`. Place it first in a positioned, sized scene and place the
lenses alongside it as direct siblings with positive stacking order. Put Motion
and other visual content inside the backdrop. The browser's paint events
refresh a shared, bounded backdrop canvas in live preview and exported sites.
The static editor keeps the authored HTML. Without native capture, the runtime
rasterises that scene and the backdrop stays visible as ordinary HTML.

The native source covers the authored backdrop and the engine composites
overlapping lenses in CSS stacking order. For arbitrary page content, use the
default capture path. Specular highlights still come from the glass shader.

Displacement/Glitch/Ripple page transitions use normal navigation when a live
glass canvas is present. Their DOM-only capture must not silently omit the
material. Full-scene capture belongs to the subsequent compositor work.

Build with `npm run build --prefix packages/revyme-runtime-scene` from the
repository root. Source export includes
the emitted lazy chunks, declarations, source and third-party licences.

## 3D Carousel

`RevymeCarousel3D` distributes live HTML on a cylinder, a sphere or a line.
Its scene rotation, card orientation, local rotation and camera framing are
independent. The Insert panel installs the `Carousel3D` adapter with native
slot connections and grouped property controls. CSS 3D supplies the planar
composition. The static editor renders the configured pose, while live sites
support drag, orbit, keyboard navigation and optional rotation.

`distribution="gap"` derives spacing from item size plus `gap` in local scene
units for all three layouts. Cylinder/sphere radii adapt to item count, arc and
depth; sphere bands also reserve vertical spacing and allocate fewer cards near
the poles. `distribution="fill"` preserves explicit radius/rowGap/spacing.
Fit, camera projection and local card rotations affect the apparent spacing.

The native CMS control connects an editable collection frame to the Items slot.
The runtime expands its `data-revyme-collection-slot` wrapper into individual
cards keyed by record ID. Canvas serialization uses the existing CMS filter,
sort and binding evaluators; collection edits refresh canvas and preview. The
template is ordinary editable JSX, and exported sites use the same runtime and
CMS JSON imports. Published data changes follow the existing republish flow.

Spatial DOM components expose `data-revyme-spatial-root`,
`data-revyme-spatial-camera` and `data-revyme-spatial-surface`. In the editor's
3D viewport, ancestors preserve their depth and the inspection camera supplies
the projection. Inspection exposes rear surfaces and temporarily removes
grouping effects that flatten geometry. Leaving inspection restores the site's
projection and surface visibility through the scoped stylesheet lifecycle.

Reference arrangements and browser evidence live in
`research/2026-11-08-carousel-3d/`.

## Editorial flow

`RevymeFlow` lays a long piece out like a magazine: pages of columns, fitted headlines, drop caps,
pull quotes and pictures placed by role, from seven built-in layouts (`buildEditorialPreset`) or a
`FlowSpec` of your own. The layout engine lives in `src/editorial/` and is pure TypeScript; text is
measured with Pretext 1.0.0 by Cheng Lou and contributors (MIT, see `PRETEXT-LICENSE`) and
hyphenated with `hyphen` 1.14.1 by Yevhen Tiurin (ISC, see `HYPHEN-LICENSE`), whose patterns are
ported from the TeX hyphenation patterns on CTAN.

The server renders the whole piece as an ordinary article. In the browser the component loads the
measuring half of the engine as a lazy chunk, waits for the piece's fonts, and paints every line
where the engine placed it, keeping one element per paragraph in reading order. It lays out again
when its width or the viewport height changes and when a web font finishes loading. Design notes
and evidence: `briefs/12-11-2026-editorial-flow-engine.md` and
`research/2026-11-12-editorial-flow/`.

Pages follow each other down the page (`mode="paged-y"`), across it (`mode="paged-x"`), or as the
page reads (`mode="auto"`): across where the page root's `--revyme-page-flow` is `horizontal`,
which the editor's Page Flow sets per breakpoint. Across, each page is the host's width by its
height (or the window's, when the host has none that fits); the pages after the first overflow to
the right, are reserved by a zero-height box after the host, and the reader's place is kept across
relayouts. After every layout the component fires `revyme:layout` on the window, which the
generated Smooth Scroll controller uses to measure the page again.
