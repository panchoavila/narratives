import type { VhsConfig } from './vhs-config';
type Crop = {
    sx: number;
    sy: number;
    swidth: number;
    sheight: number;
};
/** One program and one bounded texture for the lifetime of a stage. */
export declare function createVhsRenderer(canvas: HTMLCanvasElement): {
    upload(element: HTMLElement, crop: Crop): void;
    draw(config: VhsConfig, cssWidth: number, cssHeight: number, seconds: number, amount: number): void;
    destroy(): void;
} | null;
export {};
