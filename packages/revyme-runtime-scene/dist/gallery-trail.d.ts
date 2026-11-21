import { type HTMLAttributes, type ReactNode } from 'react';
export interface GalleryTrailProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    children?: ReactNode;
    images?: string[] | string;
    targetId?: string;
    width?: number;
    height?: number;
    frequency?: number;
    visibleFor?: number;
    radius?: number;
    fit?: 'fit' | 'fill' | 'stretch';
    static?: boolean;
}
/** Adds temporary decorative images to a pointer trail; the source content stays live. */
export declare function RevymeGalleryTrail({ children, images, targetId, width, height, frequency, visibleFor, radius, fit, static: isStatic, style, ...props }: GalleryTrailProps): import("react/jsx-runtime").JSX.Element;
