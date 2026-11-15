import type { RippleConfig } from './ripple-config';
/** Refraction of a captured surface through an expanding radial wave. */
export declare function createRippleRenderer(canvas: HTMLCanvasElement, config: RippleConfig, origin: {
    x: number;
    y: number;
}, onLost: () => void): {
    setSize: (cssWidth: number, cssHeight: number) => void;
    setConfig(next: RippleConfig, nextOrigin: {
        x: number;
        y: number;
    }): void;
    setImages(images: readonly [TexImageSource, TexImageSource]): void;
    render(progress: number, _seed?: number, _strength?: number, _columns?: number): void;
    ready: () => boolean;
    destroy(): void;
};
