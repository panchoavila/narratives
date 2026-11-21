/** Native scroll-container pagination; slide content remains individually editable. */
export const SCROLL_CAROUSEL_CONTROLS_COMPONENT = `'use client';
/** @label "Scroll Carousel Controls" */
/** @defaultWidth 80 */
/** @defaultHeight 12 */
/** @canvasStyleOwner component */
/** @controls {
  "targetId": { "type": "text", "label": "Container data-id", "default": "" },
  "labels": { "type": "text", "label": "Labels (one per line)", "default": "First\\nSecond\\nThird" },
  "size": { "type": "number", "label": "Dot size", "default": 6, "min": 1, "max": 40, "step": 1 },
  "gap": { "type": "number", "label": "Gap", "default": 8, "min": 0, "max": 100, "step": 1 },
  "color": { "type": "color", "label": "Dot color", "default": "#008800" },
  "activeColor": { "type": "color", "label": "Active color", "default": "#00ff00" }
} */
import { RevymeScrollCarouselControls, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type Props = import('@revyme/runtime').ScrollCarouselControlsProps;
function ScrollCarouselControls(props: Props) { const isStatic = useStaticCanvas(); return <RevymeScrollCarouselControls {...props} static={isStatic} />; }
export default withResponsiveProps(ScrollCarouselControls);
`;
