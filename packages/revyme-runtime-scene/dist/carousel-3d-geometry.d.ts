import type { Carousel3DConfig } from './carousel-3d-config';
type Point = {
    x: number;
    y: number;
    z: number;
};
export interface Carousel3DPose {
    transform: string;
    center: Point;
    normal: Point;
    opacity: number;
    visible: boolean;
}
/** Gap is measured along the layout surface before scene scaling/projection. */
export declare function carousel3DLayout(config: Carousel3DConfig, count: number): {
    rows: number;
    columns: number[];
    latitudes: number[];
    radius: number;
    lineStep: number;
    rowStep: number;
};
export declare function carousel3DGeometry(config: Carousel3DConfig, count: number, phase?: number, rotation?: {
    x: number;
    y: number;
    z: number;
}): Carousel3DPose[];
/** Fit the whole tilted volume, allowing intentional camera offsets to crop it. */
export declare function carousel3DFit(config: Carousel3DConfig, count: number, width: number, height: number): number;
export {};
