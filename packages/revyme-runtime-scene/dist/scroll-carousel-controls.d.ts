import { type HTMLAttributes } from 'react';
export interface ScrollCarouselControlsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'color'> {
    targetId?: string;
    labels?: string;
    size?: number;
    gap?: number;
    color?: string;
    activeColor?: string;
    static?: boolean;
}
/** Controls an editable native scroll container; no copy of the slides is made. */
export declare function RevymeScrollCarouselControls({ targetId, labels, size, gap, color, activeColor, static: isStatic, style, ...rest }: ScrollCarouselControlsProps): import("react/jsx-runtime").JSX.Element;
