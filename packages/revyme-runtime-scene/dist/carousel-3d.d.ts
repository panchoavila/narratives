import { type HTMLAttributes, type ReactNode } from 'react';
import { type Carousel3DConfig } from './carousel-3d-config';
export interface Carousel3DProps extends Partial<Carousel3DConfig>, Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    children?: ReactNode;
    static?: boolean;
}
/** Live DOM planes on one shared 3D layout. The slot owns spatial transforms. */
export declare function RevymeCarousel3D(props: Carousel3DProps): import("react/jsx-runtime").JSX.Element;
