import type { NovaWarpConfig } from './nova-warp-config';
export interface WarpFrame {
    travel: number;
    time: number;
    rotation: number;
    intensity: number;
    centerX: number;
    centerY: number;
    pointerX: number;
    pointerY: number;
}
export declare function createNovaWarpRenderer(canvas: HTMLCanvasElement, config: NovaWarpConfig): {
    resize(w: number, h: number, dpr: number): void;
    render(frame: WarpFrame): void;
    dispose(): void;
};
