import type { VhsConfig } from './vhs-config';
type MovableHost = HTMLElement & {
    moveBefore?: (node: Node, before: Node | null) => void;
};
type DrawableCanvas = HTMLCanvasElement & MovableHost & {
    content?: string;
    requestPaint?: () => void;
    updateElementGeometry?: (element: Element, options: {
        canvasTransform: DOMMatrix;
    }) => void;
};
export declare function stopVhsObjects(): void;
/** Move only the stable presentation host. React continues to own its children. */
export declare function openVhsStage(anchor: MovableHost, mode: 'page' | 'object'): {
    canvas: DrawableCanvas;
    readonly closed: boolean;
    nextPaint(): Promise<boolean>;
    draw(config: VhsConfig, time: number, amount: number): void;
    destroy: () => void;
} | null;
export {};
