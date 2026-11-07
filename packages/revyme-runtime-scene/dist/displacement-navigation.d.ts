import { createDisplacement } from './displacement-renderer';
import { type DisplacementConfig } from './displacement-config';
export interface DisplacementNavigationOptions {
    config: DisplacementConfig;
    /** Resolves after the destination DOM has committed. Called at most once. */
    navigate: () => Promise<void>;
    signal?: AbortSignal;
    /** Optional renderer lets other snapshot effects reuse the same safe navigation lifecycle. */
    renderer?: (canvas: HTMLCanvasElement, onLost: () => void) => ReturnType<typeof createDisplacement>;
}
export interface DisplacementNavigationResult {
    mode: 'gpu' | 'fallback' | 'cancelled';
    reason?: string;
}
/** Snapshot enhancement for route navigation. Does not depend on HTML-in-Canvas.
 * Unsupported surfaces retain normal navigation. No global DOM transforms. */
export declare function runDisplacementNavigation(options: DisplacementNavigationOptions): Promise<DisplacementNavigationResult>;
