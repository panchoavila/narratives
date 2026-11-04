/** Independent snapshot transition; no Canvas UI source, shaders or data. */
export declare const DISPLACEMENT_PRESET: {
    readonly id: "canvas.displacement.v1";
    readonly duration: 1.4;
    readonly seed: 17;
    readonly columns: 18;
    readonly strength: 0.065;
};
export declare function displacementEnvelope(progress: number): number;
export declare function cellVector(x: number, y: number, seed: number): readonly [number, number];
export declare function decodeTexture(uri: string): Promise<HTMLImageElement>;
export declare function createDisplacement(canvas: HTMLCanvasElement, onLost: () => void): {
    setImages(images: readonly [TexImageSource, TexImageSource]): void;
    render(value: number, seed?: number, strength?: number, columns?: number): void;
    ready: () => boolean;
    destroy(): void;
};
