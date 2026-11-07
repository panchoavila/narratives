/** Configurable glyph rain overlay. CSS dimensions and seconds match Revyme controls. */
export interface GlyphRainConfig {
    version: 1;
    cell: number;
    speed: number;
    density: number;
    trail: number;
    glow: number;
    dim: number;
    light: number;
    lightRadius: number;
    stir: number;
    color: string;
    headColor: string;
    charset: string;
}
export declare const DEFAULT_GLYPH_RAIN: GlyphRainConfig;
export declare function normalizeGlyphRain(input: unknown): GlyphRainConfig | null;
/** Mount an independent overlay only on marked elements; the original DOM keeps input and focus. */
export declare function attachGlyphRainElements(root?: Document | HTMLElement): () => void;
