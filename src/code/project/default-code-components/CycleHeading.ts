/** Editable phrase cycling that composes the shared scramble heading. */
export const CYCLE_HEADING_COMPONENT = `'use client';
/** @label "Cycle Heading" */
/** @comment "Cycles through phrases, one per line, with a scramble transition." */
/** @defaultWidth 500 */
/** @defaultHeight 48 */
/** @canvasStyleOwner component */
/** @controls {
  "phrases": { "type": "text", "label": "Phrases (one per line)", "default": "First phrase\\nSecond phrase" },
  "mode": { "type": "select", "label": "Transition", "default": "scramble", "options": [{"label":"Scramble","value":"scramble"},{"label":"Staggered slide","value":"stagger"}] },
  "staggerDelay": { "type": "number", "label": "Letter stagger (s)", "default": 0.035, "min": 0, "max": 1, "step": 0.005 },
  "exitStaggerDelay": { "type": "number", "label": "Exit stagger (s)", "default": 0.035, "min": 0, "max": 1, "step": 0.001 },
  "easing": { "type": "select", "label": "Slide easing", "default": "smooth", "options": [{"label":"Smooth","value":"smooth"},{"label":"Framer","value":"framer"}] },
  "pauseDuration": { "type": "number", "label": "Pause (s)", "default": 5, "min": 0.2, "max": 60, "step": 0.1 },
  "duration": { "type": "number", "label": "Scramble (s)", "default": 0.8, "min": 0, "max": 30, "step": 0.1 },
  "tag": { "type": "select", "label": "Tag", "default": "p", "options": [{"label":"p","value":"p"},{"label":"h2","value":"h2"},{"label":"h3","value":"h3"}] },
  "fontFamily": { "type": "font", "label": "Font", "default": "inherit" },
  "fontSize": { "type": "number", "label": "Size", "default": 22, "min": 1, "max": 300, "step": 1 },
  "lineHeight": { "type": "number", "label": "Line height", "default": 1.1, "min": 0.5, "max": 3, "step": 0.05 },
  "letterSpacing": { "type": "number", "label": "Letter spacing", "default": 0, "min": -20, "max": 20, "step": 0.1 },
  "color": { "type": "color", "label": "Color", "default": "#000000" },
  "textAlign": { "type": "select", "label": "Alignment", "default": "center", "options": [{"label":"Left","value":"left"},{"label":"Center","value":"center"},{"label":"Right","value":"right"}] }
} */
import { RevymeCycleHeading, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type CycleHeadingProps = import('@revyme/runtime').CycleHeadingProps;
function CycleHeading(props: CycleHeadingProps) { const isStatic = useStaticCanvas(); return <RevymeCycleHeading {...props} static={isStatic} />; }
export default withResponsiveProps(CycleHeading);
`;
