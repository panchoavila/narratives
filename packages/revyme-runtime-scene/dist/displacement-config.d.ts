/** Versioned authoring data, shared by the editor and the published runtime. */
export interface DisplacementConfig {
    version: 1;
    duration: number;
    strength: number;
    seed: number;
    columns: number;
}
export declare const DEFAULT_DISPLACEMENT: DisplacementConfig;
export declare function normalizeDisplacement(value: unknown): DisplacementConfig | null;
