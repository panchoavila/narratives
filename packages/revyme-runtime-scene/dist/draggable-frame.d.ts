import { type HTMLMotionProps } from 'framer-motion';
import { type ReactNode } from 'react';
export interface DraggableFrameProps extends Omit<HTMLMotionProps<'div'>, 'drag' | 'dragConstraints' | 'dragMomentum' | 'dragSnapToOrigin' | 'children'> {
    children?: ReactNode;
    axis?: 'both' | 'x' | 'y';
    enabled?: boolean;
    momentum?: boolean;
    snapBack?: boolean;
    constrained?: boolean;
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    moveLabel?: string;
    static?: boolean;
}
/** A gesture layer around editable children; local movement never changes their layout or rotation. */
export declare function RevymeDraggableFrame({ children, axis, enabled, momentum, snapBack, constrained, minX, maxX, minY, maxY, moveLabel, static: isStatic, style, onKeyDown, onKeyUp, ...props }: DraggableFrameProps): import("react/jsx-runtime").JSX.Element;
