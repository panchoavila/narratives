/** Shared authoring data for Revyme's Glitch effect. Values are CSS pixels and seconds. */
export interface GlitchConfig {
    version: 1;
    intensity: number;
    interval: number;
    duration: number;
    slices: number;
    shift: number;
    rgbShift: number;
    blocks: number;
    noise: number;
}
export declare const DEFAULT_GLITCH: GlitchConfig;
export declare function normalizeGlitch(value: unknown): GlitchConfig | null;
