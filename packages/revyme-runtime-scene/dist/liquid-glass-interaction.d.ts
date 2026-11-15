import type { LiquidGlassConfig } from './liquid-glass-config';
import type { LiquidLens } from './vendor/liquid-gl';
/** Additive presentation motion leaves the authored/Motion transform untouched. */
export declare function attachGlassInteraction(el: HTMLElement, lens: LiquidLens, config: LiquidGlassConfig, position?: {
    x: number;
    y: number;
}): () => void;
