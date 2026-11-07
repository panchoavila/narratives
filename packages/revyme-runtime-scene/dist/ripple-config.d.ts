export interface RippleConfig {
    version: 1;
    amplitude: number;
    speed: number;
    wavelength: number;
    rings: number;
    decay: number;
    refraction: number;
    dispersion: number;
    shine: number;
    trigger: 'click' | 'hover' | 'none';
    interval: number;
}
export declare const DEFAULT_RIPPLE: RippleConfig;
export declare function normalizeRipple(input: unknown): RippleConfig | null;
