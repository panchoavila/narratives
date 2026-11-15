/** All distances are CSS pixels in the carousel's local scene. Angles are degrees. */
export interface Carousel3DConfig {
    layout: 'cylinder' | 'sphere' | 'line';
    distribution: 'fill' | 'gap';
    gap: number;
    radius: number;
    depth: number;
    arc: number;
    phase: number;
    rows: number;
    rowGap: number;
    stagger: number;
    latitude: number;
    pitch: number;
    spacing: number;
    rotateX: number;
    rotateY: number;
    rotateZ: number;
    offsetX: number;
    offsetY: number;
    offsetZ: number;
    perspective: number;
    zoom: number;
    fit: boolean;
    itemWidth: number;
    itemHeight: number;
    orientation: 'surface' | 'billboard' | 'radial' | 'fixed';
    itemRotateX: number;
    itemRotateY: number;
    itemRotateZ: number;
    twist: number;
    backfaces: boolean;
    depthFade: number;
    dragMode: 'spin' | 'orbit' | 'none';
    autoplay: boolean;
    speed: number;
    pauseOnHover: boolean;
    navigation: boolean;
}
export declare const DEFAULT_CAROUSEL_3D: Carousel3DConfig;
export declare function normalizeCarousel3D(input: Partial<Carousel3DConfig>): Carousel3DConfig;
/** Reference arrangements share the same geometry and renderer. */
export declare const CAROUSEL_3D_PRESETS: Record<string, Partial<Carousel3DConfig>>;
