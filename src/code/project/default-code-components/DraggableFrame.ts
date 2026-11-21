const number = (label: string, value: number) => ({ type:'number', label, default:value, min:-10000, max:10000, step:1 });
const controls = {
 children:{type:'slot',label:'Content',slotMax:'infinite'},
 enabled:{type:'toggle',label:'Enabled',default:true},
 axis:{type:'select',label:'Axis',default:'both',options:['both','x','y'].map(value=>({value,label:value}))},
 momentum:{type:'toggle',label:'Momentum',default:false},
 snapBack:{type:'toggle',label:'Return to origin',default:false},
 constrained:{type:'toggle',label:'Limit movement',default:false},
 minX:number('Left limit',-200),maxX:number('Right limit',200),minY:number('Top limit',-200),maxY:number('Bottom limit',200),
 moveLabel:{type:'text',label:'Keyboard label',default:'Move item with arrow keys'},
};
export const DRAGGABLE_FRAME_COMPONENT = `'use client';
/** @label "Draggable Frame" */
/** @defaultWidth 240 */
/** @defaultHeight 220 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { Children, cloneElement, isValidElement } from 'react';
import { RevymeDraggableFrame, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type DraggableFrameProps = import('@revyme/runtime').DraggableFrameProps;
type CSSProperties = import('react').CSSProperties;
function DraggableFrame({children,...props}: DraggableFrameProps) {
 const isStatic = useStaticCanvas();
 const slots = Children.toArray(children).map(child => isValidElement<{style?:CSSProperties; 'data-canvas-node'?: boolean | string}>(child) && child.props['data-canvas-node']
  ? cloneElement(child,{style:{...child.props.style,position:'relative',left:'auto',top:'auto',right:'auto',bottom:'auto',margin:0}}) : child);
 return <RevymeDraggableFrame {...props} static={isStatic}>{slots}</RevymeDraggableFrame>;
}
export default withResponsiveProps(DraggableFrame);
`;
