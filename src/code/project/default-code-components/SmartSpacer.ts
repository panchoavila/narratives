/** Editable wrapper for target-measured layout spacing. */
export const SMART_SPACER_COMPONENT = `'use client';
/** @label "Smart Spacer" */
/** @comment "Sizes a spacer from another element and falls back deterministically in static canvas." */
/** @defaultWidth 16 */
/** @defaultHeight 16 */
/** @canvasStyleOwner component */
/** @controls {
  "sourceMode": { "type":"select", "label":"Source", "default":"id", "options":[{"value":"id","label":"Element ID"},{"value":"selector","label":"Selector"}] },
  "targetId": { "type":"text", "label":"Target ID", "default":"" },
  "targetSelector": { "type":"text", "label":"Target selector", "default":"" },
  "widthFrom": { "type":"select", "label":"Width from", "default":"targetHeight", "options":[{"value":"targetWidth","label":"Target width"},{"value":"targetHeight","label":"Target height"},{"value":"none","label":"Fallback"}] },
  "heightFrom": { "type":"select", "label":"Height from", "default":"targetHeight", "options":[{"value":"targetWidth","label":"Target width"},{"value":"targetHeight","label":"Target height"},{"value":"none","label":"Fallback"}] },
  "wScale": { "type":"number", "label":"Width scale", "default":1, "min":0, "max":100, "step":0.01 },
  "hScale": { "type":"number", "label":"Height scale", "default":1, "min":0, "max":100, "step":0.01 },
  "wOffset": { "type":"number", "label":"Width offset", "default":0, "min":-10000, "max":10000, "step":1 },
  "hOffset": { "type":"number", "label":"Height offset", "default":0, "min":-10000, "max":10000, "step":1 },
  "wMin": { "type":"number", "label":"Min width", "default":0, "min":0, "max":10000, "step":1 },
  "hMin": { "type":"number", "label":"Min height", "default":0, "min":0, "max":10000, "step":1 },
  "wMax": { "type":"number", "label":"Max width (0 = none)", "default":0, "min":0, "max":10000, "step":1 },
  "hMax": { "type":"number", "label":"Max height (0 = none)", "default":0, "min":0, "max":10000, "step":1 },
  "fallbackWidth": { "type":"number", "label":"Fallback width", "default":16, "min":0, "max":10000, "step":1 },
  "fallbackHeight": { "type":"number", "label":"Fallback height", "default":16, "min":0, "max":10000, "step":1 },
  "preferFallbackInCanvas": { "type":"toggle", "label":"Fallback in canvas", "default":true },
  "background": { "type":"color", "label":"Background", "default":"transparent" }
} */
import { RevymeSmartSpacer, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type SmartSpacerProps = import('@revyme/runtime').SmartSpacerProps;
function SmartSpacer(props: SmartSpacerProps) { const isStatic = useStaticCanvas(); return <RevymeSmartSpacer {...props} static={isStatic} />; }
export default withResponsiveProps(SmartSpacer);
`;
