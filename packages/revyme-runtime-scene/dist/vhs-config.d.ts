export declare const VHS_CONTROLS: readonly [readonly ["duration", "Duration", 0.25, 4, 0.05, "s", 1.2], readonly ["speed", "Tape speed", 0.1, 3, 0.05, "", 0.65], readonly ["wave", "Tape wave", 0, 3, 0.05, "", 1.1], readonly ["jitter", "Line jitter", 0, 3, 0.05, "", 0.35], readonly ["crease", "Tracking crease", 0, 3, 0.05, "", 0.35], readonly ["switching", "Head noise", 0, 3, 0.05, "", 0.5], readonly ["chroma", "Chroma bleed", 0, 12, 0.25, "px", 3], readonly ["grain", "Grain", 0, 1, 0.05, "", 0.2], readonly ["scanlines", "Scanlines", 0, 1, 0.05, "", 0.22], readonly ["vignette", "Vignette", 0, 1, 0.05, "", 0.15]];
export type VhsConfig = Record<(typeof VHS_CONTROLS)[number][0], number> & {
    version: 1;
    trigger: 'hover' | 'click';
};
export declare function normalizeVhs(value: unknown): VhsConfig | null;
export declare const DEFAULT_VHS: VhsConfig;
