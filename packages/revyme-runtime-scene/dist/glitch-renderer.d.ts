import type { GlitchConfig } from './glitch-config';
/** Snapshot shader authored for Revyme. All distances are in CSS pixels. */
export declare function createGlitchRenderer(canvas: HTMLCanvasElement, config: GlitchConfig, onLost: () => void): {
    setSize: (cssWidth: number, cssHeight: number) => void;
    setConfig(next: GlitchConfig): void;
    setImages(images: readonly [TexImageSource, TexImageSource]): void;
    render(progress: number, _seed?: number, _strength?: number, _columns?: number): void;
    ready: () => boolean;
    destroy(): void;
};
