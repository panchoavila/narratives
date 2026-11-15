/** Serializable optical settings shared by the editor and the published runtime. */
export interface LiquidGlassConfig {
    version: 1;
    refraction: number;
    aberration: number;
    bevelDepth: number;
    bevelWidth: number;
    frost: number;
    magnify: number;
    tint: string;
    shadow: boolean;
    specular: boolean;
    reveal: 'none' | 'fade';
    tilt: boolean;
    tiltFactor: number;
    tiltEase: number;
    draggable: boolean;
    interaction: 'none' | 'fluid';
    interactionStrength: number;
    interactionRadius: number;
    interactionViscosity: number;
    resolution: number;
    audioReactive: boolean;
    audioSourceId: string;
    audioGain: number;
}
export declare const DEFAULT_LIQUID_GLASS: LiquidGlassConfig;
export declare const LIQUID_GLASS_CONTROLS: readonly [readonly ["refraction", "Refraction", 0, 1, 0.005, ""], readonly ["aberration", "Dispersion", 0, 1, 0.01, ""], readonly ["bevelDepth", "Bevel depth", 0, 1, 0.005, ""], readonly ["bevelWidth", "Bevel width", 0.005, 1, 0.005, ""], readonly ["frost", "Frost", 0, 10, 0.1, "px"], readonly ["magnify", "Magnify", 0.1, 3, 0.05, "×"]];
export declare const LIQUID_GLASS_PRESETS: {
    value: string;
    label: string;
    settings: Partial<LiquidGlassConfig>;
}[];
export declare function normalizeLiquidGlass(value: unknown): LiquidGlassConfig | null;
export declare function parseLiquidGlassAttribute(value: unknown): LiquidGlassConfig | null;
