/** Editable wrapper for the runtime's live perspective surface. */
export const HOVER_3D_COMPONENT = `'use client';
/** @label "3D Hover" */
/** @comment "Tilts connected content in perspective as the pointer moves." */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @canvasStyleOwner component */
/** @controls {
  "children": { "type": "slot", "label": "Content", "slotMax": "infinite" },
  "angle": { "type": "number", "label": "Angle", "default": 12, "min": -45, "max": 45, "step": 1 },
  "directions": { "type": "select", "label": "Directions", "default": "all", "options": [{"label":"All","value":"all"},{"label":"Vertical","value":"vertical"},{"label":"Horizontal","value":"horizontal"}] },
  "perspective": { "type": "number", "label": "Perspective", "default": 1000, "min": 500, "max": 5000, "step": 10 },
  "transitionConfig": { "type": "transition", "label": "Transition", "default": { "type": "spring", "stiffness": "200", "damping": "30", "mass": "1" } }
} */
import { Children, cloneElement, isValidElement } from 'react';
import { RevymeHover3D, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type Hover3DProps = import('@revyme/runtime').Hover3DProps;
type CSSProperties = import('react').CSSProperties;
function Hover3D({ children, ...props }: Hover3DProps) {
  const isStatic = useStaticCanvas();
  const slots = Children.toArray(children).map(child =>
    isValidElement<{ style?: CSSProperties; 'data-canvas-node'?: boolean | string }>(child) && child.props['data-canvas-node']
      ? cloneElement(child, { style: { ...child.props.style, position: 'relative', left: 'auto', top: 'auto', right: 'auto', bottom: 'auto', margin: 0 } })
      : child);
  return <RevymeHover3D {...props} static={isStatic}>{slots}</RevymeHover3D>;
}
export default withResponsiveProps(Hover3D);
`;
