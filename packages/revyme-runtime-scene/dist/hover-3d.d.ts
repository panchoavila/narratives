import { type Transition } from 'framer-motion';
import { type HTMLAttributes } from 'react';
export interface Hover3DProps extends HTMLAttributes<HTMLDivElement> {
    angle?: number;
    directions?: 'all' | 'vertical' | 'horizontal';
    perspective?: number;
    transitionConfig?: string | Transition;
    static?: boolean;
}
/** Resolve pointer displacement in the host's local rectangle. */
export declare function hover3DAngles(clientX: number, clientY: number, rect: {
    left: number;
    top: number;
    width: number;
    height: number;
}, angle: number, directions: Hover3DProps['directions']): [number, number];
export declare function hover3DTransition(config?: Hover3DProps['transitionConfig']): Transition;
/** A live, perspective-transformed surface. Its children keep their own layout and events. */
export declare function RevymeHover3D({ angle, directions, perspective, transitionConfig, static: isStatic, children, style, onPointerEnter, onPointerLeave, onPointerMove, ...props }: Hover3DProps): import("react/jsx-runtime").JSX.Element;
