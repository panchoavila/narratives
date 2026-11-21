/** Editable wrapper for viewport-aware video playback. */
export const VIEWPORT_VIDEO_COMPONENT = `'use client';
/** @label "Viewport Video" */
/** @comment "Plays a real video while visible, pauses outside the viewport, and respects reduced motion." */
/** @defaultWidth 600 */
/** @defaultHeight 338 */
/** @canvasStyleOwner component */
/** @controls {
  "src": { "type": "text", "label": "Video URL", "default": "" },
  "poster": { "type": "upload", "label": "Poster", "accept": "image/*", "default": "" },
  "fit": { "type": "select", "label": "Fit", "default": "cover", "options": [{"label":"Cover","value":"cover"},{"label":"Contain","value":"contain"},{"label":"Fill","value":"fill"}] },
  "playInView": { "type": "toggle", "label": "Play in view", "default": true },
  "controls": { "type": "toggle", "label": "Controls", "default": false },
  "muted": { "type": "toggle", "label": "Muted", "default": true },
  "loop": { "type": "toggle", "label": "Loop", "default": true }
} */
import { RevymeViewportVideo, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type ViewportVideoProps = import('@revyme/runtime').ViewportVideoProps;
function ViewportVideo(props: ViewportVideoProps) { const isStatic = useStaticCanvas(); return <RevymeViewportVideo {...props} static={isStatic} />; }
export default withResponsiveProps(ViewportVideo);
`;
